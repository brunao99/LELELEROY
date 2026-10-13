/**
 * Velocidade. O motor toca tudo a 1x, então um clipe com outra velocidade ganha
 * uma cópia já acelerada ("bake"): o vídeo é recodificado quadro a quadro e o
 * áudio é processado em TypeScript (reamostragem ou WSOLA, para manter o tom).
 */
import { __RNSkiaVideoPrivateAPI as SkiaVideo } from '@azzapp/react-native-skia-video';
import { BlendMode, FilterMode, MipmapMode, Skia, type SkSurface } from '@shopify/react-native-skia';
import { Directory } from 'expo-file-system';
import { createSynchronizable, createWorkletRuntime, runOnRuntime, scheduleOnRN, type WorkletRuntime } from 'react-native-worklets';

import { applyFades, applyGain, changeSpeed, encodeWav, sliceSeconds } from '@/core/audio';
import { bakeKey, type AudioRenderRequest, type BakeRequest } from '@/core/composition';
import { displaySize } from '@/core/geometry';
import type { AudioRender, Bake, MediaAsset, Project } from '@/core/types';
import { absolutePath, ensureDir, fileUri, projectDir, projectFile } from '@/storage/paths';

import { decodeFile } from './audioDecode';

const BAKE_FPS = 30;
const BAKE_MAX_SIDE = 1920;

let runtime: WorkletRuntime | null = null;
function bakeRuntime(): WorkletRuntime {
  if (!runtime) runtime = createWorkletRuntime({ name: 'BobinaBake' });
  return runtime;
}

function bakeName(request: BakeRequest): string {
  return request.key.replace(/[^a-zA-Z0-9@._-]/g, '_');
}

/** Tamanho da cópia: em pé (rotação aplicada), até 1920 no lado maior, par. */
function bakeSize(asset: MediaAsset): { width: number; height: number } {
  const size = displaySize(asset);
  const k = Math.min(1, BAKE_MAX_SIDE / Math.max(size.width, size.height));
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { width: even(size.width), height: even(size.height) };
}

/** Recodifica o trecho [from, to] da mídia tocando `speed` vezes mais rápido. Sem áudio. */
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
    runOnRuntime(bakeRuntime(), () => {
      'worklet';
      const { width, height } = size;
      let encoder: ReturnType<typeof SkiaVideo.createVideoEncoder> | null = null;
      const extractor = SkiaVideo.createVideoCompositionFramesExtractorSync(composition);
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
          { outPath, width, height, frameRate: BAKE_FPS, bitRate: Math.round(width * height * BAKE_FPS * 0.2) },
          null,
        );
        encoder.prepare();
        extractor.start();
        const canvas = surface.getCanvas();
        const pooled = SkiaVideo.runWithAutoreleasePool ?? ((fn: () => void) => fn());
        const total = Math.max(1, Math.ceil(outSeconds * BAKE_FPS));
        const target = surface;
        const enc = encoder;
        for (let i = 0; i < total; i++) {
          if (cancelled.getDirty()) return;
          const outT = i / BAKE_FPS;
          const srcT = Math.min(sourceSeconds - 1e-3, outT * speed);
          pooled(() => {
            const frames = extractor.decodeCompositionFrames(srcT);
            const frame = frames.src;
            canvas.drawColor(Skia.Color('#000000'), BlendMode.Src);
            if (frame && frame.texture) {
              const image = Skia.Image.MakeImageFromNativeTextureUnstable(frame.texture, frame.width, frame.height);
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
            target.flush(true);
            enc.encodeFrame(target.getNativeTextureUnstable(), outT);
          });
          if (i % 10 === 0) scheduleOnRN(onProgress, i / total);
        }
        encoder.finishWriting();
        scheduleOnRN(settle, null);
      } catch (e) {
        scheduleOnRN(settle, String(e));
      } finally {
        extractor.dispose();
        encoder?.dispose();
      }
    })();
  });
}

/** Processa o áudio do trecho na velocidade pedida e grava um WAV. */
async function bakeAudio(project: Project, asset: MediaAsset, request: BakeRequest, relative: string) {
  const pcm = await decodeFile(fileUri(project.id, asset.file), 44_100);
  const piece = sliceSeconds(pcm, request.from / 1_000_000, request.to / 1_000_000);
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
    await bakeVideo(absolutePath(project.id, asset.file), absolutePath(project.id, relative), job, bakeSize(asset), (f) => onProgress(wantAudio ? f * 0.8 : f), signal);
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
    from: range.from,
    to: range.to,
    videoFile,
    audioFile,
  };
}

/** Apaga as cópias aceleradas que nenhum clipe usa mais. */
export function pruneBakes(project: Project): Project {
  const used = new Set<string>();
  for (const c of [...project.main, ...project.overlays, ...project.audios]) {
    if (c.speed !== 1) used.add(bakeKey(c.assetId, c.speed, c.keepPitch));
  }
  const bakes = { ...project.bakes };
  let changed = false;
  for (const [key, bake] of Object.entries(project.bakes)) {
    if (used.has(key)) continue;
    for (const relative of [bake.videoFile, bake.audioFile]) {
      if (!relative) continue;
      const file = projectFile(project.id, relative);
      if (file.exists) file.delete();
    }
    delete bakes[key];
    changed = true;
  }
  return changed ? { ...project, bakes } : project;
}

export function bakeFileExists(project: Project, bake: Bake): boolean {
  return [bake.videoFile, bake.audioFile].every((relative) => !relative || projectFile(project.id, relative).exists);
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
  const piece = sliceSeconds(pcm, request.sourceIn / 1_000_000, request.sourceOut / 1_000_000);
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

/** Apaga os áudios processados que nenhum clipe usa mais. */
export function pruneAudioRenders(project: Project, usedKeys: Set<string>): Project {
  let changed = false;
  const renders = { ...project.audioRenders };
  for (const [key, render] of Object.entries(project.audioRenders)) {
    if (usedKeys.has(key)) continue;
    const file = projectFile(project.id, render.file);
    if (file.exists) file.delete();
    delete renders[key];
    changed = true;
  }
  return changed ? { ...project, audioRenders: renders } : project;
}
