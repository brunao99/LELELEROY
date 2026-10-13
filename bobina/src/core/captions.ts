/**
 * Legendas automáticas: do áudio da timeline aos itens de legenda.
 */
import { mixInto, resample } from './audio';
import { newId } from './ids';
import { clipDuration, layoutMain } from './timeline';
import type { Caption, CaptionSource, Micros, Project } from './types';

export const CAPTION_SAMPLE_RATE = 16_000;
/** Tamanho máximo de uma legenda, em caracteres (cabe em duas linhas no celular). */
export const CAPTION_MAX_CHARS = 42;

export interface WhisperSegment {
  text: string;
  /** Centésimos de segundo (unidade do whisper.cpp). */
  t0: number;
  t1: number;
}

/** Um trecho de áudio da timeline que entra na transcrição. */
export interface CaptionAudioPart {
  assetId: string;
  sourceIn: Micros;
  sourceOut: Micros;
  speed: number;
  start: Micros;
}

/** Quais áudios entram na transcrição, conforme a origem escolhida. */
export function captionParts(project: Project, source: CaptionSource): CaptionAudioPart[] {
  const parts: CaptionAudioPart[] = [];
  const wantVideo = source === 'video' || source === 'both';
  const wantVoice = source === 'voiceover' || source === 'both';
  if (wantVideo) {
    for (const slot of layoutMain(project)) {
      const asset = project.assets[slot.clip.assetId];
      if (!asset || asset.kind !== 'video' || !asset.hasAudio) continue;
      // O som do clipe conta mesmo se estiver baixo; a fala ainda está lá.
      parts.push({ ...pick(slot.clip), start: slot.start });
    }
    for (const o of project.overlays) {
      const asset = project.assets[o.assetId];
      if (asset?.kind === 'video' && asset.hasAudio && o.volume > 0) parts.push({ ...pick(o), start: o.start });
    }
  }
  for (const a of project.audios) {
    const take = (a.source === 'extract' && wantVideo) || (a.source === 'voiceover' && wantVoice);
    if (take) parts.push({ ...pick(a), start: a.start });
  }
  return parts;
}

function pick(c: { assetId: string; sourceIn: Micros; sourceOut: Micros; speed: number }) {
  return { assetId: c.assetId, sourceIn: c.sourceIn, sourceOut: c.sourceOut, speed: c.speed };
}

/**
 * Monta o áudio mono a 16 kHz da timeline inteira a partir dos trechos.
 * `decoded` tem o áudio de cada mídia, já mono a 16 kHz.
 */
export function mixCaptionAudio(
  parts: CaptionAudioPart[],
  decoded: Record<string, Float32Array>,
  totalDuration: Micros,
): Float32Array {
  const rate = CAPTION_SAMPLE_RATE;
  const out = new Float32Array(Math.ceil((totalDuration / 1_000_000) * rate));
  for (const part of parts) {
    const pcm = decoded[part.assetId];
    if (!pcm) continue;
    const a = Math.round((part.sourceIn / 1_000_000) * rate);
    const b = Math.round((part.sourceOut / 1_000_000) * rate);
    const piece = pcm.subarray(Math.max(0, a), Math.min(pcm.length, b));
    // Para reconhecer a fala basta acelerar por reamostragem.
    const timed = part.speed === 1 ? piece : resample(piece, part.speed);
    const length = Math.min(timed.length, Math.round((clipDuration(part) / 1_000_000) * rate));
    mixInto(out, timed.subarray(0, length), Math.round((part.start / 1_000_000) * rate));
  }
  // Evita estourar quando vozes se sobrepõem.
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]!));
  if (peak > 1) for (let i = 0; i < out.length; i++) out[i]! /= peak;
  return out;
}

const NOISE = /^\s*[[(].*[\])]\s*$/;

/** Limpa o texto de um segmento do Whisper. Devolve vazio para "[música]", "(risos)" e afins. */
export function cleanSegmentText(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || NOISE.test(t) || /^[.,!?…♪\s-]+$/.test(t)) return '';
  return t;
}

/**
 * Segmentos do Whisper → legendas. Junta pedaços curtos demais, corta sobreposições
 * e limita ao fim do vídeo.
 */
export function segmentsToCaptions(segments: WhisperSegment[], totalDuration: Micros): Caption[] {
  const out: Caption[] = [];
  for (const seg of segments) {
    const text = cleanSegmentText(seg.text);
    if (!text) continue;
    let start = Math.max(0, Math.round(seg.t0 * 10_000));
    let end = Math.min(totalDuration, Math.round(seg.t1 * 10_000));
    if (end - start < 300_000) end = Math.min(totalDuration, start + 300_000);
    const prev = out[out.length - 1];
    if (prev && start < prev.end) start = prev.end;
    if (end <= start) continue;
    // Junta com a anterior se ficarem coladas e curtas.
    if (prev && start - prev.end < 50_000 && prev.text.length + text.length + 1 <= CAPTION_MAX_CHARS / 2) {
      out[out.length - 1] = { ...prev, end, text: `${prev.text} ${text}` };
      continue;
    }
    out.push({ id: newId('s'), start, end, text });
  }
  return out;
}

export interface CaptionLanguage {
  code: string;
  name: string;
}

export const CAPTION_LANGUAGES: CaptionLanguage[] = [
  { code: 'pt', name: 'Português' },
  { code: 'en', name: 'Inglês' },
  { code: 'es', name: 'Espanhol' },
  { code: 'fr', name: 'Francês' },
  { code: 'it', name: 'Italiano' },
  { code: 'de', name: 'Alemão' },
  { code: 'ja', name: 'Japonês' },
  { code: 'auto', name: 'Detectar' },
];

export interface WhisperModel {
  id: string;
  name: string;
  file: string;
  url: string;
  /** Tamanho aproximado para avisar antes do download. */
  megabytes: number;
}

/** Modelos multilíngues do whisper.cpp (licença MIT), baixados do Hugging Face no primeiro uso. */
export const WHISPER_MODELS: WhisperModel[] = [
  {
    id: 'base',
    name: 'Padrão',
    file: 'ggml-base-q5_1.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin',
    megabytes: 57,
  },
  {
    id: 'small',
    name: 'Mais preciso',
    file: 'ggml-small-q5_1.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin',
    megabytes: 181,
  },
];
