/**
 * Legendas automáticas no aparelho: Whisper (whisper.cpp) via whisper.rn.
 * O modelo é baixado uma vez; depois funciona sem internet.
 */
import { File } from 'expo-file-system';
import { initWhisper, type WhisperContext } from 'whisper.rn/index';

import { toPcm16 } from '@/core/audio';
import {
  CAPTION_MAX_CHARS,
  CAPTION_SAMPLE_RATE,
  WHISPER_MODELS,
  captionParts,
  mixCaptionAudio,
  segmentsToCaptions,
  type WhisperModel,
} from '@/core/captions';
import { projectDuration } from '@/core/timeline';
import type { Caption, CaptionSource, Project } from '@/core/types';
import { ensureDir, fileUri, modelsDir } from '@/storage/paths';

import { decodeMono } from './audioDecode';

export function modelFile(model: WhisperModel): File {
  return new File(modelsDir(), model.file);
}

export function isModelReady(model: WhisperModel): boolean {
  const file = modelFile(model);
  return file.exists && (file.size ?? 0) > 1_000_000;
}

/** Baixa o modelo (com progresso 0..1). Vai para um arquivo `.part` e só depois troca de nome. */
export async function downloadModel(
  model: WhisperModel,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<File> {
  ensureDir(modelsDir());
  const target = modelFile(model);
  if (isModelReady(model)) return target;
  const partial = new File(modelsDir(), `${model.file}.part`);
  if (partial.exists) partial.delete();
  await File.downloadFileAsync(model.url, partial, {
    idempotent: true,
    signal,
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (totalBytes > 0) onProgress(bytesWritten / totalBytes);
    },
  });
  if (target.exists) target.delete();
  partial.moveSync(target);
  return target;
}

export function deleteModel(model: WhisperModel): void {
  const file = modelFile(model);
  if (file.exists) file.delete();
}

let context: { modelId: string; ctx: WhisperContext } | null = null;

async function whisperFor(model: WhisperModel): Promise<WhisperContext> {
  if (context?.modelId === model.id) return context.ctx;
  if (context) {
    await context.ctx.release();
    context = null;
  }
  const ctx = await initWhisper({ filePath: modelFile(model).uri });
  context = { modelId: model.id, ctx };
  return ctx;
}

export interface TranscribeProgress {
  stage: 'audio' | 'transcribing';
  /** 0..1 */
  fraction: number;
}

export class NoSpeechError extends Error {
  constructor() {
    super('Nenhuma fala encontrada no áudio escolhido.');
  }
}

/**
 * Transcreve o áudio da timeline (conforme a origem) e devolve as legendas já
 * nos tempos da timeline.
 */
export async function transcribeProject(
  project: Project,
  options: { source: CaptionSource; language: string; model?: WhisperModel },
  onProgress: (p: TranscribeProgress) => void,
  signal?: AbortSignal,
): Promise<Caption[]> {
  const model = options.model ?? WHISPER_MODELS[0]!;
  const parts = captionParts(project, options.source);
  if (parts.length === 0) throw new NoSpeechError();

  // Decodifica cada mídia uma vez, já mono a 16 kHz.
  const decoded: Record<string, Float32Array> = {};
  const assetIds = [...new Set(parts.map((p) => p.assetId))];
  for (let i = 0; i < assetIds.length; i++) {
    if (signal?.aborted) throw new Error('cancelado');
    const asset = project.assets[assetIds[i]!];
    if (!asset) continue;
    try {
      decoded[asset.id] = await decodeMono(fileUri(project.id, asset.file), CAPTION_SAMPLE_RATE);
    } catch {
      // mídia sem áudio legível: fica de fora
    }
    onProgress({ stage: 'audio', fraction: (i + 1) / assetIds.length });
  }
  const total = projectDuration(project);
  const audio = mixCaptionAudio(parts, decoded, total);
  let energy = 0;
  for (let i = 0; i < audio.length; i += 64) energy = Math.max(energy, Math.abs(audio[i]!));
  if (audio.length === 0 || energy < 0.01) throw new NoSpeechError();

  const ctx = await whisperFor(model);
  const { stop, promise } = ctx.transcribeData(toPcm16(audio), {
    language: options.language,
    maxLen: CAPTION_MAX_CHARS,
    tokenTimestamps: true,
    onProgress: (percent) => onProgress({ stage: 'transcribing', fraction: percent / 100 }),
  });
  const onAbort = () => {
    stop().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort);
  try {
    const result = await promise;
    if (result.isAborted) throw new Error('cancelado');
    const captions = segmentsToCaptions(result.segments, total);
    if (captions.length === 0) throw new NoSpeechError();
    return captions;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
