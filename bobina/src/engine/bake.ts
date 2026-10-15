/**
 * Velocidade. O motor toca tudo a 1x, então um clipe com outra velocidade ganha
 * uma cópia já acelerada ("bake"): o vídeo é recodificado quadro a quadro e o
 * áudio é processado em TypeScript (reamostragem ou WSOLA, para manter o tom).
 */
import { __RNSkiaVideoPrivateAPI as SkiaVideo } from '@azzapp/react-native-skia-video';
import { BlendMode, FilterMode, MipmapMode, Skia, type SkSurface } from '@shopify/react-native-skia';
import { Directory } from 'expo-file-system';
import { createSynchronizable, createWorkletRuntime, runOnRuntime, scheduleOnRN, type WorkletRuntime } from 'react-native-worklets';

import { applyFades, applyGain, changeSpeed, encodeWav, reversePcm, sliceSeconds } from '@/core/audio';
import type { AudioRenderRequest, BakeRequest } from '@/core/composition';
import { displaySize } from '@/core/geometry';
import type { AudioRender, Bake, MediaAsset, Project } from '@/core/types';
import { absolutePath, ensureDir, fileUri, projectDir, projectFile } from '@/storage/paths';

import { decodeFile } from './audioDecode';
import { encoderConfig } from './exporter';

/**
 * A cópia acelerada mantém a resolução da mídia (até 4K) e grava a 60 qps, para
 * não perder nitidez nem fluidez numa exportação em 2K/4K ou a 60 qps. O
 * codificador do aparelho pode pedir menos (ver encoderConfig).
 */
const BAKE_FPS = 60;
const BAKE_MAX_SIDE = 3840;
/**
 * A cópia invertida guarda um bloco de quadros na memória antes de gravá-los ao
 * contrário (o decodificador só anda para frente). Por isso fica em até 1440p e
 * os blocos cabem em ~190 MB.
 */
const REVERSE_MAX_SIDE = 2560;
const REVERSE_BLOCK_BYTES = 190_000_000;

let runtime: WorkletRuntime | null = null;
function bakeRuntime(): WorkletRuntime {
  if (!runtime) runtime = createWorkletRuntime({ name: 'BobinaBake' });
  return runtime;
}

function bakeName(request: BakeRequest): string {
  return request.key.replace(/[^a-zA-Z0-9@._-]/g, '_');
}

/** Tamanho da cópia: em pé (rotação aplicada), até o limite no lado maior, par. */
function bakeSize(asset: MediaAsset, maxSide = BAKE_MAX_SIDE): { width: number; height: number } {
  const size = displaySize(asset);
  const k = Math.min(1, maxSide / Math.max(size.width, size.height));
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { width: even(size.width), height: even(size.height) };
}

/** Desenha o quadro em pé, ocupando a superfície inteira. */
export function drawUpright(
  canvas: ReturnType<SkSurface['getCanvas']>,
  frame: { texture: unknown; width: number; height: number; rotation: number } | undefined,
  width: number,
  height: number,
) {
  'worklet';
  canvas.drawColor(Skia.Color('#000000'), BlendMode.Src);
  if (!frame || !frame.texture) return;
  const image = Skia.Image.MakeImageFromNativeTextureUnstable(frame.texture as never, frame.width, frame.height);
  const r = ((Math.round(frame.rotation / 90) * 90) % 360 + 360) % 360;
  const turned = r === 90 || r === 270;
  const dispW = turned ? frame.height : frame.width;
  const dispH = turned ? frame.width : frame.height;
  canvas.save();
  canvas.scale(width / dispW, height / dispH);
  if (r === 90) {
    canvas.translate(frame.height, 0);
    canvas.rotate(90, 0, 0);
  } else if (r === 180) {
    canvas.translate(frame.width, frame.height);
    canvas.rotate(180, 0, 0);
  } else if (r === 270) {
    canvas.translate(0, frame.width);
    canvas.rotate(270, 0, 0);
  }
  const rect = Skia.XYWHRect(0, 0, frame.width, frame.height);
  canvas.drawImageRectOptions(image, rect, rect, FilterMode.Linear, MipmapMode.None, Skia.Paint());
  canvas.restore();
  image.dispose();
}

/**
 * Recodifica o trecho [from, to] da mídia tocando `speed` vezes mais rápido, e
 * de trás para frente se pedido. Sem áudio.
 */
