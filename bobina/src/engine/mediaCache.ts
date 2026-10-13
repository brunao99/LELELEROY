/**
 * Miniaturas (para a faixa de vídeo) e formas de onda (para a faixa de áudio),
 * geradas aos poucos e guardadas na pasta do projeto.
 */
import { Directory, File } from 'expo-file-system';
import * as VideoThumbnails from 'expo-video-thumbnails';

import { computePeaks } from '@/core/audio';
import type { MediaAsset, Micros } from '@/core/types';
import { ensureDir, fileUri, projectDir, projectFile } from '@/storage/paths';

import { decodeMono } from './audioDecode';

/** Uma miniatura a cada este intervalo da mídia. */
export const THUMB_STEP: Micros = 1_000_000;
export const PEAKS_PER_SECOND = 25;

const thumbMemory = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

function thumbKey(projectId: string, assetId: string, at: Micros) {
  return `${projectId}/${assetId}/${at}`;
}

/** Instante da miniatura mais próxima (múltiplos de THUMB_STEP). */
export function thumbTime(t: Micros): Micros {
  return Math.max(0, Math.round(t / THUMB_STEP) * THUMB_STEP);
}

/** URI da miniatura (gera se ainda não existe). Fotos usam o próprio arquivo. */
export async function thumbnail(projectId: string, asset: MediaAsset, at: Micros): Promise<string | null> {
  if (asset.kind === 'image') return fileUri(projectId, asset.file);
  if (asset.kind !== 'video') return null;
  const t = Math.min(thumbTime(at), Math.max(0, asset.duration - 50_000));
  const key = thumbKey(projectId, asset.id, t);
  const cached = thumbMemory.get(key);
  if (cached) return cached;
  const relative = `thumbs/${asset.id}/${t}.jpg`;
  const file = projectFile(projectId, relative);
  if (file.exists) {
    thumbMemory.set(key, file.uri);
    return file.uri;
  }
  const running = pending.get(key);
  if (running) return running;
  const job = (async () => {
    try {
      ensureDir(new Directory(projectDir(projectId), 'thumbs', asset.id));
      const result = await VideoThumbnails.getThumbnailAsync(fileUri(projectId, asset.file), {
        time: Math.round(t / 1000),
        quality: 0.4,
      });
      new File(result.uri).moveSync(file, { overwrite: true });
      thumbMemory.set(key, file.uri);
      return file.uri;
    } catch {
      return null;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, job);
  return job;
}

const peaksMemory = new Map<string, number[]>();

/** Picos da forma de onda da mídia inteira (PEAKS_PER_SECOND por segundo). */
export async function waveform(projectId: string, asset: MediaAsset): Promise<number[] | null> {
  const key = `${projectId}/${asset.id}`;
  const cached = peaksMemory.get(key);
  if (cached) return cached;
  const relative = `peaks/${asset.id}.json`;
  const file = projectFile(projectId, relative);
  try {
    if (file.exists) {
      const peaks = JSON.parse(await file.text()) as number[];
      peaksMemory.set(key, peaks);
      return peaks;
    }
    const rate = 2_000;
    const mono = await decodeMono(fileUri(projectId, asset.file), rate);
    const buckets = Math.max(1, Math.ceil((mono.length / rate) * PEAKS_PER_SECOND));
    const peaks = computePeaks(mono, buckets).map((v) => Math.round(v * 100) / 100);
    ensureDir(new Directory(projectDir(projectId), 'peaks'));
    if (file.exists) file.delete();
    file.create();
    file.write(JSON.stringify(peaks));
    peaksMemory.set(key, peaks);
    return peaks;
  } catch {
    return null;
  }
}

/** Esquece o cache em memória de um projeto (ao fechar o editor). */
export function forgetProjectCache(projectId: string) {
  for (const key of [...thumbMemory.keys()]) if (key.startsWith(`${projectId}/`)) thumbMemory.delete(key);
  for (const key of [...peaksMemory.keys()]) if (key.startsWith(`${projectId}/`)) peaksMemory.delete(key);
}
