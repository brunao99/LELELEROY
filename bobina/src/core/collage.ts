/**
 * Colagem: fotos numa grade (um modelo com divisões que dá para arrastar) ou
 * soltas pelo quadro, com figurinhas (recortes com laço) e textos por cima.
 *
 * Posições e tamanhos são frações do quadro. O desenho acontece num espaço com
 * o lado menor de 1080 (o mesmo do vídeo) e é escalado na tela e na exportação.
 * As funções de geometria são worklets: os gestos rodam na thread de UI.
 */
import { DESIGN_SHORT_SIDE, sizeForAspect, type Size } from './geometry';
import type { TextStyle, Transform } from './types';

export const COLLAGE_SCHEMA = 1 as const;

export type CollageRatio = '9:16' | '4:5' | '1:1' | '3:4' | '16:9';

export const COLLAGE_RATIOS: { value: CollageRatio; aspect: number; label: string; use: string }[] = [
  { value: '9:16', aspect: 9 / 16, label: '9:16', use: 'Story' },
  { value: '4:5', aspect: 4 / 5, label: '4:5', use: 'Feed' },
  { value: '1:1', aspect: 1, label: '1:1', use: 'Quadrado' },
  { value: '3:4', aspect: 3 / 4, label: '3:4', use: 'Retrato' },
  { value: '16:9', aspect: 16 / 9, label: '16:9', use: 'Tela' },
];

export type CollageExportSize = 1080 | 1440 | 2160;

/** Fotos numa colagem (o máximo do seletor). */
export const MAX_COLLAGE_PHOTOS = 20;
/** Acima disso a colagem começa livre (não há modelos de grade). */
export const MAX_GRID_CELLS = 9;

export interface CollagePhoto {
  id: string;
  /** Foto inteira (até 4096 px), relativa à pasta da colagem. */
  file: string;
  /** Cópia menor para a tela (até 1600 px). */
  preview: string;
  width: number;
  height: number;
}

/** Recorte com fundo transparente (PNG). */
export interface CollageSticker {
  id: string;
  file: string;
  width: number;
  height: number;
}

/** Divisão do quadro: `row` põe os filhos lado a lado, `col` empilha. */
export type LayoutNode = { kind: 'cell' } | { kind: 'split'; dir: 'row' | 'col'; sizes: number[]; children: LayoutNode[] };

/** Enquadramento da foto na célula: 1 = cobre a célula; deslocamento em fração da foto desenhada. */
export interface Framing {
  zoom: number;
  x: number;
  y: number;
  flipH: boolean;
}

export interface PhotoLayer {
  kind: 'photo';
  id: string;
  photoId: string;
  /** Escala 1 = cabe no quadro. */
  transform: Transform;
  opacity: number;
  flipH: boolean;
  /** Moldura em volta: largura em fração do lado menor da foto. */
  border: { color: string; width: number } | null;
  shadow: boolean;
}

export interface StickerLayer {
  kind: 'sticker';
  id: string;
  stickerId: string;
  transform: Transform;
  opacity: number;
  flipH: boolean;
  /** Contorno de figurinha: 0..1 (até 5% do lado maior do recorte). */
  outline: { color: string; width: number } | null;
  shadow: boolean;
}

export interface TextLayer {
  kind: 'text';
  id: string;
  text: string;
  style: TextStyle;
  transform: Transform;
}

export type CollageLayer = PhotoLayer | StickerLayer | TextLayer;

export type CollageBackground = { kind: 'color'; color: string } | { kind: 'gradient'; from: string; to: string; angle: number };