function bakeVideo(
  sourcePath: string,
  outPath: string,
  request: BakeRequest,
  size: { width: number; height: number },
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const sourceSeconds = (request.to - request.from) / 1_000_000;
  const outSeconds = sourceSeconds / request.speed;
  const composition = {
    duration: sourceSeconds,
    items: [{ id: 'src', path: sourcePath, compositionStartTime: 0, startTime: request.from / 1_000_000, duration: sourceSeconds }],
  };
  const speed = request.speed;
  const reverse = request.reverse;
  const fromSeconds = request.from / 1_000_000;
  const blockBytes = REVERSE_BLOCK_BYTES;
  return new Promise((resolve, reject) => {
    const cancelled = createSynchronizable(false);
    const onAbort = () => {
      cancelled.setBlocking(true);
      reject(new Error('cancelado'));
    };
    signal?.addEventListener('abort', onAbort);
    const settle = (error: string | null) => {
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(new Error(error));
      else resolve();
    };
    const config = encoderConfig(size.width, size.height, BAKE_FPS, Math.min(60_000_000, Math.round(size.width * size.height * BAKE_FPS * 0.15)));
    runOnRuntime(bakeRuntime(), () => {
      'worklet';
      const { width, height, fps, bitRate, encoderName } = config;
      let encoder: ReturnType<typeof SkiaVideo.createVideoEncoder> | null = null;
      // O caminho invertido abre um extrator por bloco; o normal usa um só.
      const extractor = reverse ? null : SkiaVideo.createVideoCompositionFramesExtractorSync(composition);
      try {
        const cache = globalThis as unknown as { __bakeSurface?: SkSurface | null; __bakeW?: number; __bakeH?: number };
        let surface = cache.__bakeSurface ?? null;
        if (!surface || cache.__bakeW !== width || cache.__bakeH !== height) {
          surface?.dispose();
          surface = Skia.Surface.MakeOffscreen(width, height);
          if (!surface) throw new Error('Não foi possível criar a superfície.');
          cache.__bakeSurface = surface;
          cache.__bakeW = width;
          cache.__bakeH = height;
        }
        encoder = SkiaVideo.createVideoEncoder(
          { outPath, width, height, frameRate: fps, bitRate, encoderName },
          null,
        );
        encoder.prepare();
        const canvas = surface.getCanvas();
        const pooled = SkiaVideo.runWithAutoreleasePool ?? ((fn: () => void) => fn());
        const total = Math.max(1, Math.ceil(outSeconds * fps));
        const target = surface;
        const enc = encoder;
        if (extractor) {
          extractor.start();
          for (let i = 0; i < total; i++) {
            if (cancelled.getDirty()) return;
            const outT = i / fps;
            const srcT = Math.min(sourceSeconds - 1e-3, outT * speed);
            pooled(() => {
              drawUpright(canvas, extractor.decodeCompositionFrames(srcT).src, width, height);
              target.flush(true);
              enc.encodeFrame(target.getNativeTextureUnstable(), outT);
            });
            if (i % 10 === 0) scheduleOnRN(onProgress, i / total);
          }
        } else {
          // De trás para frente, em blocos: cada bloco é decodificado para a frente
          // (com um extrator que começa nele), guardado e gravado ao contrário.
          const perBlock = Math.max(4, Math.min(48, Math.floor(blockBytes / (width * height * 4))));
          const srcAt = (i: number) => Math.max(0, Math.min(sourceSeconds - 1e-3, sourceSeconds - 1e-3 - (i / fps) * speed));
          for (let first = 0; first < total; first += perBlock) {
            if (cancelled.getDirty()) return;
            const last = Math.min(total, first + perBlock);
            const low = srcAt(last - 1);
            const high = srcAt(first);
            const span = high - low + 0.25;
            const block = SkiaVideo.createVideoCompositionFramesExtractorSync({
              duration: span,
              items: [{ id: 'src', path: sourcePath, compositionStartTime: 0, startTime: fromSeconds + low, duration: span }],
            });
            const shots: ReturnType<SkSurface['makeImageSnapshot']>[] = [];
            try {
              block.start();
              // Do quadro mais antigo para o mais novo (é como o decodificador anda).
              for (let i = last - 1; i >= first; i--) {
                const local = srcAt(i) - low;
                pooled(() => {
                  drawUpright(canvas, block.decodeCompositionFrames(local).src, width, height);
                  target.flush(true);
                  shots.push(target.makeImageSnapshot());
                });
              }
            } finally {
              block.dispose();
            }
            // shots[k] é o quadro de saída `last - 1 - k`: grava na ordem da saída.
            for (let i = first; i < last; i++) {
              const shot = shots[last - 1 - i]!;
              pooled(() => {
                canvas.drawImage(shot, 0, 0);
                target.flush(true);
                enc.encodeFrame(target.getNativeTextureUnstable(), i / fps);
              });
            }
            for (const shot of shots) shot.dispose();
            scheduleOnRN(onProgress, last / total);
          }
        }
        encoder.finishWriting();
        scheduleOnRN(settle, null);
      } catch (e) {
        scheduleOnRN(settle, String(e));
      } finally {
        extractor?.dispose();
        encoder?.dispose();
      }
    })();
  });
}

