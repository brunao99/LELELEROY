/**
 * Recorte com laço no aparelho: baixa o EdgeTAM, lê os quadros do vídeo, roda o
 * laço (quadro parado) e o rastreio (o clipe todo) e grava as máscaras.
 *
 * As redes rodam no ONNX Runtime (engine/edgetam.ts); as decisões ficam em
 * core/cutout.ts. Os quadros são lidos num runtime de worklets próprio, com o
 * mesmo decodificador do motor, já esticados para 1024x1024.
 */
import { __RNSkiaVideoPrivateAPI as SkiaVideo } from '@azzapp/react-native-skia-video';
import {
  AlphaType,
  ColorType,
  FilterMode,
  ImageFormat,
  MipmapMode,
  Skia,
  TileMode,
  type SkImage,
  type SkSurface,
} from '@shopify/react-native-skia';
import { Directory, File } from 'expo-file-system';
import type { InferenceSession } from 'onnxruntime-react-native';
import { Platform } from 'react-native';
import { createWorkletRuntime, runOnRuntime, scheduleOnRN, type WorkletRuntime } from 'react-native-worklets';

import {
  MASK_SIZE,
  MODEL_SIZE,
  buildPrompt,
  constrainToLasso,
  coverage,
  encodeRle,
  logitsToBytes,
  packMaskFile,
  nearestFrame,
  stickerGeometry,
  trackTimes,
  type Click,
  type Point,
} from '@/core/cutout';
import type { CollageSticker } from '@/core/collage';
import { displaySize } from '@/core/geometry';
import { newId } from '@/core/ids';
import type { MediaAsset, Micros } from '@/core/types';
import { collageDir, collageFile } from '@/storage/collages';
import { absolutePath, ensureDir, modelsDir, projectDir, toPlainPath } from '@/storage/paths';

import { drawUpright } from './bake';
import { EdgeTam, type EdgeTamSessions, type Features, type Segmentation } from './edgetam';
import { loadImage } from './resources';
import { fxEffect } from './shaders';

// ------------------------------------------------------------------ modelo

/** Onde o workflow do repositório publica o EdgeTAM exportado (tools/edgetam). */
const MODEL_RELEASE = 'https://github.com/brunao99/LELELEROY/releases/download/edgetam-1';
const MODEL_ID = 'edgetam-1';
export const CUTOUT_MODEL = { name: 'EdgeTAM', megabytes: 74 };

interface ManifestFile {
  name: 'image_encoder' | 'mask_decoder' | 'memory_encoder' | 'memory_attention';
  file: string;
  bytes: number;
}

function modelDir(): Directory {
  return new Directory(modelsDir(), MODEL_ID);
}

function readManifest(): ManifestFile[] | null {
  const file = new File(modelDir(), 'manifest.json');
  if (!file.exists) return null;
  try {
    return (JSON.parse(file.textSync()) as { files: ManifestFile[] }).files;
  } catch {
    return null;
  }
}

export function isCutoutModelReady(): boolean {
  const files = readManifest();
  if (!files || files.length !== 4) return false;
  return files.every((f) => {
    const file = new File(modelDir(), f.file);
    return file.exists && file.size === f.bytes;
  });
}

/** Baixa o modelo (com progresso 0..1). Cada arquivo vai para um `.part` e só depois troca de nome. */
export async function downloadCutoutModel(onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  const dir = ensureDir(modelDir());
  const manifestFile = new File(dir, 'manifest.json');
  if (!readManifest()) {
    if (manifestFile.exists) manifestFile.delete();
    await File.downloadFileAsync(`${MODEL_RELEASE}/manifest.json`, manifestFile, { idempotent: true, signal });
  }
  const files = readManifest();
  if (!files) throw new Error('Não foi possível ler a lista de arquivos do modelo.');
  const total = files.reduce((s, f) => s + f.bytes, 0);
  let done = 0;
  for (const f of files) {
    const target = new File(dir, f.file);
    if (target.exists && target.size === f.bytes) {
      done += f.bytes;
      onProgress(done / total);
      continue;
    }
    const partial = new File(dir, `${f.file}.part`);
    if (partial.exists) partial.delete();
    await File.downloadFileAsync(`${MODEL_RELEASE}/${f.file}`, partial, {
      idempotent: true,
      signal,
      onProgress: ({ bytesWritten }) => onProgress((done + bytesWritten) / total),
    });
    if (partial.size !== f.bytes) {
      partial.delete();
      throw new Error('O download do modelo veio incompleto. Tente de novo.');
    }
    if (target.exists) target.delete();
    partial.moveSync(target);
    done += f.bytes;
    onProgress(done / total);
  }
}

