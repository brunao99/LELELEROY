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
/** Uma legenda nunca fica mais que isso na tela. */
export const CAPTION_MAX_DURATION: Micros = 5_000_000;
/** Silêncio entre palavras que fecha a legenda. */
export const CAPTION_PAUSE: Micros = 600_000;

export interface WhisperToken {
  text: string;
  /** Centésimos de segundo. */
  t0: number;
  t1: number;
  /** Probabilidade do token, 0..1. */
  p: number;
}

export interface WhisperSegment {
  text: string;
  /** Centésimos de segundo (unidade do whisper.cpp). */
  t0: number;
  t1: number;
  /** Tokens de texto com tempo e probabilidade, quando o motor devolve. */
  tokens?: WhisperToken[];
}

/** Trecho com fala, detectado pelo VAD (já em microssegundos). */
export interface SpeechRange {
  start: Micros;
  end: Micros;
}

/** Palavra reconhecida, com tempo e confiança. */
export interface SpokenWord {
  text: string;
  start: Micros;
  end: Micros;
  /** Confiança média dos pedaços da palavra, 0..1. */
  p: number;
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

// ---------------------------------------------------------------- tokens → palavras

const CS: Micros = 10_000;

/** Tokens especiais que o motor às vezes deixa passar ("[_BEG_]", "[_TT_123]"…). */
const SPECIAL_TOKEN = /^\s*\[_[A-Z]+_?\d*\]\s*$/;

/**
 * Junta os tokens em palavras: um token que começa com espaço abre palavra nova;
 * os outros são pedaços da palavra anterior (o Whisper parte "transcrição" em
 * "trans" + "cr" + "ição"). Sem tokens, divide o texto do segmento e reparte o
 * tempo pelo tamanho de cada palavra.
 */
export function segmentsToWords(segments: WhisperSegment[]): SpokenWord[] {
  const words: SpokenWord[] = [];
  for (const seg of segments) {
    const tokens = seg.tokens?.filter((t) => t.text && !SPECIAL_TOKEN.test(t.text));
    if (!tokens || tokens.length === 0) {
      words.push(...spreadSegment(seg));
      continue;
    }
    let current: { text: string; start: number; end: number; ps: number[] } | null = null;
    const flush = () => {
      if (!current) return;
      const text = current.text.trim();
      if (text) {
        const p = current.ps.reduce((sum, v) => sum + v, 0) / current.ps.length;
        words.push({ text, start: current.start * CS, end: Math.max(current.start, current.end) * CS, p });
      }
      current = null;
    };
    for (const token of tokens) {
      const startsWord = /^\s/.test(token.text);
      const isPunctuation = /^[\p{P}\s]+$/u.test(token.text) && !/^\s*[[(¿¡"“'«]/.test(token.text);
      if (current && !startsWord) {
        current.text += token.text;
        current.end = Math.max(current.end, token.t1);
        // Pontuação colada não pesa na confiança da palavra.
        if (!isPunctuation) current.ps.push(token.p);
        continue;
      }
      flush();
      current = { text: token.text, start: token.t0, end: token.t1, ps: isPunctuation ? [1] : [token.p] };
    }
    flush();
  }
  return words;
}

function spreadSegment(seg: WhisperSegment): SpokenWord[] {
  const text = cleanSegmentText(seg.text);
  if (!text) return [];
  const parts = text.split(' ');
  const total = parts.reduce((n, w) => n + w.length, 0) || 1;
  const span = Math.max(0, seg.t1 - seg.t0) * CS;
  let t = seg.t0 * CS;
  return parts.map((w) => {
    const d = (span * w.length) / total;
    const word = { text: w, start: Math.round(t), end: Math.round(t + d), p: 0.6 };
    t += d;
    return word;
  });
}

// ---------------------------------------------------------------- limpeza

/** Frases que o Whisper inventa em silêncio ou música (vindas das legendas com que foi treinado). */
const HALLUCINATIONS = [
  'amara.org',
  'legendas pela comunidade',
  'legenda adriana zanotto',
  'legendado por',
  'legendas por',
  'tradução e legendas',
  'subtitles by',
  'subtítulos realizados por',
  'subtítulos por la comunidad',
  'sous-titres réalisés',
  'untertitel im auftrag',
  'untertitel der amara',
];
/** Só são descartadas quando aparecem sozinhas, fora de fala detectada ou com pouca confiança. */
const WEAK_HALLUCINATIONS = [
  'obrigado por assistir',
  'obrigada por assistir',
  'obrigado pela atenção',
  'inscreva-se no canal',
  'se inscreva no canal',
  'thank you for watching',
  'thanks for watching',
  'please subscribe',
  'gracias por ver',
  'suscríbete',
  'tchau tchau',
  'até a próxima',
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}.\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const NORMALIZED_STRONG = HALLUCINATIONS.map(normalize);
const NORMALIZED_WEAK = WEAK_HALLUCINATIONS.map(normalize);

/** Quanto de [start, end) cai dentro de fala (0..1). Sem VAD, tudo conta como fala. */
export function speechOverlap(start: Micros, end: Micros, speech: SpeechRange[] | null, pad: Micros = 0): number {
  if (!speech) return 1;
  const length = Math.max(1, end - start);
  let covered = 0;
  for (const r of speech) {
    const a = Math.max(start, r.start - pad);
    const b = Math.min(end, r.end + pad);
    if (b > a) covered += b - a;
  }
  return Math.min(1, covered / length);
}

/**
 * Tira o que não é fala: marcas de som ("[Música]", "(risos)", "♪"), frases
 * inventadas pelo modelo, segmentos com confiança baixa, palavras soltas fora da
 * fala detectada e repetições em laço.
 */
export function cleanSegments(segments: WhisperSegment[], speech: SpeechRange[] | null): WhisperSegment[] {
  const out: WhisperSegment[] = [];
  for (const seg of segments) {
    const text = normalize(seg.text);
    if (!text || NORMALIZED_STRONG.some((h) => text.includes(h))) continue;
    const tokens = seg.tokens?.filter((t) => /[\p{L}\p{N}]/u.test(t.text));
    const confidence = tokens && tokens.length > 0 ? tokens.reduce((n, t) => n + t.p, 0) / tokens.length : 0.6;
    const inSpeech = speechOverlap(seg.t0 * CS, seg.t1 * CS, speech, 200_000);
    if (NORMALIZED_WEAK.some((h) => text === h || text.replace(/[.\s]+$/, '') === h) && (inSpeech < 0.5 || confidence < 0.6)) {
      continue;
    }
    // Segmento quase todo fora da fala e pouco confiável: é ruído lido como texto.
    if (confidence < 0.35 || (inSpeech < 0.2 && confidence < 0.7)) continue;
    out.push(seg);
  }
  return out;
}

const BRACKET_OPEN = /^[[(♪*]/;
const BRACKET_CLOSE = /[\])♪*][.,!?]*$/;

/** Limpa a lista de palavras (marcas de som, palavras soltas no ruído, laços). */
export function cleanWords(words: SpokenWord[], speech: SpeechRange[] | null): SpokenWord[] {
  const kept: SpokenWord[] = [];
  let inBracket = false;
  for (const w of words) {
    if (inBracket || BRACKET_OPEN.test(w.text)) {
      inBracket = !BRACKET_CLOSE.test(w.text);
      continue;
    }
    if (!/[\p{L}\p{N}]/u.test(w.text)) {
      // Pontuação solta vai para a palavra anterior.
      const prev = kept[kept.length - 1];
      if (prev && /^[.,!?…;:]+$/.test(w.text)) kept[kept.length - 1] = { ...prev, text: prev.text + w.text };
      continue;
    }
    if (speechOverlap(w.start, Math.max(w.end, w.start + 1), speech, 250_000) === 0) continue;
    kept.push(w);
  }
  // Palavra isolada (pausa longa dos dois lados) e pouco confiável: tosse, batida, respiração.
  const isolated = kept.filter((w, i) => {
    const prev = kept[i - 1];
    const next = kept[i + 1];
    const alone = (!prev || w.start - prev.end > 1_000_000) && (!next || next.start - w.end > 1_000_000);
    return !(alone && w.p < 0.4);
  });
  return collapseLoops(isolated);
}

/** Corta repetições em laço (a mesma sequência de 1 a 4 palavras 4 vezes ou mais seguidas). */
function collapseLoops(words: SpokenWord[]): SpokenWord[] {
  const key = (w: SpokenWord) => normalize(w.text).replace(/[.\s]/g, '');
  let list = words;
  for (let n = 1; n <= 4; n++) {
    const out: SpokenWord[] = [];
    let i = 0;
    while (i < list.length) {
      let reps = 1;
      while (i + (reps + 1) * n <= list.length) {
        let same = true;
        for (let k = 0; k < n && same; k++) same = key(list[i + k]!) === key(list[i + reps * n + k]!);
        if (!same) break;
        reps++;
      }
      if (reps >= 4) {
        out.push(...list.slice(i, i + n));
        i += reps * n;
      } else {
        out.push(list[i]!);
        i++;
      }
    }
    list = out;
  }
  return list;
}

// ---------------------------------------------------------------- palavras → legendas

/** Palavras que não deveriam fechar uma legenda (ficam com a palavra seguinte). */
const LEAD_WORDS = new Set(
  (
    'a o as os um uma uns umas de do da dos das no na nos nas em ao aos à às e ou mas que se por pra para pro com sem ' +
    'como quando onde porque meu minha seu sua nosso nossa esse essa este esta isso aquele aquela muito mais menos ' +
    'the an of to in on at for with and or but if as by from my your our is are ' +
    'el la los las un una del al y en con por para pero mi tu su le les du des et ou mais'
  ).split(' '),
);

function bare(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function joined(words: SpokenWord[]): string {
  return words.map((w) => w.text).join(' ');
}

const endsSentence = (w: SpokenWord) => /[.!?…]["”»]?$/.test(w.text);
const endsClause = (w: SpokenWord) => /[,;:]["”»]?$/.test(w.text);

/**
 * Onde quebrar um grupo que passou do limite: depois de pontuação, de
 * preferência; nunca deixando no fim uma palavra como "de" ou "que"; e o mais
 * cheio possível. Devolve quantas palavras ficam na legenda atual.
 */
function bestBreak(group: SpokenWord[]): number {
  let best = group.length - 1;
  let bestScore = -Infinity;
  const total = joined(group).length;
  for (let k = group.length - 1; k >= 1; k--) {
    const last = group[k - 1]!;
    const left = joined(group.slice(0, k)).length;
    let score = left / total; // mais cheio é melhor
    if (endsSentence(last)) score += 3;
    else if (endsClause(last)) score += 2;
    if (LEAD_WORDS.has(bare(last.text))) score -= 2;
    const gap = group[k]!.start - last.end;
    score += Math.min(1, gap / 300_000); // uma pausa pequena também é um bom lugar
    if (left < total * 0.3) score -= 2; // não deixa uma legenda de uma palavra só
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
  }
  return best;
}

export interface CaptionLayoutOptions {
  maxChars?: number;
  maxDuration?: Micros;
  pause?: Micros;
}

/**
 * Agrupa as palavras em legendas: quebra em pausas, no fim de frases e quando
 * passa do tamanho ou do tempo máximo, sempre entre palavras.
 */
export function wordsToCaptions(words: SpokenWord[], totalDuration: Micros, options: CaptionLayoutOptions = {}): Caption[] {
  const maxChars = options.maxChars ?? CAPTION_MAX_CHARS;
  const maxDuration = options.maxDuration ?? CAPTION_MAX_DURATION;
  const pause = options.pause ?? CAPTION_PAUSE;

  // Tempos em ordem e dentro do vídeo.
  const clean: SpokenWord[] = [];
  for (const w of words) {
    const prev = clean[clean.length - 1];
    const start = Math.max(0, prev ? Math.max(w.start, prev.end) : w.start);
    const end = Math.min(totalDuration, Math.max(w.end, start + 80_000));
    if (start >= totalDuration) break;
    clean.push({ ...w, start, end });
  }

  const groups: SpokenWord[][] = [];
  let current: SpokenWord[] = [];
  for (const w of clean) {
    if (current.length > 0) {
      const last = current[current.length - 1]!;
      const length = joined(current).length;
      const gap = w.start - last.end;
      const tooLong = length + 1 + w.text.length > maxChars || w.end - current[0]!.start > maxDuration;
      if (gap >= pause || (endsSentence(last) && length >= 12) || (endsClause(last) && length >= maxChars * 0.6)) {
        groups.push(current);
        current = [];
      } else if (tooLong) {
        const withNext = [...current, w];
        const k = bestBreak(withNext);
        groups.push(withNext.slice(0, k));
        current = withNext.slice(k);
        continue;
      }
    }
    current.push(w);
  }
  if (current.length > 0) groups.push(current);

  const captions: Caption[] = groups.map((g) => ({
    id: newId('s'),
    start: g[0]!.start,
    end: g[g.length - 1]!.end,
    text: joined(g),
    words: g.map((w) => ({ text: w.text, start: w.start, end: w.end })),
  }));
  // Um respiro no fim de cada legenda e um tempo mínimo de leitura, sem invadir a próxima.
  for (let i = 0; i < captions.length; i++) {
    const c = captions[i]!;
    const limit = i + 1 < captions.length ? captions[i + 1]!.start : totalDuration;
    const wanted = Math.max(c.end + 200_000, c.start + 800_000);
    c.end = Math.max(c.end, Math.min(limit, wanted));
  }
  return captions.filter((c) => c.end > c.start);
}

/** Do resultado do Whisper às legendas: limpa, separa em palavras e agrupa. */
export function segmentsToCaptions(
  segments: WhisperSegment[],
  totalDuration: Micros,
  speech: SpeechRange[] | null = null,
  options?: CaptionLayoutOptions,
): Caption[] {
  const words = cleanWords(segmentsToWords(cleanSegments(segments, speech)), speech);
  return wordsToCaptions(words, totalDuration, options);
}

/** Do VAD (centésimos de segundo) para trechos em microssegundos, ordenados e unidos. */
export function vadToSpeech(segments: { t0: number; t1: number }[]): SpeechRange[] {
  const ranges = segments
    .map((s) => ({ start: Math.round(s.t0 * CS), end: Math.round(s.t1 * CS) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const merged: SpeechRange[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

/**
 * Silencia o áudio fora da fala (com uma margem), para o modelo não "ler"
 * música e ruído como palavras. Muda o array recebido.
 */
export function gateToSpeech(audio: Float32Array, speech: SpeechRange[], pad: Micros = 300_000): void {
  const rate = CAPTION_SAMPLE_RATE;
  const toSample = (t: Micros) => Math.max(0, Math.min(audio.length, Math.round((t / 1_000_000) * rate)));
  const fade = Math.round(0.05 * rate);
  let cursor = 0;
  for (const r of speech) {
    const a = toSample(r.start - pad);
    const b = toSample(r.end + pad);
    silence(audio, cursor, a, fade);
    cursor = Math.max(cursor, b);
  }
  silence(audio, cursor, audio.length, fade);
}

function silence(audio: Float32Array, from: number, to: number, fade: number): void {
  if (to <= from) return;
  for (let i = from; i < to; i++) {
    // Rampa curta nas bordas que encostam na fala, para não criar estalos que viram "palavras".
    const left = from > 0 ? i - from : Infinity;
    const right = to < audio.length ? to - 1 - i : Infinity;
    const edge = Math.min(left, right);
    audio[i] = edge < fade ? audio[i]! * (1 - edge / fade) : 0;
  }
}

/**
 * Prepara a voz para o modelo: tira o grave (ronco, vento) e normaliza o volume,
 * porque fala baixa é reconhecida pior. Muda o array recebido.
 */
export function prepareSpeechAudio(audio: Float32Array): void {
  // Passa-altas de 1ª ordem em ~80 Hz.
  const rc = 1 / (2 * Math.PI * 80);
  const dt = 1 / CAPTION_SAMPLE_RATE;
  const alpha = rc / (rc + dt);
  let prevIn = 0;
  let prevOut = 0;
  let peak = 0;
  for (let i = 0; i < audio.length; i++) {
    const x = audio[i]!;
    const y = alpha * (prevOut + x - prevIn);
    prevIn = x;
    prevOut = y;
    audio[i] = y;
    peak = Math.max(peak, Math.abs(y));
  }
  if (peak > 0.001) {
    const gain = Math.min(8, 0.9 / peak);
    for (let i = 0; i < audio.length; i++) audio[i]! *= gain;
  }
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
    name: 'Rápido',
    file: 'ggml-base-q5_1.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin',
    megabytes: 57,
  },
  {
    id: 'small',
    name: 'Preciso',
    file: 'ggml-small-q5_1.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin',
    megabytes: 181,
  },
];

/** Detector de voz Silero (licença MIT), para separar fala de música e ruído. Menos de 1 MB. */
export const VAD_MODEL: WhisperModel = {
  id: 'vad',
  name: 'Detector de voz',
  file: 'ggml-silero-v5.1.2.bin',
  url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin',
  megabytes: 1,
};

/**
 * Frase de partida por idioma: mostra ao modelo um texto com pontuação e
 * maiúsculas, e ele tende a escrever do mesmo jeito.
 */
export const CAPTION_PROMPTS: Record<string, string> = {
  pt: 'Olá, tudo bem? Hoje eu vou mostrar como ficou. Vamos lá!',
  en: "Hi, how are you? Today I'm going to show you how it turned out. Let's go!",
  es: 'Hola, ¿qué tal? Hoy les voy a mostrar cómo quedó. ¡Vamos!',
  fr: "Salut, ça va ? Aujourd'hui, je vais vous montrer le résultat. C'est parti !",
  it: 'Ciao, come va? Oggi vi faccio vedere com’è venuto. Andiamo!',
  de: 'Hallo, wie geht’s? Heute zeige ich euch, wie es geworden ist. Los geht’s!',
};