/** Processa o áudio do trecho na velocidade pedida e grava um WAV. */
async function bakeAudio(project: Project, asset: MediaAsset, request: BakeRequest, relative: string) {
  const pcm = await decodeFile(fileUri(project.id, asset.file), 44_100);
  const slice = sliceSeconds(pcm, request.from / 1_000_000, request.to / 1_000_000);
  const piece = request.reverse ? reversePcm(slice) : slice;
  const sped = changeSpeed(piece, request.speed, request.keepPitch);
  // Fades curtíssimos nas pontas evitam estalos no corte.
  applyFades(sped, 0.005, 0.005);
  const file = projectFile(project.id, relative);
  if (file.exists) file.delete();
  file.create();
  file.write(encodeWav(sped));
}

/**
 * Faz a cópia acelerada pedida. Devolve o registro para guardar em `project.bakes`.
 * `onProgress` recebe 0..1.
 */
export async function runBake(
  project: Project,
  request: BakeRequest,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Bake> {
  const asset = project.assets[request.assetId];
  if (!asset) throw new Error('Mídia não encontrada.');
  ensureDir(new Directory(projectDir(project.id), 'baked'));
  const name = bakeName(request);
  // Uma cópia anterior da mesma chave é aproveitada se já tiver o que falta.
  const previous = project.bakes[request.key];
  const covers = previous && previous.from <= request.from && previous.to >= request.to;
  const range = covers ? { from: previous.from, to: previous.to } : { from: request.from, to: request.to };
  const job: BakeRequest = { ...request, ...range };

  let videoFile = covers ? previous.videoFile : null;
  let audioFile = covers ? previous.audioFile : null;
  const wantVideo = request.needsVideo && asset.kind === 'video';
  const wantAudio = request.needsAudio && (asset.kind === 'audio' || asset.hasAudio);

  if (wantVideo && !videoFile) {
    const relative = `baked/${name}.mp4`;
    const out = projectFile(project.id, relative);
    if (out.exists) out.delete();
    const size = bakeSize(asset, request.reverse ? REVERSE_MAX_SIDE : BAKE_MAX_SIDE);
    await bakeVideo(absolutePath(project.id, asset.file), absolutePath(project.id, relative), job, size, (f) => onProgress(wantAudio ? f * 0.8 : f), signal);
    videoFile = relative;
  }
  if (wantAudio && !audioFile) {
    const relative = `baked/${name}.wav`;
    await bakeAudio(project, asset, job, relative);
    audioFile = relative;
  }
  onProgress(1);
  return {
    key: request.key,
    assetId: request.assetId,
    speed: request.speed,
    keepPitch: request.keepPitch,
    reverse: request.reverse || undefined,
    from: range.from,
    to: range.to,
    videoFile,
    audioFile,
  };
}

/** Nome de arquivo curto e estável a partir da chave (djb2). */
function shortHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Áudio de um clipe com fade (e velocidade, se houver), gravado em WAV. O WAV
 * cobre exatamente o trecho do clipe, já no tempo da timeline.
 */
export async function runAudioRender(project: Project, request: AudioRenderRequest): Promise<AudioRender> {
  const asset = project.assets[request.assetId];
  if (!asset) throw new Error('Mídia não encontrada.');
  ensureDir(new Directory(projectDir(project.id), 'rendered'));
  const pcm = await decodeFile(fileUri(project.id, asset.file), 44_100);
  const slice = sliceSeconds(pcm, request.sourceIn / 1_000_000, request.sourceOut / 1_000_000);
  const piece = request.reverse ? reversePcm(slice) : slice;
  const timed = request.speed === 1 ? piece : changeSpeed(piece, request.speed, request.keepPitch);
  applyGain(timed, request.gain);
  applyFades(timed, Math.max(0.005, request.fadeIn / 1_000_000), Math.max(0.005, request.fadeOut / 1_000_000));
  const relative = `rendered/${shortHash(request.key)}.wav`;
  const file = projectFile(project.id, relative);
  if (file.exists) file.delete();
  file.create();
  file.write(encodeWav(timed));
  return { key: request.key, file: relative };
}