/** Espaço ocupado pelo modelo baixado. */
export function cutoutModelBytes(): number {
  return (readManifest() ?? []).reduce((sum, f) => sum + f.bytes, 0);
}

export function deleteCutoutModel(): void {
  const dir = modelDir();
  if (dir.exists) dir.delete();
  releaseCutoutSessions();
}

type Ort = typeof import('onnxruntime-react-native');

let ortModule: Ort | null = null;
function ort(): Ort {
  // Só carrega o ONNX Runtime quando o recorte é usado (ele instala o módulo nativo ao carregar).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ortModule ??= require('onnxruntime-react-native') as Ort;
  return ortModule;
}

let sessions: Promise<EdgeTamSessions> | null = null;

async function createSession(file: string, accelerate: boolean): Promise<InferenceSession> {
  const path = toPlainPath(new File(modelDir(), file).uri);
  const base = { graphOptimizationLevel: 'all' as const };
  if (accelerate && Platform.OS === 'ios') {
    // Core ML (GPU/Neural Engine) no codificador de imagem; se falhar, CPU.
    try {
      return await ort().InferenceSession.create(path, { ...base, executionProviders: [{ name: 'coreml', coreMlFlags: 0x010 }, 'cpu'] });
    } catch {
      // segue para a CPU
    }
  }
  return ort().InferenceSession.create(path, { ...base, executionProviders: ['cpu'] });
}

export function cutoutSessions(): Promise<EdgeTamSessions> {
  sessions ??= (async () => {
    const files = readManifest();
    if (!files) throw new Error('O modelo de recorte ainda não foi baixado.');
    const byName = Object.fromEntries(files.map((f) => [f.name, f.file])) as Record<ManifestFile['name'], string>;
    return {
      imageEncoder: await createSession(byName.image_encoder, true),
      maskDecoder: await createSession(byName.mask_decoder, false),
      memoryEncoder: await createSession(byName.memory_encoder, false),
      memoryAttention: await createSession(byName.memory_attention, false),
    };
  })().catch((e: unknown) => {
    sessions = null;
    throw e;
  });
  return sessions;
}

/** Libera a memória das redes (umas centenas de MB) quando o recorte termina. */
export function releaseCutoutSessions(): void {
  const pending = sessions;
  sessions = null;
  pending
    ?.then((s) => Promise.all([s.imageEncoder.release(), s.maskDecoder.release(), s.memoryEncoder.release(), s.memoryAttention.release()]))
    .catch(() => {});
}

// ------------------------------------------------------------------ quadros

/** Lado maior da imagem do quadro que aparece para desenhar o laço. */
const DISPLAY_MAX_SIDE = 1440;

let runtime: WorkletRuntime | null = null;
function readerRuntime(): WorkletRuntime {
  if (!runtime) runtime = createWorkletRuntime({ name: 'BobinaCutout' });
  return runtime;
}

interface ReaderGlobal {
  __cutoutReader?: {
    extractor: ReturnType<typeof SkiaVideo.createVideoCompositionFramesExtractorSync>;
    start: number;
  } | null;
  __cutoutSurfaces?: Record<string, SkSurface>;
}

/** Abre o vídeo a partir de `startSeconds` (o decodificador só anda para frente). */
function openReader(path: string, startSeconds: number, spanSeconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (error: string | null) => (error ? reject(new Error(error)) : resolve());
    runOnRuntime(readerRuntime(), () => {
      'worklet';
      const g = globalThis as unknown as ReaderGlobal;
      try {
        g.__cutoutReader?.extractor.dispose();
        g.__cutoutReader = null;
        // A superfície dá ao extrator o contexto OpenGL de que ele precisa no Android.
        g.__cutoutSurfaces ??= {};
        const key = `${MODEL_SIZE}x${MODEL_SIZE}`;
        g.__cutoutSurfaces[key] ??= Skia.Surface.MakeOffscreen(MODEL_SIZE, MODEL_SIZE)!;
        if (!g.__cutoutSurfaces[key]) throw new Error('Não foi possível criar a superfície.');
        const extractor = SkiaVideo.createVideoCompositionFramesExtractorSync({
          duration: spanSeconds,
          items: [{ id: 'v', path, compositionStartTime: 0, startTime: startSeconds, duration: spanSeconds }],
        });
        extractor.start();
        g.__cutoutReader = { extractor, start: startSeconds };
        scheduleOnRN(done, null);
      } catch (e) {
        scheduleOnRN(done, String(e));
      }
    })();
  });
}

