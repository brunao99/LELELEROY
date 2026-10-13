/**
 * Importar mídia para dentro do projeto. O app guarda cópias: apagar da galeria
 * depois não quebra o projeto.
 */
import { __RNSkiaVideoPrivateAPI } from '@azzapp/react-native-skia-video';
import { Directory, File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { getAudioDuration } from 'react-native-audio-api';
import { createWorkletRuntime, runOnRuntime, scheduleOnRN, type WorkletRuntime } from 'react-native-worklets';

import { newId } from '@/core/ids';
import type { MediaAsset, Micros, Rotation } from '@/core/types';

import { ensureDir, projectDir, projectFile, toPlainPath } from './paths';

export interface PickedMedia {
  uri: string;
  kind: 'video' | 'image' | 'audio';
  name: string;
  width?: number;
  height?: number;
  /** Milissegundos (o que os seletores devolvem). */
  durationMs?: number | null;
}

const ISO_BMFF = ['mp4', 'mov', 'm4v', '3gp', 'qt'];
const MAX_IMAGE_SIDE = 4096;

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1]!.toLowerCase() : '';
}

/**
 * Vídeos MOV/MP4 viram `.mp4`: é o mesmo formato (ISO-BMFF) e o decodificador de
 * áudio escolhe o FFmpeg pela extensão.
 */
export function storedExtension(kind: PickedMedia['kind'], name: string, uri: string): string {
  const ext = extensionOf(name) || extensionOf(uri);
  if (kind === 'image') return 'jpg';
  if (kind === 'video') return !ext || ISO_BMFF.includes(ext) ? 'mp4' : ext;
  return ext || 'm4a';
}

interface VideoProbe {
  width: number;
  height: number;
  rotation: Rotation;
  duration: Micros;
}

function normalizeRotation(value: number): Rotation {
  const r = ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  return r as Rotation;
}

let probeRuntime: WorkletRuntime | null = null;

/**
 * Largura, altura e rotação do primeiro quadro, decodificado pelo mesmo motor que
 * vai desenhar o vídeo. No Android o motor já entrega o quadro em pé (rotação 0,
 * medidas trocadas); no iOS entrega a rotação. Guardar o que o motor diz deixa o
 * enquadramento igual ao desenho nas duas plataformas.
 */
export function probeFirstFrame(path: string, timeoutMs = 10_000): Promise<{ width: number; height: number; rotation: Rotation } | null> {
  if (!probeRuntime) probeRuntime = createWorkletRuntime({ name: 'BobinaProbe' });
  const runtime = probeRuntime;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: { width: number; height: number; rotation: number } | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value && value.width > 0 && value.height > 0 ? { ...value, rotation: normalizeRotation(value.rotation) } : null);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    runOnRuntime(runtime, () => {
      'worklet';
      let extractor: ReturnType<typeof __RNSkiaVideoPrivateAPI.createVideoCompositionFramesExtractorSync> | null = null;
      try {
        extractor = __RNSkiaVideoPrivateAPI.createVideoCompositionFramesExtractorSync({
          duration: 0.5,
          items: [{ id: 'probe', path, compositionStartTime: 0, startTime: 0, duration: 0.5 }],
        });
        extractor.start();
        const frame = extractor.decodeCompositionFrames(0.04).probe;
        scheduleOnRN(finish, frame ? { width: frame.width, height: frame.height, rotation: frame.rotation } : null);
      } catch {
        scheduleOnRN(finish, null);
      } finally {
        extractor?.dispose();
      }
    })();
  });
}

/** Duração (e medidas de reserva) pelo player do motor. */
export function probeVideo(path: string, timeoutMs = 8000): Promise<VideoProbe | null> {
  return new Promise((resolve) => {
    let done = false;
    let player: ReturnType<typeof __RNSkiaVideoPrivateAPI.createVideoPlayer> | null = null;
    const finish = (value: VideoProbe | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        player?.dispose();
      } catch {
        // já liberado
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      player = __RNSkiaVideoPrivateAPI.createVideoPlayer(path, null);
      player.on('ready', (dims) => {
        const duration = Math.round((player?.duration ?? 0) * 1_000_000);
        finish({ width: dims.width, height: dims.height, rotation: normalizeRotation(dims.rotation), duration });
      });
      player.on('error', () => finish(null));
    } catch {
      finish(null);
    }
  });
}

async function hasAudioTrack(fileUri: string): Promise<boolean> {
  try {
    return (await getAudioDuration(fileUri)) > 0;
  } catch {
    return false;
  }
}

async function importImage(projectId: string, picked: PickedMedia, id: string): Promise<MediaAsset> {
  const context = ImageManipulator.manipulate(picked.uri);
  const w = picked.width ?? 0;
  const h = picked.height ?? 0;
  if (Math.max(w, h) > MAX_IMAGE_SIDE) {
    context.resize(w >= h ? { width: MAX_IMAGE_SIDE } : { height: MAX_IMAGE_SIDE });
  }
  const image = await context.renderAsync();
  // Salvar em JPEG resolve HEIC e já aplica a orientação EXIF.
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
  const relative = `media/${id}.jpg`;
  const target = projectFile(projectId, relative);
  new File(saved.uri).moveSync(target, { overwrite: true });
  return {
    id,
    kind: 'image',
    file: relative,
    duration: 0,
    width: saved.width,
    height: saved.height,
    rotation: 0,
    hasAudio: false,
    originalName: picked.name,
  };
}

/** Copia a mídia para `media/` do projeto e descobre as informações dela. */
export async function importMedia(projectId: string, picked: PickedMedia): Promise<MediaAsset> {
  ensureDir(new Directory(projectDir(projectId), 'media'));
  const id = newId('m');
  if (picked.kind === 'image') return importImage(projectId, picked, id);

  const relative = `media/${id}.${storedExtension(picked.kind, picked.name, picked.uri)}`;
  const target = projectFile(projectId, relative);
  new File(picked.uri).copySync(target, { overwrite: true });

  if (picked.kind === 'audio') {
    let seconds = (picked.durationMs ?? 0) / 1000;
    try {
      seconds = await getAudioDuration(target.uri);
    } catch {
      // fica com o que o seletor informou
    }
    if (!(seconds > 0)) throw new Error('Não foi possível ler este áudio.');
    return {
      id,
      kind: 'audio',
      file: relative,
      duration: Math.round(seconds * 1_000_000),
      width: 0,
      height: 0,
      rotation: 0,
      hasAudio: true,
      originalName: picked.name,
    };
  }

  const plain = toPlainPath(target.uri);
  const frame = await probeFirstFrame(plain);
  // A duração do seletor vem em milissegundos; sem ela, pergunta ao player do motor.
  let duration = Math.round((picked.durationMs ?? 0) * 1000);
  let fallback: Awaited<ReturnType<typeof probeVideo>> = null;
  if (!(duration > 0) || !frame) {
    fallback = await probeVideo(plain);
    if (!(duration > 0)) duration = fallback?.duration ?? 0;
  }
  if (!(duration > 0)) {
    target.delete();
    throw new Error('Não foi possível abrir este vídeo.');
  }
  return {
    id,
    kind: 'video',
    file: relative,
    duration,
    width: frame?.width || fallback?.width || picked.width || 1080,
    height: frame?.height || fallback?.height || picked.height || 1920,
    rotation: frame?.rotation ?? 0,
    hasAudio: await hasAudioTrack(target.uri),
    originalName: picked.name,
  };
}
