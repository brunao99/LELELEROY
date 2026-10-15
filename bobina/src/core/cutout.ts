/**
 * Recorte com laço: a parte sem rede neural.
 *
 * O EdgeTAM roda em quatro redes (engine/cutout.ts). Aqui ficam as decisões em
 * volta delas, do mesmo jeito que o SAM 2 faz no vídeo: qual das quatro máscaras
 * do decodificador usar, que memórias de quadros anteriores entram na atenção,
 * como o laço vira caixa e toques, e como as máscaras são guardadas.
 *
 * Coordenadas: o laço e os toques são normalizados (0..1) sobre o quadro em pé.
 * As redes veem o quadro esticado para 1024x1024 e devolvem máscaras 256x256
 * cobrindo o quadro inteiro.
 */
import type { Cutout, Micros } from './types';

export const MODEL_SIZE = 1024;
export const MASK_SIZE = 256;
export const MASK_PIXELS = MASK_SIZE * MASK_SIZE;
export const MEMORY_TOKENS = 512;
export const MEMORY_DIM = 64;
export const POINTER_DIM = 256;
/** Quadros de memória: o do laço + os 6 mais recentes. */
const NUM_MASKMEM = 7;
/** Ponteiros de objeto: o do laço + até 15 recentes. */
const MAX_POINTERS = 16;
const STABILITY_DELTA = 0.05;
const STABILITY_THRESH = 0.98;
/** Logit de "certamente fundo". */
export const BACKGROUND_LOGIT = -20;

export interface Point {
  x: number;
  y: number;
}

/** Toque de ajuste: incluir (+) ou excluir (−) a região tocada. */
export interface Click extends Point {
  include: boolean;
}

/** Saída do decodificador: 4 máscaras (logits 256x256), notas, ponteiros e presença do objeto. */
export interface DecoderOutput {
  masks: Float32Array;
  iou: Float32Array;
  pointers: Float32Array;
  objectScore: number;
}

/**
 * Qual das quatro máscaras usar (como o SAM 2): com um toque só (ou nenhum, no
 * rastreio) a melhor das três alternativas; com caixa ou vários toques, a máscara
 * única, a não ser que ela esteja instável.
 */
export function chooseMask(out: Pick<DecoderOutput, 'masks' | 'iou'>, multimask: boolean): number {
  let best = 1;
  for (let k = 2; k <= 3; k++) if (out.iou[k]! > out.iou[best]!) best = k;
  if (multimask) return best;
  let inner = 0;
  let outer = 0;
  for (let i = 0; i < MASK_PIXELS; i++) {
    const v = out.masks[i]!;
    if (v > STABILITY_DELTA) inner++;
    if (v > -STABILITY_DELTA) outer++;
  }
  const stability = outer > 0 ? inner / outer : 1;
  return stability >= STABILITY_THRESH ? 0 : best;
}

export function maskOf(out: Pick<DecoderOutput, 'masks'>, k: number): Float32Array {
  return out.masks.slice(k * MASK_PIXELS, (k + 1) * MASK_PIXELS);
}

export function pointerOf(out: Pick<DecoderOutput, 'pointers'>, k: number): Float32Array {
  return out.pointers.slice(k * POINTER_DIM, (k + 1) * POINTER_DIM);
}

/** Memória de um quadro: 512 tokens (e as posições deles) e o ponteiro do objeto. */
export interface MemoryEntry {
  memory: Float32Array;
  memoryPos: Float32Array;
  pointer: Float32Array;
}

export interface AttentionInputs {
  memory: Float32Array;
  memoryPos: Float32Array;
  slots: Int32Array;
  frames: number;
  pointers: Float32Array;
  numPointers: number;
}

/**
 * Banco de memória do rastreio. `direction` é 1 indo para frente e −1 voltando
 * a partir do quadro do laço. As memórias perto do quadro do laço ficam mesmo
 * depois da ida, porque a volta começa por elas (igual ao SAM 2).
 */
export class MemoryBank {
  private cond = new Map<number, MemoryEntry>();
  private tracked = new Map<number, MemoryEntry>();

  setPrompt(frame: number, entry: MemoryEntry) {
    this.cond.set(frame, entry);
    this.tracked.delete(frame);
  }

  get promptFrames(): number[] {
    return [...this.cond.keys()];
  }

  add(frame: number, entry: MemoryEntry) {
    this.tracked.set(frame, entry);
    for (const t of [...this.tracked.keys()]) {
      if (Math.abs(t - frame) <= MAX_POINTERS) continue;
      if ([...this.cond.keys()].some((c) => Math.abs(t - c) <= MAX_POINTERS)) continue;
      this.tracked.delete(t);
    }
  }