interface ReadFrame {
  /** RGBA 1024x1024, o quadro em pé esticado para a rede. */
  rgba: Uint8Array;
  /** Quadro em pé no tamanho de tela (só quando pedido). */
  display: { pixels: Uint8Array; width: number; height: number } | null;
}

/**
 * Lê o quadro no instante `atSeconds` da mídia (crescente desde o `openReader`).
 * Vídeos bem maiores que 1024 passam por uma etapa intermediária (2048) para a
 * redução não serrilhar os detalhes.
 */
function readFrame(atSeconds: number, display: { width: number; height: number } | null): Promise<ReadFrame> {
  return new Promise((resolve, reject) => {
    const done = (rgba: Uint8Array | null, shown: ReadFrame['display'], error: string | null) => {
      if (rgba) resolve({ rgba, display: shown });
      else reject(new Error(error ?? 'Não foi possível ler o quadro.'));
    };
    runOnRuntime(readerRuntime(), () => {
      'worklet';
      const g = globalThis as unknown as ReaderGlobal;
      const reader = g.__cutoutReader;
      const surfaces = g.__cutoutSurfaces ?? {};
      const surfaceOf = (w: number, h: number) => {
        const key = `${w}x${h}`;
        surfaces[key] ??= Skia.Surface.MakeOffscreen(w, h)!;
        return surfaces[key]!;
      };
      try {
        if (!reader) throw new Error('Leitor fechado.');
        const pooled = SkiaVideo.runWithAutoreleasePool ?? ((fn: () => void) => fn());
        let rgba: Uint8Array | null = null;
        let shown: ReadFrame['display'] = null;
        let failure: string | null = null;
        // Nada de exceção dentro do pool (no iOS ele é uma chamada nativa).
        pooled(() => {
          const frame = reader.extractor.decodeCompositionFrames(Math.max(0.001, atSeconds - reader.start)).v;
          if (!frame || !frame.texture) {
            failure = 'Quadro vazio.';
            return;
          }
          const target = surfaceOf(MODEL_SIZE, MODEL_SIZE);
          if (Math.max(frame.width, frame.height) > MODEL_SIZE * 2.2) {
            const mid = surfaceOf(MODEL_SIZE * 2, MODEL_SIZE * 2);
            drawUpright(mid.getCanvas(), frame, MODEL_SIZE * 2, MODEL_SIZE * 2);
            mid.flush();
            const step = mid.makeImageSnapshot();
            target
              .getCanvas()
              .drawImageRectOptions(
                step,
                Skia.XYWHRect(0, 0, MODEL_SIZE * 2, MODEL_SIZE * 2),
                Skia.XYWHRect(0, 0, MODEL_SIZE, MODEL_SIZE),
                FilterMode.Linear,
                MipmapMode.None,
                null,
              );
            step.dispose();
          } else {
            drawUpright(target.getCanvas(), frame, MODEL_SIZE, MODEL_SIZE);
          }
          target.flush();
          const snap = target.makeImageSnapshot();
          rgba = snap.readPixels(0, 0, {
            width: MODEL_SIZE,
            height: MODEL_SIZE,
            colorType: ColorType.RGBA_8888,
            alphaType: AlphaType.Unpremul,
          }) as Uint8Array | null;
          snap.dispose();
          if (display) {
            const ds = surfaceOf(display.width, display.height);
            drawUpright(ds.getCanvas(), frame, display.width, display.height);
            ds.flush();
            const dsnap = ds.makeImageSnapshot();
            const pixels = dsnap.readPixels(0, 0, {
              width: display.width,
              height: display.height,
              colorType: ColorType.RGBA_8888,
              alphaType: AlphaType.Unpremul,
            }) as Uint8Array | null;
            dsnap.dispose();
            if (pixels) shown = { pixels, width: display.width, height: display.height };
          }
        });
        g.__cutoutSurfaces = surfaces;
        scheduleOnRN(done, rgba, shown, rgba ? null : (failure ?? 'Não foi possível ler os pixels do quadro.'));
      } catch (e) {
        scheduleOnRN(done, null, null, String(e));
      }
    })();
  });
}

