/**
 * Baixar o som de um clipe em MP3: o áudio como ele toca na timeline
 * (trecho, velocidade, sentido, volume e fades), codificado no aparelho.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { encodeMp3 } from '@/core/mp3';
import type { AudioClip, MainClip, OverlayClip, Project } from '@/core/types';

import { clipPcm } from './bake';

export interface Mp3Result {
  /** Cópia no cache do app (para compartilhar). */
  file: File;
  bytes: Uint8Array;
  name: string;
  seconds: number;
}

/** Nome de arquivo seguro a partir do nome da mídia. */
export function mp3Name(original: string): string {
  const base = original.replace(/\.[a-z0-9]+$/i, '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${base || 'audio'}.mp3`;
}

export async function exportClipMp3(
  project: Project,
  clip: MainClip | OverlayClip | AudioClip,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Mp3Result> {
  const asset = project.assets[clip.assetId];
  if (!asset) throw new Error('Mídia não encontrada.');
  onProgress(0);
  const pcm = await clipPcm(project, {
    assetId: clip.assetId,
    sourceIn: clip.sourceIn,
    sourceOut: clip.sourceOut,
    speed: clip.speed,
    keepPitch: clip.keepPitch,
    reverse: !!clip.reverse,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
    // O volume do clipe vale no arquivo (mesmo abaixo de 100%).
    gain: Math.max(0.01, clip.volume),
  });
  if (signal?.aborted) throw new Error('cancelado');
  onProgress(0.1);
  const bytes = await encodeMp3(pcm, 192, (f) => onProgress(0.1 + f * 0.9), signal);
  const name = mp3Name(asset.originalName);
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  return { file, bytes, name, seconds: (pcm.channels[0]?.length ?? 0) / pcm.sampleRate };
}

/** Grava numa pasta escolhida pela pessoa (Downloads, Música…). Devolve false se ela desistir. */
export async function saveMp3ToFolder(result: Mp3Result): Promise<boolean> {
  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch {
    return false;
  }
  const target = dir.createFile(result.name, 'audio/mpeg');
  target.write(result.bytes);
  return true;
}

export async function shareMp3(result: Mp3Result): Promise<void> {
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(result.file.uri, { mimeType: 'audio/mpeg', dialogTitle: 'Compartilhar áudio', UTI: 'public.mp3' });
  }
}