  get size(): number {
    return this.cond.size + this.tracked.size;
  }

  /** Entradas da atenção de memória para o quadro `frame`. */
  inputs(frame: number, direction: 1 | -1, totalFrames: number): AttentionInputs {
    const entries: { entry: MemoryEntry; slot: number }[] = [];
    for (const entry of this.cond.values()) entries.push({ entry, slot: NUM_MASKMEM - 1 });
    for (let off = NUM_MASKMEM - 1; off >= 1; off--) {
      const prev = this.tracked.get(frame - direction * off);
      if (prev) entries.push({ entry: prev, slot: off - 1 });
    }
    const pointers: Float32Array[] = [];
    for (const [t, entry] of this.cond) {
      if (direction === 1 ? t <= frame : t >= frame) pointers.push(entry.pointer);
    }
    const maxPointers = Math.min(totalFrames, MAX_POINTERS);
    for (let off = 1; off < maxPointers; off++) {
      const prev = this.tracked.get(frame - direction * off);
      if (prev) pointers.push(prev.pointer);
    }
    const block = MEMORY_TOKENS * MEMORY_DIM;
    const memory = new Float32Array(entries.length * block);
    const memoryPos = new Float32Array(entries.length * block);
    const slots = new Int32Array(entries.length);
    entries.forEach(({ entry, slot }, i) => {
      memory.set(entry.memory, i * block);
      memoryPos.set(entry.memoryPos, i * block);
      slots[i] = slot;
    });
    const flat = new Float32Array(pointers.length * POINTER_DIM);
    pointers.forEach((p, i) => flat.set(p, i * POINTER_DIM));
    return { memory, memoryPos, slots, frames: entries.length, pointers: flat, numPointers: pointers.length };
  }
}

/** Pontos e rótulos do decodificador (espaço 1024): caixa do laço (2, 3), incluir (1), excluir (0). */
export interface Prompt {
  points: Float32Array;
  labels: Int32Array;
  multimask: boolean;
}

export function lassoBounds(lasso: Point[]): { x0: number; y0: number; x1: number; y1: number } | null {
  if (lasso.length < 3) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of lasso) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x0: clamp(x0), y0: clamp(y0), x1: clamp(x1), y1: clamp(y1) };
}

export function buildPrompt(lasso: Point[], clicks: Click[]): Prompt | null {
  const xy: number[] = [];
  const labels: number[] = [];
  const box = lassoBounds(lasso);
  if (box && box.x1 - box.x0 > 0.002 && box.y1 - box.y0 > 0.002) {
    xy.push(box.x0 * MODEL_SIZE, box.y0 * MODEL_SIZE, box.x1 * MODEL_SIZE, box.y1 * MODEL_SIZE);
    labels.push(2, 3);
  }
  for (const c of clicks) {
    xy.push(c.x * MODEL_SIZE, c.y * MODEL_SIZE);
    labels.push(c.include ? 1 : 0);
  }
  if (labels.length === 0) return null;
  return { points: Float32Array.from(xy), labels: Int32Array.from(labels), multimask: labels.length <= 1 };
}

/** Pinta o polígono (par-ímpar) numa grade `size`x`size`, testando o centro de cada célula. */
export function rasterizePolygon(poly: Point[], size = MASK_SIZE): Uint8Array {
  const out = new Uint8Array(size * size);
  const n = poly.length;
  if (n < 3) return out;
  const xs: number[] = [];
  for (let row = 0; row < size; row++) {
    const y = (row + 0.5) / size;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = poly[i]!;
      const b = poly[j]!;
      if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k]! * size - 0.5));
      const to = Math.min(size - 1, Math.floor(xs[k + 1]! * size - 0.5));
      for (let col = from; col <= to; col++) out[row * size + col] = 1;
    }
  }
  return out;
}

/** Distância (aprox. euclidiana, chanfro 3-4) de cada célula até a célula marcada mais próxima, em células. */
export function distanceTo(mask: Uint8Array, size = MASK_SIZE): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(size * size);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let v = d[i]!;
      if (x > 0) v = Math.min(v, d[i - 1]! + 3);
      if (y > 0) {
        v = Math.min(v, d[i - size]! + 3);
        if (x > 0) v = Math.min(v, d[i - size - 1]! + 4);
        if (x < size - 1) v = Math.min(v, d[i - size + 1]! + 4);
      }
      d[i] = v;
    }
  }
  for (let y = size - 1; y >= 0; y--) {
    for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x;
      let v = d[i]!;
      if (x < size - 1) v = Math.min(v, d[i + 1]! + 3);
      if (y < size - 1) {
        v = Math.min(v, d[i + size]! + 3);
        if (x < size - 1) v = Math.min(v, d[i + size + 1]! + 4);
        if (x > 0) v = Math.min(v, d[i + size - 1]! + 4);
      }
      d[i] = v;
    }
  }
  for (let i = 0; i < d.length; i++) d[i] = d[i]! / 3;
  return d;
}