export interface Collage {
  schemaVersion: typeof COLLAGE_SCHEMA;
  kind: 'collage';
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  ratio: CollageRatio;
  /** Modelo de grade, ou null quando as fotos estão soltas (camadas). */
  grid: { template: string; root: LayoutNode } | null;
  /**
   * Foto de cada célula, na ordem das células (null = vazia). Pode ter mais
   * fotos que células: as de sobra voltam quando o modelo tiver mais células.
   */
  slots: (string | null)[];
  /** Enquadramento de cada foto da grade (pelo id da foto). */
  framing: Record<string, Framing>;
  /** Espaço entre as fotos, margem e cantos: 0..1. */
  spacing: number;
  margin: number;
  radius: number;
  background: CollageBackground;
  photos: Record<string, CollagePhoto>;
  stickers: Record<string, CollageSticker>;
  /** Por cima da grade, na ordem de desenho. */
  layers: CollageLayer[];
  exportSize: CollageExportSize;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ------------------------------------------------------------------ medidas

export function collageAspect(ratio: CollageRatio): number {
  'worklet';
  return ratio === '9:16' ? 9 / 16 : ratio === '4:5' ? 4 / 5 : ratio === '3:4' ? 3 / 4 : ratio === '16:9' ? 16 / 9 : 1;
}

/** Tamanho do espaço de desenho (lado menor 1080). */
export function collageDesignSize(c: Pick<Collage, 'ratio'>): Size {
  return sizeForAspect(collageAspect(c.ratio), DESIGN_SHORT_SIDE);
}

export function collageExportSize(c: Pick<Collage, 'ratio' | 'exportSize'>, short: CollageExportSize = c.exportSize): Size {
  return sizeForAspect(collageAspect(c.ratio), short);
}

/** Espaço entre células, margem e raio dos cantos, em unidades de desenho. */
export function gridMetrics(c: Pick<Collage, 'spacing' | 'margin' | 'radius'>, W: number, H: number) {
  'worklet';
  const short = Math.min(W, H);
  return { gap: c.spacing * 0.05 * short, margin: c.margin * 0.08 * short, radius: c.radius * 0.1 * short };
}

// ------------------------------------------------------------------ modelos

const CELL: LayoutNode = { kind: 'cell' };

function split(dir: 'row' | 'col', children: LayoutNode[], weights?: number[]): LayoutNode {
  const w = weights ?? children.map(() => 1);
  const total = w.reduce((s, v) => s + v, 0);
  return { kind: 'split', dir, children, sizes: w.map((v) => v / total) };
}
const row = (...children: LayoutNode[]) => split('row', children);
const col = (...children: LayoutNode[]) => split('col', children);
const rowW = (weights: number[], ...children: LayoutNode[]) => split('row', children, weights);
const colW = (weights: number[], ...children: LayoutNode[]) => split('col', children, weights);
const C = CELL;

export interface Template {
  id: string;
  cells: number;
  build: () => LayoutNode;
}

const DEFS: [string, () => LayoutNode][] = [
  ['1', () => C],
  ['2-col', () => col(C, C)],
  ['2-row', () => row(C, C)],
  ['2-tall', () => colW([0.62, 0.38], C, C)],
  ['3-col', () => col(C, C, C)],
  ['3-top', () => colW([0.58, 0.42], C, row(C, C))],
  ['3-left', () => rowW([0.6, 0.4], C, col(C, C))],
  ['3-bottom', () => colW([0.42, 0.58], row(C, C), C)],
  ['3-row', () => row(C, C, C)],
  ['4-grid', () => col(row(C, C), row(C, C))],
  ['4-top', () => colW([0.6, 0.4], C, row(C, C, C))],
  ['4-left', () => rowW([0.62, 0.38], C, col(C, C, C))],
  ['4-col', () => col(C, C, C, C)],
  ['4-brick', () => row(colW([0.62, 0.38], C, C), colW([0.38, 0.62], C, C))],
  ['5-a', () => col(row(C, C), row(C, C, C))],
  ['5-b', () => colW([0.44, 0.28, 0.28], C, row(C, C), row(C, C))],
  ['5-c', () => row(col(C, C), col(C, C, C))],
  ['5-d', () => colW([0.3, 0.4, 0.3], row(C, C), C, row(C, C))],
  ['6-grid', () => col(row(C, C), row(C, C), row(C, C))],
  ['6-wide', () => col(row(C, C, C), row(C, C, C))],
  ['6-top', () => colW([0.42, 0.29, 0.29], C, row(C, C, C), row(C, C))],
  ['6-brick', () => row(colW([0.5, 0.25, 0.25], C, C, C), colW([0.25, 0.25, 0.5], C, C, C))],
  ['7-a', () => col(row(C, C), row(C, C, C), row(C, C))],
  ['7-b', () => colW([0.4, 0.3, 0.3], C, row(C, C, C), row(C, C, C))],
  ['8-a', () => col(row(C, C), row(C, C), row(C, C), row(C, C))],
  ['8-b', () => col(row(C, C, C), row(C, C), row(C, C, C))],
  ['9-grid', () => col(row(C, C, C), row(C, C, C), row(C, C, C))],
  ['9-b', () => colW([0.4, 0.3, 0.3], C, row(C, C, C, C), row(C, C, C, C))],
];

export function countCells(node: LayoutNode): number {
  return node.kind === 'cell' ? 1 : node.children.reduce((s, n) => s + countCells(n), 0);
}

export const TEMPLATES: Template[] = DEFS.map(([id, build]) => ({ id, build, cells: countCells(build()) }));

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function templatesFor(cells: number): Template[] {
  return TEMPLATES.filter((t) => t.cells === cells);
}

export function defaultTemplate(cells: number): Template | undefined {
  return templatesFor(Math.max(1, cells))[0];
}

// ------------------------------------------------------------------ geometria da grade

export interface Divider {
  /** Caminho de índices até a divisão na árvore. */
  path: number[];
  /** Entre o filho `index` e o `index + 1`. */
  index: number;
  dir: 'row' | 'col';
  /** Centro e comprimento da linha (unidades de desenho). */
  cx: number;
  cy: number;
  span: number;
  /** Comprimento disponível da divisão (para converter arrasto em fração). */
  length: number;
}

/** Retângulos das células (na ordem da árvore) e as linhas entre elas. */
export function gridGeometry(root: LayoutNode, W: number, H: number, gap: number, margin: number): { cells: Rect[]; dividers: Divider[] } {
  'worklet';
  const cells: Rect[] = [];
  const dividers: Divider[] = [];
  const stack: { node: LayoutNode; r: Rect; path: number[] }[] = [
    { node: root, r: { x: margin, y: margin, w: Math.max(1, W - margin * 2), h: Math.max(1, H - margin * 2) }, path: [] },
  ];
  while (stack.length > 0) {
    const { node, r, path } = stack.pop()!;
    if (node.kind === 'cell') {
      cells.push(r);
      continue;
    }
    const n = node.children.length;
    const across = node.dir === 'row';
    const length = Math.max(1, (across ? r.w : r.h) - gap * (n - 1));
    const parts: Rect[] = [];
    let pos = across ? r.x : r.y;
    for (let i = 0; i < n; i++) {
      const len = length * node.sizes[i]!;
      parts.push(across ? { x: pos, y: r.y, w: len, h: r.h } : { x: r.x, y: pos, w: r.w, h: len });
      if (i < n - 1) {
        const mid = pos + len + gap / 2;
        dividers.push({
          path,
          index: i,
          dir: node.dir,
          cx: across ? mid : r.x + r.w / 2,
          cy: across ? r.y + r.h / 2 : mid,
          span: across ? r.h : r.w,
          length,
        });
      }
      pos += len + gap;
    }
    for (let i = n - 1; i >= 0; i--) stack.push({ node: node.children[i]!, r: parts[i]!, path: [...path, i] });
  }
  return { cells, dividers };
}

/** Menor fatia de uma divisão (fração do comprimento dela). */
export const MIN_SPLIT = 0.12;

/** Arrasta a linha `index` da divisão em `path` por `delta` (fração do comprimento). */
export function resizeSplit(root: LayoutNode, path: number[], index: number, delta: number): LayoutNode {
  'worklet';
  // Desce pelo caminho guardando os nós (sem recursão: roda como worklet).
  const chain: LayoutNode[] = [root];
  for (const step of path) {
    const node = chain[chain.length - 1]!;
    if (node.kind !== 'split' || !node.children[step]) return root;
    chain.push(node.children[step]!);
  }
  const target = chain[chain.length - 1]!;
  if (target.kind !== 'split' || index < 0 || index >= target.children.length - 1) return root;
  const a = target.sizes[index]!;
  const pair = a + target.sizes[index + 1]!;
  const na = Math.min(pair - MIN_SPLIT, Math.max(MIN_SPLIT, a + delta));
  if (pair < MIN_SPLIT * 2 || na === a) return root;
  const sizes = target.sizes.slice();
  sizes[index] = na;
  sizes[index + 1] = pair - na;
  // Sobe trocando cada pai por uma cópia com o filho novo.
  let next: LayoutNode = { ...target, sizes };
  for (let i = path.length - 1; i >= 0; i--) {
    const parent = chain[i]! as Extract<LayoutNode, { kind: 'split' }>;
    const children = parent.children.slice();
    children[path[i]!] = next;
    next = { ...parent, children };
  }
  return next;
}

/** Onde a foto fica dentro da célula (cobre a célula, com aproximação e deslocamento). */
export function photoInCell(cell: Rect, pw: number, ph: number, f: Framing): Rect {
  'worklet';
  const s = Math.max(cell.w / pw, cell.h / ph) * Math.max(1, f.zoom);
  const w = pw * s;
  const h = ph * s;
  const mx = (w - cell.w) / 2;
  const my = (h - cell.h) / 2;
  const ox = Math.min(mx, Math.max(-mx, f.x * w));
  const oy = Math.min(my, Math.max(-my, f.y * h));
  return { x: cell.x + cell.w / 2 - w / 2 + ox, y: cell.y + cell.h / 2 - h / 2 + oy, w, h };
}

/** Enquadramento com o deslocamento dentro do que a célula permite. */
export function clampFraming(cell: Rect, pw: number, ph: number, f: Framing): Framing {
  'worklet';
  const zoom = Math.min(6, Math.max(1, f.zoom));
  const r = photoInCell(cell, pw, ph, { ...f, zoom });
  const x = (r.x + r.w / 2 - (cell.x + cell.w / 2)) / r.w;
  const y = (r.y + r.h / 2 - (cell.y + cell.h / 2)) / r.h;
  return { zoom, x, y, flipH: f.flipH };
}

export const NO_FRAMING: Framing = { zoom: 1, x: 0, y: 0, flipH: false };

export function framingOf(c: Collage, photoId: string): Framing {
  'worklet';
  return c.framing[photoId] ?? { zoom: 1, x: 0, y: 0, flipH: false };
}

/** Célula sob o ponto (unidades de desenho), ou -1. */
export function cellAt(cells: Rect[], x: number, y: number): number {
  'worklet';
  for (let i = 0; i < cells.length; i++) {
    const r = cells[i]!;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

/** Linha da grade perto do ponto (tolerância em unidades de desenho), ou -1. */
export function dividerAt(dividers: Divider[], x: number, y: number, tolerance: number): number {
  'worklet';
  let best = -1;
  let bestD = tolerance;
  for (let i = 0; i < dividers.length; i++) {
    const d = dividers[i]!;
    const along = d.dir === 'row' ? Math.abs(y - d.cy) : Math.abs(x - d.cx);
    const across = d.dir === 'row' ? Math.abs(x - d.cx) : Math.abs(y - d.cy);
    if (along > d.span / 2 || across > bestD) continue;
    best = i;
    bestD = across;
  }
  return best;
}

// ------------------------------------------------------------------ camadas

/** Caixa de uma camada: centro, tamanho (com moldura) e giro em graus. */
export interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}

/** Tamanho que cabe no quadro (escala 1) para uma imagem `iw`×`ih`. */
export function containSize(iw: number, ih: number, W: number, H: number): Size {
  'worklet';
  const k = Math.min(W / Math.max(1, iw), H / Math.max(1, ih));
  return { width: iw * k, height: ih * k };
}

/**
 * Caixa da camada no espaço de desenho. Textos precisam do tamanho do
 * parágrafo (`textSize`, já em unidades de desenho).
 */
export function layerBox(c: Collage, layer: CollageLayer, W: number, H: number, textSize: Size | null): Box | null {
  'worklet';
  const t = layer.transform;
  const cx = W / 2 + t.x * W;
  const cy = H / 2 + t.y * H;
  if (layer.kind === 'text') {
    if (!textSize) return null;
    return { cx, cy, w: textSize.width * t.scale, h: textSize.height * t.scale, rotation: t.rotation };
  }
  const src = layer.kind === 'photo' ? c.photos[layer.photoId] : c.stickers[layer.stickerId];
  if (!src) return null;
  const base = containSize(src.width, src.height, W, H);
  let w = base.width * t.scale;
  let h = base.height * t.scale;
  if (layer.kind === 'photo' && layer.border) {
    const b = layer.border.width * Math.min(w, h);
    w += b * 2;
    h += b * 2;
  }
  return { cx, cy, w, h, rotation: t.rotation };
}

/** O ponto está dentro da caixa girada (com folga)? */
export function insideBox(box: Box, x: number, y: number, slack: number): boolean {
  'worklet';
  const a = (-box.rotation * Math.PI) / 180;
  const dx = x - box.cx;
  const dy = y - box.cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= box.w / 2 + slack && Math.abs(ly) <= box.h / 2 + slack;
}

/** Camada de cima sob o ponto, ou null. */
export function layerAt(
  c: Collage,
  W: number,
  H: number,
  x: number,
  y: number,
  slack: number,
  textSizes: Record<string, Size>,
): string | null {
  'worklet';
  for (let i = c.layers.length - 1; i >= 0; i--) {
    const layer = c.layers[i]!;
    const box = layerBox(c, layer, W, H, textSizes[layer.id] ?? null);
    if (box && insideBox(box, x, y, slack)) return layer.id;
  }
  return null;
}

/** Canto inferior direito da caixa (onde fica a alça de tamanho e giro). */
export function boxCorner(box: Box): { x: number; y: number } {
  'worklet';
  const a = (box.rotation * Math.PI) / 180;
  const hx = box.w / 2;
  const hy = box.h / 2;
  return { x: box.cx + hx * Math.cos(a) - hy * Math.sin(a), y: box.cy + hx * Math.sin(a) + hy * Math.cos(a) };
}

// ------------------------------------------------------------------ gesto em andamento

/** O que o dedo está fazendo agora (aplicado no desenho até o gesto terminar). */
export type CollageGesture =
  | { kind: 'none' }
  /** Mover, escalar e girar uma camada. dx/dy em unidades de desenho, escala multiplica, giro em graus. */
  | { kind: 'layer'; id: string; dx: number; dy: number; scale: number; rotation: number }
  /** Enquadrar a foto de uma célula: arrastar e aproximar. */
  | { kind: 'cell'; cell: number; dx: number; dy: number; zoom: number }
  /** Arrastar uma linha da grade (delta em unidades de desenho). */
  | { kind: 'divider'; divider: number; delta: number }
  /** Trocar fotos de lugar: a foto da célula `from` segue o dedo até `over`. */
  | { kind: 'swap'; from: number; x: number; y: number; over: number };

export const NO_GESTURE: CollageGesture = { kind: 'none' };

/** A colagem com o gesto aplicado (o desenho usa isso; ao soltar, vira um passo de desfazer). */
export function applyGesture(c: Collage, g: CollageGesture, W: number, H: number): Collage {
  'worklet';
  if (g.kind === 'layer') {
    const layers = c.layers.map((layer) => {
      if (layer.id !== g.id) return layer;
      const t0 = layer.transform;
      const transform: Transform = {
        x: t0.x + g.dx / W,
        y: t0.y + g.dy / H,
        scale: Math.min(8, Math.max(0.04, t0.scale * g.scale)),
        rotation: t0.rotation + g.rotation,
      };
      return { ...layer, transform };
    });
    return { ...c, layers };
  }
  if (g.kind === 'cell' && c.grid) {
    const photoId = c.slots[g.cell];
    const photo = photoId ? c.photos[photoId] : undefined;
    if (!photoId || !photo) return c;
    const m = gridMetrics(c, W, H);
    const cell = gridGeometry(c.grid.root, W, H, m.gap, m.margin).cells[g.cell];
    if (!cell) return c;
    const f0 = framingOf(c, photoId);
    // Primeiro onde a foto estava (já limitada), depois o arrasto e a pinça.
    const before = photoInCell(cell, photo.width, photo.height, f0);
    const zoom = Math.min(6, Math.max(1, f0.zoom * g.zoom));
    const k = zoom / Math.max(1, f0.zoom);
    const ccx = cell.x + cell.w / 2;
    const ccy = cell.y + cell.h / 2;
    const cx = ccx + (before.x + before.w / 2 - ccx) * k + g.dx;
    const cy = ccy + (before.y + before.h / 2 - ccy) * k + g.dy;
    const w = before.w * k;
    const h = before.h * k;
    const next = clampFraming(cell, photo.width, photo.height, { zoom, x: (cx - ccx) / w, y: (cy - ccy) / h, flipH: f0.flipH });
    return { ...c, framing: { ...c.framing, [photoId]: next } };
  }
  if (g.kind === 'divider' && c.grid) {
    const m = gridMetrics(c, W, H);
    const d = gridGeometry(c.grid.root, W, H, m.gap, m.margin).dividers[g.divider];
    if (!d) return c;
    const root = resizeSplit(c.grid.root, d.path, d.index, g.delta / d.length);
    return root === c.grid.root ? c : { ...c, grid: { ...c.grid, root } };
  }
  return c;
}

// ------------------------------------------------------------------ operações

/** Nome padrão: "Colagem 16/10 14:05". */
export function defaultCollageName(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Colagem ${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function visibleSlots(c: Collage): (string | null)[] {
  if (!c.grid) return [];
  const n = countCells(c.grid.root);
  const out = c.slots.slice(0, n);
  while (out.length < n) out.push(null);
  return out;
}

/** Fotos usadas na grade (em ordem) e as soltas. */
export function photosInUse(c: Collage): string[] {
  const ids = new Set<string>();
  for (const id of c.slots) if (id) ids.add(id);
  for (const layer of c.layers) if (layer.kind === 'photo') ids.add(layer.photoId);
  return [...ids];
}

/** Valor quase aleatório e repetível (posições da colagem livre). */
function jitter(i: number, salt: number): number {
  const s = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Quantas colunas o mural usa: a divisão em que as fotos (pela proporção
 * média delas) ocupam mais da sua casa, sem sobrar casa vazia demais.
 */
export function scatterColumns(n: number, photoAspect: number, W: number, H: number): number {
  let best = 1;
  let bestFill = -1;
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    const cw = W / cols;
    const ch = H / rows;
    const pw = Math.min(cw, ch * photoAspect);
    const fill = ((pw * (pw / photoAspect)) / (cw * ch)) * (n / (cols * rows));
    if (fill > bestFill + 0.02) {
      best = cols;
      bestFill = fill;
    }
  }
  return best;
}

/**
 * Fotos espalhadas como num mural: grade solta, com giros pequenos alternados,
 * moldura branca e sombra, sem sair do quadro. `from` continua a numeração
 * (para fotos novas).
 */
export function scatterPhotos(c: Collage, photoIds: string[], newId: () => string, from = 0): PhotoLayer[] {
  const { width: W, height: H } = collageDesignSize(c);
  const n = photoIds.length;
  const aspects = photoIds.map((id) => {
    const p = c.photos[id];
    return p && p.height > 0 ? p.width / p.height : 1;
  });
  const mean = aspects.reduce((s, a) => s + a, 0) / Math.max(1, n);
  const cols = scatterColumns(n, mean, W, H);
  const rows = Math.max(1, Math.ceil(n / cols));
  const cellW = W / cols;
  const cellH = H / rows;
  return photoIds.map((photoId, k) => {
    const i = from + k;
    const r = Math.floor(k / cols);
    const inRow = Math.min(cols, n - r * cols);
    const ci = k % cols;
    const photo = c.photos[photoId];
    const base = photo ? containSize(photo.width, photo.height, W, H) : { width: W, height: H };
    // Cada foto passa um pouco da sua casa: elas se sobrepõem de leve.
    const scale = Math.min((cellW * 1.2) / base.width, (cellH * 1.2) / base.height, 0.9);
    const w = base.width * scale;
    const h = base.height * scale;
    // Numa coluna só, as fotos alternam para os lados (senão vira uma pilha reta).
    const sway = cols === 1 ? (i % 2 === 0 ? -1 : 1) * 0.08 : 0;
    let x = ((ci + 0.5) / inRow - 0.5) + sway + (jitter(i, 1) - 0.5) * 0.05;
    let y = (r + 0.5) / rows - 0.5 + (jitter(i, 2) - 0.5) * 0.04;
    // Dentro do quadro, com uma margem pequena.
    const mx = Math.max(0, 0.5 - (w / 2) / W - 0.03);
    const my = Math.max(0, 0.5 - (h / 2) / H - 0.025);
    x = Math.min(mx, Math.max(-mx, x));
    y = Math.min(my, Math.max(-my, y));
    const rotation = (i % 2 === 0 ? -1 : 1) * (2 + jitter(i, 3) * 5);
    return {
      kind: 'photo',
      id: newId(),
      photoId,
      transform: { x, y, scale, rotation: Math.round(rotation * 10) / 10 },
      opacity: 1,
      flipH: false,
      border: { color: '#ffffff', width: 0.035 },
      shadow: true,
    };
  });
}

export interface NewCollageInput {
  id: string;
  name: string;
  now: number;
  ratio: CollageRatio;
  photos: CollagePhoto[];
  newId: () => string;
}

export function createCollage({ id, name, now, ratio, photos, newId }: NewCollageInput): Collage {
  const base: Collage = {
    schemaVersion: COLLAGE_SCHEMA,
    kind: 'collage',
    id,
    name,
    createdAt: now,
    updatedAt: now,
    ratio,
    grid: null,
    slots: [],
    framing: {},
    spacing: 0.35,
    margin: 0.35,
    radius: 0.2,
    background: { kind: 'color', color: '#ffffff' },
    photos: Object.fromEntries(photos.map((p) => [p.id, p])),
    stickers: {},
    layers: [],
    exportSize: 1440,
  };
  const template = photos.length <= MAX_GRID_CELLS ? defaultTemplate(photos.length) : undefined;
  if (template) return { ...base, grid: { template: template.id, root: template.build() }, slots: photos.map((p) => p.id) };
  return { ...base, background: { kind: 'color', color: '#f4efe6' }, layers: scatterPhotos(base, photos.map((p) => p.id), newId) };
}

/**
 * Troca o modelo. Saindo da colagem livre, as fotos soltas voltam para a grade
 * (na ordem em que estavam empilhadas); figurinhas e textos ficam.
 */
export function setTemplate(c: Collage, templateId: string): Collage {
  const template = templateById(templateId);
  if (!template) return c;
  if (c.grid) {
    if (c.grid.template === templateId) return c;
    return { ...c, grid: { template: template.id, root: template.build() } };
  }
  const photos = c.layers.filter((l): l is PhotoLayer => l.kind === 'photo').map((l) => l.photoId);
  const slots = [...c.slots.filter((s): s is string => !!s && !photos.includes(s)), ...photos];
  return {
    ...c,
    grid: { template: template.id, root: template.build() },
    slots,
    layers: c.layers.filter((l) => l.kind !== 'photo'),
  };
}

/** Colagem livre: as fotos da grade viram camadas espalhadas por baixo das figurinhas e textos. */
export function setFree(c: Collage, newId: () => string): Collage {
  if (!c.grid) return c;
  const ids = c.slots.filter((s): s is string => !!s && !!c.photos[s]);
  const scattered = scatterPhotos(c, ids, newId);
  return { ...c, grid: null, slots: [], layers: [...scattered, ...c.layers] };
}

/** Troca as fotos de duas células. */
export function swapSlots(c: Collage, a: number, b: number): Collage {
  if (a === b || a < 0 || b < 0) return c;
  const slots = c.slots.slice();
  while (slots.length <= Math.max(a, b)) slots.push(null);
  [slots[a], slots[b]] = [slots[b] ?? null, slots[a] ?? null];
  return { ...c, slots: trimSlots(slots) };
}

function trimSlots(slots: (string | null)[]): (string | null)[] {
  let end = slots.length;
  while (end > 0 && slots[end - 1] === null) end--;
  return end === slots.length ? slots : slots.slice(0, end);
}

/** Põe uma foto numa célula (ou esvazia a célula com null). */
export function setSlot(c: Collage, index: number, photoId: string | null): Collage {
  if (index < 0) return c;
  const slots = c.slots.slice();
  while (slots.length <= index) slots.push(null);
  slots[index] = photoId;
  const framing = { ...c.framing };
  if (photoId) framing[photoId] = { ...NO_FRAMING, flipH: framing[photoId]?.flipH ?? false };
  return { ...c, slots: trimSlots(slots), framing };
}

/**
 * Fotos novas: na grade, ocupam as células vazias e depois entram no fim, e o
 * modelo cresce se faltar célula (acima de 9 fotos a colagem fica livre). Na
 * colagem livre, entram espalhadas por cima das outras fotos.
 */
export function addPhotos(c: Collage, photos: CollagePhoto[], newId: () => string): Collage {
  if (photos.length === 0) return c;
  const withPhotos: Collage = { ...c, photos: { ...c.photos, ...Object.fromEntries(photos.map((p) => [p.id, p])) } };
  if (!withPhotos.grid) {
    const count = withPhotos.layers.filter((l) => l.kind === 'photo').length;
    const added = scatterPhotos(withPhotos, photos.map((p) => p.id), newId, count);
    const lastPhoto = withPhotos.layers.reduce((at, l, i) => (l.kind === 'photo' ? i : at), -1);
    const layers = withPhotos.layers.slice();
    layers.splice(lastPhoto + 1, 0, ...added);
    return { ...withPhotos, layers };
  }
  const cells = countCells(withPhotos.grid.root);
  const slots = withPhotos.slots.slice();
  while (slots.length < cells) slots.push(null);
  const queue = photos.map((p) => p.id);
  for (let i = 0; i < cells && queue.length > 0; i++) {
    if (!slots[i]) slots[i] = queue.shift()!;
  }
  if (queue.length === 0) return { ...withPhotos, slots: trimSlots(slots) };
  // Faltou célula: as novas entram logo depois das visíveis (antes das de sobra)
  // e o modelo passa a ter uma célula por foto.
  slots.splice(cells, 0, ...queue);
  const next = { ...withPhotos, slots: trimSlots(slots) };
  const used = cells + queue.length;
  if (used > MAX_GRID_CELLS) return setFree(next, newId);
  const template = defaultTemplate(used);
  return template ? setTemplate(next, template.id) : next;
}

export function updateFraming(c: Collage, photoId: string, patch: Partial<Framing>): Collage {
  return { ...c, framing: { ...c.framing, [photoId]: { ...framingOf(c, photoId), ...patch } } };
}

export function setRatio(c: Collage, ratio: CollageRatio): Collage {
  return c.ratio === ratio ? c : { ...c, ratio };
}

export function setBackground(c: Collage, background: CollageBackground): Collage {
  return { ...c, background };
}

export function setBorders(c: Collage, patch: Partial<Pick<Collage, 'spacing' | 'margin' | 'radius'>>): Collage {
  const clamp = (v: number | undefined, d: number) => (v === undefined ? d : Math.min(1, Math.max(0, v)));
  return { ...c, spacing: clamp(patch.spacing, c.spacing), margin: clamp(patch.margin, c.margin), radius: clamp(patch.radius, c.radius) };
}

export function renameCollage(c: Collage, name: string): Collage {
  const trimmed = name.trim();
  return trimmed && trimmed !== c.name ? { ...c, name: trimmed } : c;
}

export function findLayer(c: Collage, id: string): CollageLayer | undefined {
  return c.layers.find((l) => l.id === id);
}

export function updateLayer(c: Collage, id: string, fn: (layer: CollageLayer) => CollageLayer): Collage {
  let changed = false;
  const layers = c.layers.map((l) => {
    if (l.id !== id) return l;
    const next = fn(l);
    if (next !== l) changed = true;
    return next;
  });
  return changed ? { ...c, layers } : c;
}

export function addLayer(c: Collage, layer: CollageLayer): Collage {
  return { ...c, layers: [...c.layers, layer] };
}

export function removeLayer(c: Collage, id: string): Collage {
  const layers = c.layers.filter((l) => l.id !== id);
  return layers.length === c.layers.length ? c : { ...c, layers };
}

/** Cópia logo acima da original, um pouco deslocada. */
export function duplicateLayer(c: Collage, id: string, copyId: string): Collage {
  const i = c.layers.findIndex((l) => l.id === id);
  if (i < 0) return c;
  const source = c.layers[i]!;
  const t = source.transform;
  const copy = { ...source, id: copyId, transform: { ...t, x: t.x + 0.04, y: t.y + 0.04 } } as CollageLayer;
  const layers = c.layers.slice();
  layers.splice(i + 1, 0, copy);
  return { ...c, layers };
}

/** Frente ou trás de tudo. */
export function moveLayer(c: Collage, id: string, to: 'front' | 'back'): Collage {
  const i = c.layers.findIndex((l) => l.id === id);
  if (i < 0) return c;
  if ((to === 'front' && i === c.layers.length - 1) || (to === 'back' && i === 0)) return c;
  const layers = c.layers.slice();
  const [layer] = layers.splice(i, 1);
  if (to === 'front') layers.push(layer!);
  else layers.unshift(layer!);
  return { ...c, layers };
}

export function addSticker(c: Collage, sticker: CollageSticker, layerId: string): Collage {
  const layer: StickerLayer = {
    kind: 'sticker',
    id: layerId,
    stickerId: sticker.id,
    transform: { x: 0, y: 0, scale: 0.55, rotation: 0 },
    opacity: 1,
    flipH: false,
    outline: { color: '#ffffff', width: 0.5 },
    shadow: true,
  };
  return { ...c, stickers: { ...c.stickers, [sticker.id]: sticker }, layers: [...c.layers, layer] };
}

/** Cor clara (texto escuro por cima)? Aceita `#rgb` e `#rrggbb`. */
export function isLightColor(hex: string): boolean {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, (ch) => ch + ch) : h.slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return false;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
}

/** O fundo da colagem é claro? (no gradiente, pela média das duas cores) */
export function hasLightBackground(c: Collage): boolean {
  const bg = c.background;
  if (bg.kind === 'color') return isLightColor(bg.color);
  return isLightColor(bg.from) && isLightColor(bg.to);
}

export function makeTextLayer(id: string, text: string, style: TextStyle): TextLayer {
  return { kind: 'text', id, text, style, transform: { x: 0, y: 0, scale: 1, rotation: 0 } };
}

/**
 * Maior lado com que cada foto aparece (unidades de desenho). A exportação
 * carrega cada foto só no tamanho de que precisa.
 */
export function photoDrawSides(c: Collage, W: number, H: number): Record<string, number> {
  const out: Record<string, number> = {};
  const keep = (id: string, side: number) => {
    out[id] = Math.max(out[id] ?? 0, side);
  };
  if (c.grid) {
    const m = gridMetrics(c, W, H);
    const { cells } = gridGeometry(c.grid.root, W, H, m.gap, m.margin);
    cells.forEach((cell, i) => {
      const id = c.slots[i];
      const photo = id ? c.photos[id] : undefined;
      if (!id || !photo) return;
      const r = photoInCell(cell, photo.width, photo.height, framingOf(c, id));
      keep(id, Math.max(r.w, r.h));
    });
  }
  for (const layer of c.layers) {
    if (layer.kind !== 'photo') continue;
    const photo = c.photos[layer.photoId];
    if (!photo) continue;
    const base = containSize(photo.width, photo.height, W, H);
    keep(layer.photoId, Math.max(base.width, base.height) * layer.transform.scale);
  }
  return out;
}

/** Tira fotos e figurinhas que nada usa (ao abrir, antes de existir desfazer). */
export function pruneCollage(c: Collage): Collage {
  const photos = new Set(photosInUse(c));
  const stickers = new Set(c.layers.flatMap((l) => (l.kind === 'sticker' ? [l.stickerId] : [])));
  const unusedPhoto = Object.keys(c.photos).some((id) => !photos.has(id));
  const unusedSticker = Object.keys(c.stickers).some((id) => !stickers.has(id));
  if (!unusedPhoto && !unusedSticker) return c;
  return {
    ...c,
    photos: Object.fromEntries(Object.entries(c.photos).filter(([id]) => photos.has(id))),
    stickers: Object.fromEntries(Object.entries(c.stickers).filter(([id]) => stickers.has(id))),
    framing: Object.fromEntries(Object.entries(c.framing).filter(([id]) => photos.has(id))),
  };
}

/** Arquivos que a colagem usa (para limpar o que sobrou na pasta). */
export function collageFiles(c: Collage): Set<string> {
  const files = new Set<string>();
  for (const p of Object.values(c.photos)) {
    files.add(p.file);
    files.add(p.preview);
  }
  for (const s of Object.values(c.stickers)) files.add(s.file);
  return files;
}