function closeReader(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve();
    runOnRuntime(readerRuntime(), () => {
      'worklet';
      const g = globalThis as unknown as ReaderGlobal;
      try {
        g.__cutoutReader?.extractor.dispose();
      } catch {
        // já fechado
      }
      g.__cutoutReader = null;
      for (const s of Object.values(g.__cutoutSurfaces ?? {})) s.dispose();
      g.__cutoutSurfaces = {};
      scheduleOnRN(done);
    })();
  });
}

function displayFor(asset: MediaAsset): { width: number; height: number } {
  const size = displaySize(asset);
  const k = Math.min(1, DISPLAY_MAX_SIDE / Math.max(size.width, size.height));
  return { width: Math.max(2, Math.round(size.width * k)), height: Math.max(2, Math.round(size.height * k)) };
}

function imageFromPixels(p: NonNullable<ReadFrame['display']>): SkImage | null {
  return Skia.Image.MakeImage(
    { width: p.width, height: p.height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(p.pixels),
    p.width * 4,
  );
}

// ------------------------------------------------------------------ sessão

/** Máscaras por segundo do rastreio (no tempo da mídia). */
export const CUTOUT_FPS = 30;

export interface CutoutTarget {
  projectId: string;
  asset: MediaAsset;
  /** Trecho da mídia a recortar. */
  from: Micros;
  to: Micros;
}

export interface CutoutPreview {
  /** Probabilidade 0..255 por célula (256x256), para mostrar o resultado. */
  mask: Uint8Array;
  /** Fração do quadro coberta (0 = não achou nada). */
  coverage: number;
}

export interface TrackProgress {
  done: number;
  total: number;
  /** Tempo médio por quadro (ms), para a estimativa. */
  msPerFrame: number;
}

/**
 * O laço sobre uma imagem parada: a imagem já passou pela rede e fica guardada,
 * então cada laço ou toque novo leva só o decodificador (rápido).
 */
export abstract class LassoSession {
  protected history: { seg: Segmentation; raw: Float32Array; final: Float32Array }[] = [];
  protected disposed = false;

  protected constructor(
    readonly image: SkImage,
    protected readonly tracker: EdgeTam,
    protected readonly feats: Features,
  ) {}

  /** Máscara para o laço e os toques. Toques refinam a tentativa anterior (como o SAM faz). */
  async predict(lasso: Point[], clicks: Click[]): Promise<CutoutPreview> {
    const prompt = buildPrompt(lasso, clicks);
    if (!prompt) throw new Error('Desenhe um laço em volta do objeto.');
    const previous = clicks.length > 0 ? (this.history[this.history.length - 1]?.raw ?? null) : null;
    const seg = await this.tracker.segment(this.feats, prompt, previous);
    const final = constrainToLasso(seg.logits, lasso, clicks);
    this.history.push({ seg, raw: seg.logits, final });
    return { mask: logitsToBytes(final), coverage: coverage(final) };
  }

  /** Volta para a tentativa anterior (desfazer um toque). */
  undo(): CutoutPreview | null {
    this.history.pop();
    const last = this.history[this.history.length - 1];
    return last ? { mask: logitsToBytes(last.final), coverage: coverage(last.final) } : null;
  }

  get hasResult(): boolean {
    return this.history.length > 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.image.dispose();
  }
}

/**
 * Recorte de um clipe de vídeo: o laço num quadro e `track` para o clipe
 * inteiro (do quadro do laço até o fim e de volta até o começo).
 */
export class CutoutSession extends LassoSession {
  private constructor(
    readonly target: CutoutTarget,
    readonly times: Micros[],
    readonly promptIndex: number,
    image: SkImage,
    tracker: EdgeTam,
    feats: Features,
    private readonly path: string,
  ) {
    super(image, tracker, feats);
  }

  /** Instante da mídia do quadro do laço (no passo do rastreio). */
  get time(): Micros {
    return this.times[this.promptIndex]!;
  }

  static async open(target: CutoutTarget, time: Micros, fps = CUTOUT_FPS): Promise<CutoutSession> {
    const s = await cutoutSessions();
    const times = trackTimes(target.from, target.to, fps);
    const p = nearestFrame(times, time);
    const path = absolutePath(target.projectId, target.asset.file);
    const at = times[p]! / 1_000_000;
    await openReader(path, Math.max(0, at - 0.05), 0.5);
    const read = await readFrame(at, displayFor(target.asset));
    const image = read.display ? imageFromPixels(read.display) : null;
    if (!image) throw new Error('Não foi possível mostrar o quadro.');
    const tracker = new EdgeTam(s, ort().Tensor);
    const feats = await tracker.encode(read.rgba);
    return new CutoutSession(target, times, p, image, tracker, feats, path);
  }

  /**
   * Rastreia o objeto no trecho inteiro e devolve uma máscara por instante de
   * `times` (0..255, 256x256, já comprimida por sequências).
   */
  async track(onProgress: (p: TrackProgress) => void, signal?: AbortSignal): Promise<Uint8Array[]> {
    const last = this.history[this.history.length - 1];
    if (!last) throw new Error('Desenhe o laço primeiro.');
    const n = this.times.length;
    const p = this.promptIndex;
    const masks: Uint8Array[] = new Array(n);
    await this.tracker.setPrompt(p, this.feats, { ...last.seg, logits: last.final });
    masks[p] = encodeRle(logitsToBytes(last.final));
    let done = 1;
    const started = Date.now();
    const report = () => onProgress({ done, total: n, msPerFrame: (Date.now() - started) / Math.max(1, done - 1) });
    report();
    const check = () => {
      if (signal?.aborted || this.disposed) throw new Error('cancelado');
    };
    // Ida: do quadro do laço até o fim (o leitor já está aberto nele).
    if (p + 1 < n) {
      await openReader(this.path, Math.max(0, this.times[p + 1]! / 1_000_000 - 0.05), (this.target.to - this.times[p + 1]!) / 1_000_000 + 0.5);
      for (let i = p + 1; i < n; i++) {
        check();
        const { rgba } = await readFrame(this.times[i]! / 1_000_000, null);
        const feats = await this.tracker.encode(rgba);
        masks[i] = encodeRle(logitsToBytes((await this.tracker.track(i, feats, 1, n)).logits));
        done++;
        report();
      }
    }
    // Volta: em blocos, porque o decodificador só anda para frente.
    const BLOCK = 8;
    for (let hi = p - 1; hi >= 0; hi -= BLOCK) {
      check();
      const lo = Math.max(0, hi - BLOCK + 1);
      const start = this.times[lo]! / 1_000_000;
      await openReader(this.path, Math.max(0, start - 0.05), (this.times[hi]! - this.times[lo]!) / 1_000_000 + 0.5);
      const block: Uint8Array[] = [];
      for (let i = lo; i <= hi; i++) block.push((await readFrame(this.times[i]! / 1_000_000, null)).rgba);
      for (let i = hi; i >= lo; i--) {
        check();
        const feats = await this.tracker.encode(block[i - lo]!);
        masks[i] = encodeRle(logitsToBytes((await this.tracker.track(i, feats, -1, n)).logits));
        done++;
        report();
      }
    }
    return masks;
  }

  override dispose(): void {
    if (this.disposed) return;
    super.dispose();
    closeReader().catch(() => {});
  }
}

/** Lado maior da figurinha gerada. */
const STICKER_MAX_SIDE = 1600;

/** Desenha `image` esticada em `w`×`h` e devolve os pixels RGBA (sem pré-multiplicar). */
function pixelsOf(image: SkImage, w: number, h: number): Uint8Array {
  const surface = Skia.Surface.MakeOffscreen(w, h);
  if (!surface) throw new Error('Não foi possível criar a superfície.');
  surface
    .getCanvas()
    .drawImageRectOptions(image, Skia.XYWHRect(0, 0, image.width(), image.height()), Skia.XYWHRect(0, 0, w, h), FilterMode.Linear, MipmapMode.Linear, null);
  surface.flush();
  const snap = surface.makeImageSnapshot();
  const pixels = snap.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array | null;
  snap.dispose();
  surface.dispose();
  if (!pixels) throw new Error('Não foi possível ler os pixels da foto.');
  return pixels;
}

/**
 * Laço numa foto (colagem): o recorte vira uma figurinha, um PNG transparente
 * cortado em volta do objeto, na resolução da foto original.
 */
export class PhotoCutoutSession extends LassoSession {
  private constructor(
    private readonly uri: string,
    private readonly width: number,
    private readonly height: number,
    image: SkImage,
    tracker: EdgeTam,
    feats: Features,
  ) {
    super(image, tracker, feats);
  }

  /** `uri` da foto inteira (com a orientação já aplicada). */
  static async open(uri: string): Promise<PhotoCutoutSession> {
    const s = await cutoutSessions();
    const full = await loadImage(uri);
    if (!full) throw new Error('Não foi possível abrir a foto.');
    try {
      const w = full.width();
      const h = full.height();
      const rgba = pixelsOf(full, MODEL_SIZE, MODEL_SIZE);
      const k = Math.min(1, DISPLAY_MAX_SIDE / Math.max(w, h));
      const dw = Math.max(2, Math.round(w * k));
      const dh = Math.max(2, Math.round(h * k));
      const image = imageFromPixels({ pixels: pixelsOf(full, dw, dh), width: dw, height: dh });
      if (!image) throw new Error('Não foi possível mostrar a foto.');
      const tracker = new EdgeTam(s, ort().Tensor);
      const feats = await tracker.encode(rgba);
      return new PhotoCutoutSession(uri, w, h, image, tracker, feats);
    } finally {
      full.dispose();
    }
  }

  /**
   * Gera a figurinha: a borda passa pelo mesmo refinamento guiado pela imagem
   * do vídeo (JBU), agora na resolução da foto. Grava em `stickers/`.
   */
  async makeSticker(collageId: string): Promise<CollageSticker> {
    const last = this.history[this.history.length - 1];
    if (!last) throw new Error('Desenhe o laço primeiro.');
    const bytes = logitsToBytes(last.final);
    const geo = stickerGeometry(bytes, this.width, this.height, STICKER_MAX_SIDE);
    if (!geo) throw new Error('O recorte ficou vazio.');
    const { crop, region: r, k, outW, outH, regionW, regionH } = geo;

    const full = await loadImage(this.uri);
    if (!full) throw new Error('Não foi possível abrir a foto.');
    const mask = Skia.Image.MakeImage(
      { width: MASK_SIZE, height: MASK_SIZE, colorType: ColorType.Gray_8, alphaType: AlphaType.Opaque },
      Skia.Data.fromBytes(bytes),
      MASK_SIZE,
    );
    const fx = fxEffect();
    const region = Skia.Surface.MakeOffscreen(regionW, regionH);
    const out = Skia.Surface.MakeOffscreen(outW, outH);
    try {
      if (!mask || !fx || !region || !out) throw new Error('Não foi possível preparar a figurinha.');
      // 1. A região da foto já reduzida (com mipmaps: sem serrilhado).
      region
        .getCanvas()
        .drawImageRectOptions(
          full,
          Skia.XYWHRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0),
          Skia.XYWHRect(0, 0, regionW, regionH),
          FilterMode.Linear,
          MipmapMode.Linear,
          null,
        );
      region.flush();
      const reduced = region.makeImageSnapshot();
      // 2. O shader do recorte nas coordenadas da foto inteira reduzida.
      const local = Skia.Matrix();
      local.translate(r.x0 * k, r.y0 * k);
      const imageShader = reduced.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None, local);
      const maskShader = mask.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Nearest, MipmapMode.None);
      const paint = Skia.Paint();
      paint.setShader(fx.makeShaderWithChildren([this.width * k, this.height * k, 0, 0, 0, 0, 0, 0, 0, 0, 1, MASK_SIZE, 0, 0, 0], [imageShader, maskShader]));
      const canvas = out.getCanvas();
      canvas.clear(Skia.Color('transparent'));
      canvas.translate(-crop.x0 * k, -crop.y0 * k);
      canvas.drawRect(Skia.XYWHRect(crop.x0 * k, crop.y0 * k, outW, outH), paint);
      out.flush();
      const snap = out.makeImageSnapshot();
      const png = snap.encodeToBytes(ImageFormat.PNG, 100);
      snap.dispose();
      reduced.dispose();
      if (!png || png.length === 0) throw new Error('Não foi possível gravar a figurinha.');
      ensureDir(new Directory(collageDir(collageId), 'stickers'));
      const id = newId('s');
      const file = `stickers/${id}.png`;
      const target = collageFile(collageId, file);
      target.create({ overwrite: true });
      target.write(png);
      return { id, file, width: outW, height: outH };
    } finally {
      full.dispose();
      mask?.dispose();
      region?.dispose();
      out?.dispose();
    }
  }
}

// ------------------------------------------------------------------ arquivo

/** Grava as máscaras (já comprimidas) no projeto e devolve o caminho relativo. */
export function saveCutoutMasks(projectId: string, from: Micros, fps: number, masks: Uint8Array[]): string {
  const dir = ensureDir(new Directory(projectDir(projectId), 'cutouts'));
  const name = `${newId('k')}.ldcut`;
  const file = new File(dir, name);
  if (file.exists) file.delete();
  file.create();
  file.write(packMaskFile({ size: MASK_SIZE, fps, from }, masks));
  return `cutouts/${name}`;
}