export function dilate(mask: Uint8Array, radius: number, size = MASK_SIZE): Uint8Array {
  if (radius <= 0) return mask.slice();
  const d = distanceTo(mask, size);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = d[i]! <= radius ? 1 : 0;
  return out;
}

/** Rótulo de cada célula ligada (vizinhança 8) de `mask`; 0 = fora. */
export function components(mask: Uint8Array, size = MASK_SIZE): { labels: Int32Array; count: number } {
  const labels = new Int32Array(mask.length);
  const stack = new Int32Array(mask.length);
  let count = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    count++;
    let top = 0;
    stack[top++] = start;
    labels[start] = count;
    while (top > 0) {
      const i = stack[--top]!;
      const x = i % size;
      const y = (i - x) / size;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= size) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= size) continue;
          const j = ny * size + nx;
          if (mask[j] && !labels[j]) {
            labels[j] = count;
            stack[top++] = j;
          }
        }
      }
    }
  }
  return { labels, count };
}

/** Margem do laço: o objeto pode passar um pouco da linha desenhada (o dedo não é exato). */
export const LASSO_MARGIN = 6;

/**
 * Aplica o laço na máscara: fora do laço (com folga) é fundo; pedaços soltos que
 * não encostam no laço saem; um toque de incluir fora do laço traz o pedaço dele.
 */
export function constrainToLasso(logits: Float32Array, lasso: Point[], clicks: Click[], margin = LASSO_MARGIN): Float32Array {
  const out = logits.slice();
  if (lasso.length < 3) return out;
  const inside = rasterizePolygon(lasso);
  const allowed = dilate(inside, margin);
  const fg = new Uint8Array(MASK_PIXELS);
  for (let i = 0; i < MASK_PIXELS; i++) fg[i] = logits[i]! > 0 ? 1 : 0;
  const { labels, count } = components(fg);
  // Pedaços que encostam no laço ficam (dentro da folga); os trazidos por um toque de incluir ficam inteiros.
  // Farelos (menos de 2% da área total) saem.
  const touches = new Uint8Array(count + 1);
  const area = new Int32Array(count + 1);
  for (let i = 0; i < MASK_PIXELS; i++) {
    const comp = labels[i]!;
    if (!comp) continue;
    area[comp]!++;
    if (inside[i]) touches[comp] = 1;
  }
  let total = 0;
  for (let c = 1; c <= count; c++) total += area[c]!;
  for (let c = 1; c <= count; c++) if (area[c]! < total * 0.02) touches[c] = 0;
  const clicked = new Uint8Array(count + 1);
  for (const c of clicks) {
    const comp = labels[cellAt(c)]!;
    if (c.include && comp) clicked[comp] = 1;
  }
  for (let i = 0; i < MASK_PIXELS; i++) {
    const comp = labels[i]!;
    if (comp > 0 && clicked[comp]) continue;
    if ((comp > 0 && !touches[comp]) || !allowed[i]) out[i] = Math.min(out[i]!, BACKGROUND_LOGIT);
  }
  return out;
}

function cellAt(p: Point): number {
  const x = Math.min(MASK_SIZE - 1, Math.max(0, Math.floor(p.x * MASK_SIZE)));
  const y = Math.min(MASK_SIZE - 1, Math.max(0, Math.floor(p.y * MASK_SIZE)));
  return y * MASK_SIZE + x;
}

/** Probabilidade (0..255) de cada célula. */
export function logitsToBytes(logits: Float32Array): Uint8Array {
  const out = new Uint8Array(logits.length);
  for (let i = 0; i < logits.length; i++) {
    const v = logits[i]!;
    out[i] = v > 12 ? 255 : v < -12 ? 0 : Math.round(255 / (1 + Math.exp(-v)));
  }
  return out;
}

/** Fração da área coberta pela máscara (para saber se achou algo). */
export function coverage(logits: Float32Array): number {
  let n = 0;
  for (let i = 0; i < logits.length; i++) if (logits[i]! > 0) n++;
  return n / logits.length;
}

// ------------------------------------------------------------------ guardar

/**
 * Compressão por sequências (valor, repetições até 255). As máscaras são quase
 * todas 0 ou 255 com a borda suave: cada quadro de 64 KB vira poucos KB.
 */
export function encodeRle(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length * 2 + 2);
  let o = 0;
  let i = 0;
  while (i < bytes.length) {
    const v = bytes[i]!;
    let run = 1;
    while (run < 255 && i + run < bytes.length && bytes[i + run] === v) run++;
    out[o++] = v;
    out[o++] = run;
    i += run;
  }
  return out.slice(0, o);
}

export function decodeRle(rle: Uint8Array, out: Uint8Array, from = 0, to = rle.length): Uint8Array {
  'worklet';
  let o = 0;
  for (let i = from; i + 1 < to && o < out.length; i += 2) {
    const v = rle[i]!;
    const end = Math.min(out.length, o + rle[i + 1]!);
    out.fill(v, o, end);
    o = end;
  }
  return out;
}

const MAGIC = [0x4c, 0x44, 0x43, 0x55, 0x54, 0x31]; // "LDCUT1"

/** O cabeçalho é JSON só com números e chaves ASCII. */
function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0x7f;
  return out;
}

export interface MaskFileHeader {
  size: number;
  fps: number;
  /** Instante da mídia do primeiro quadro. */
  from: Micros;
  count: number;
}

/** Arquivo: "LDCUT1", tamanho do cabeçalho (u32), cabeçalho JSON, tabela de posições (u32 x count+1), quadros. */
export function encodeMaskFile(header: Omit<MaskFileHeader, 'count'>, frames: Uint8Array[]): Uint8Array {
  return packMaskFile(header, frames.map(encodeRle));
}

/** Como `encodeMaskFile`, com os quadros já comprimidos por `encodeRle`. */
export function packMaskFile(header: Omit<MaskFileHeader, 'count'>, blobs: Uint8Array[]): Uint8Array {
  const json = asciiBytes(JSON.stringify({ ...header, count: blobs.length }));
  const tableBytes = (blobs.length + 1) * 4;
  const total = MAGIC.length + 4 + json.length + tableBytes + blobs.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  view.setUint32(MAGIC.length, json.length, true);
  out.set(json, MAGIC.length + 4);
  const table = MAGIC.length + 4 + json.length;
  let pos = table + tableBytes;
  blobs.forEach((b, i) => {
    view.setUint32(table + i * 4, pos, true);
    out.set(b, pos);
    pos += b.length;
  });
  view.setUint32(table + blobs.length * 4, pos, true);
  return out;
}

export interface MaskFile {
  header: MaskFileHeader;
  data: Uint8Array;
  /** Posição de cada quadro em `data` (count + 1 valores). */
  offsets: Uint32Array;
}

export function parseMaskFile(data: Uint8Array): MaskFile {
  for (let i = 0; i < MAGIC.length; i++) {
    if (data[i] !== MAGIC[i]) throw new Error('Arquivo de recorte inválido.');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const jsonLength = view.getUint32(MAGIC.length, true);
  const json = String.fromCharCode(...data.subarray(MAGIC.length + 4, MAGIC.length + 4 + jsonLength));
  const header = JSON.parse(json) as MaskFileHeader;
  const table = MAGIC.length + 4 + jsonLength;
  const offsets = new Uint32Array(header.count + 1);
  for (let i = 0; i <= header.count; i++) offsets[i] = view.getUint32(table + i * 4, true);
  return { header, data, offsets };
}

/** Quadro de máscara para um instante da mídia (o mais próximo), ou −1 fora do trecho. */
export function maskIndexAt(header: Pick<MaskFileHeader, 'fps' | 'from' | 'count'>, sourceTime: Micros): number {
  'worklet';
  const i = Math.round(((sourceTime - header.from) / 1_000_000) * header.fps);
  if (i < 0 || i >= header.count) return -1;
  return i;
}

/** Instantes da mídia que o rastreio visita: de `from` a `to`, a `fps`. */
export function trackTimes(from: Micros, to: Micros, fps: number): Micros[] {
  const count = Math.max(1, Math.floor(((to - from) / 1_000_000) * fps) + 1);
  return Array.from({ length: count }, (_, i) => Math.min(to, Math.round(from + (i * 1_000_000) / fps)));
}

/** Quadro do rastreio mais próximo do instante do laço. */
export function nearestFrame(times: Micros[], time: Micros): number {
  let best = 0;
  for (let i = 1; i < times.length; i++) if (Math.abs(times[i]! - time) < Math.abs(times[best]! - time)) best = i;
  return best;
}

/** O recorte cobre o trecho do clipe? (se o clipe for estendido, pede para refazer) */
export function cutoutCovers(cutout: Pick<Cutout, 'from' | 'to'>, sourceIn: Micros, sourceOut: Micros): boolean {
  const slack = 50_000;
  return cutout.from <= sourceIn + slack && cutout.to >= sourceOut - slack;
}
