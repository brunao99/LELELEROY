/**
 * Processamento de áudio em TypeScript puro (Float32, −1..1).
 * Usado para: velocidade com e sem manter o tom, fades, legendas (16 kHz mono),
 * forma de onda e gravação de WAV.
 */

export interface PcmBuffer {
  sampleRate: number;
  /** Um Float32Array por canal, todos do mesmo tamanho. */
  channels: Float32Array[];
}

export function frameCount(buffer: PcmBuffer): number {
  return buffer.channels[0]?.length ?? 0;
}

export function durationSeconds(buffer: PcmBuffer): number {
  return buffer.sampleRate > 0 ? frameCount(buffer) / buffer.sampleRate : 0;
}

/** Média dos canais. */
export function toMono(buffer: PcmBuffer): Float32Array {
  const n = frameCount(buffer);
  const count = buffer.channels.length;
  if (count === 1) return buffer.channels[0]!.slice();
  const out = new Float32Array(n);
  for (const ch of buffer.channels) for (let i = 0; i < n; i++) out[i]! += ch[i]! / count;
  return out;
}

/** Trecho [fromSec, toSec) de um buffer. */
export function sliceSeconds(buffer: PcmBuffer, fromSec: number, toSec: number): PcmBuffer {
  const n = frameCount(buffer);
  const a = Math.max(0, Math.min(n, Math.round(fromSec * buffer.sampleRate)));
  const b = Math.max(a, Math.min(n, Math.round(toSec * buffer.sampleRate)));
  return { sampleRate: buffer.sampleRate, channels: buffer.channels.map((c) => c.slice(a, b)) };
}

/**
 * Muda a duração por interpolação linear: tocar `speed` vezes mais rápido.
 * O tom muda junto (voz fina acelerando, grossa desacelerando).
 */
export function resample(input: Float32Array, speed: number): Float32Array {
  if (speed === 1) return input.slice();
  const outLength = Math.max(0, Math.floor(input.length / speed));
  const out = new Float32Array(outLength);
  const last = input.length - 1;
  for (let i = 0; i < outLength; i++) {
    const pos = i * speed;
    const k = Math.floor(pos);
    if (k >= last) {
      out[i] = input[last] ?? 0;
      continue;
    }
    const frac = pos - k;
    out[i] = input[k]! * (1 - frac) + input[k + 1]! * frac;
  }
  return out;
}

/** Converte a taxa de amostragem (interpolação linear). */
export function changeSampleRate(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input.slice();
  return resample(input, from / to);
}

function hann(length: number): Float32Array {
  const w = new Float32Array(length);
  for (let i = 0; i < length; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1));
  return w;
}

/**
 * Posições de leitura do WSOLA (waveform similarity overlap-add): para cada
 * quadro de saída, onde ler na entrada para encaixar a forma de onda com o quadro
 * anterior. Calculado uma vez (no mono) e aplicado a todos os canais.
 */
export function wsolaPositions(
  mono: Float32Array,
  speed: number,
  frame: number,
  hop: number,
  tolerance: number,
): number[] {
  const positions: number[] = [];
  const analysisHop = hop * speed;
  const outFrames = Math.ceil(mono.length / speed / hop);
  const corrLength = Math.floor(frame / 2);
  const step = 4;
  let previous = 0;
  for (let k = 0; k < outFrames; k++) {
    const nominal = Math.round(k * analysisHop);
    if (k === 0) {
      positions.push(0);
      previous = 0;
      continue;
    }
    // O que naturalmente viria depois do quadro anterior.
    const natural = previous + hop;
    let best = nominal;
    let bestScore = Number.NEGATIVE_INFINITY;
    const lo = Math.max(0, nominal - tolerance);
    const hi = Math.min(mono.length - corrLength - 1, nominal + tolerance);
    if (hi < lo || natural + corrLength >= mono.length) {
      best = Math.min(Math.max(0, nominal), Math.max(0, mono.length - frame));
    } else {
      for (let cand = lo; cand <= hi; cand += 2) {
        let score = 0;
        for (let i = 0; i < corrLength; i += step) score += mono[cand + i]! * mono[natural + i]!;
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
    }
    positions.push(best);
    previous = best;
  }
  return positions;
}

/** Aplica as posições do WSOLA a um canal. */
export function wsolaApply(channel: Float32Array, positions: number[], speed: number, frame: number, hop: number): Float32Array {
  const outLength = Math.max(0, Math.floor(channel.length / speed));
  const out = new Float32Array(outLength + frame);
  const weight = new Float32Array(outLength + frame);
  const window = hann(frame);
  for (let k = 0; k < positions.length; k++) {
    const src = positions[k]!;
    const dst = k * hop;
    for (let i = 0; i < frame; i++) {
      const s = src + i;
      if (s >= channel.length || dst + i >= out.length) break;
      out[dst + i]! += channel[s]! * window[i]!;
      weight[dst + i]! += window[i]!;
    }
  }
  const result = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const w = weight[i]!;
    result[i] = w > 1e-3 ? out[i]! / w : 0;
  }
  return result;
}

/** Muda a velocidade mantendo o tom (WSOLA). Quadros de ~30 ms com 50% de sobreposição. */
export function timeStretch(buffer: PcmBuffer, speed: number): PcmBuffer {
  if (speed === 1) return { sampleRate: buffer.sampleRate, channels: buffer.channels.map((c) => c.slice()) };
  const frame = Math.max(64, Math.round(buffer.sampleRate * 0.03));
  const hop = Math.floor(frame / 2);
  const tolerance = Math.floor(hop / 2);
  const positions = wsolaPositions(toMono(buffer), speed, frame, hop, tolerance);
  return {
    sampleRate: buffer.sampleRate,
    channels: buffer.channels.map((c) => wsolaApply(c, positions, speed, frame, hop)),
  };
}

export function changeSpeed(buffer: PcmBuffer, speed: number, keepPitch: boolean): PcmBuffer {
  if (keepPitch) return timeStretch(buffer, speed);
  return { sampleRate: buffer.sampleRate, channels: buffer.channels.map((c) => resample(c, speed)) };
}

/** Fades lineares, em segundos, sobre todos os canais (altera o buffer). */
export function applyFades(buffer: PcmBuffer, fadeInSec: number, fadeOutSec: number): PcmBuffer {
  const n = frameCount(buffer);
  const fi = Math.min(n, Math.round(fadeInSec * buffer.sampleRate));
  const fo = Math.min(n, Math.round(fadeOutSec * buffer.sampleRate));
  for (const ch of buffer.channels) {
    for (let i = 0; i < fi; i++) ch[i]! *= i / fi;
    for (let i = 0; i < fo; i++) ch[n - 1 - i]! *= i / fo;
  }
  return buffer;
}

/** WAV PCM 16 bits, canais intercalados. */
export function encodeWav(buffer: PcmBuffer): Uint8Array {
  const channels = buffer.channels.length;
  const n = frameCount(buffer);
  const dataBytes = n * channels * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i);
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, buffer.channels[c]![i]!));
      view.setInt16(offset, v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), true);
      offset += 2;
    }
  }
  return bytes;
}

/** PCM 16 bits mono sem cabeçalho (o formato que o whisper.rn recebe em `transcribeData`). */
export function toPcm16(samples: Float32Array): ArrayBuffer {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    out[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
  }
  return out.buffer;
}

/** Picos para desenhar a forma de onda: `buckets` valores 0..1. */
export function computePeaks(samples: Float32Array, buckets: number): number[] {
  const peaks = new Array<number>(Math.max(0, buckets)).fill(0);
  if (samples.length === 0 || buckets <= 0) return peaks;
  const per = samples.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const a = Math.floor(b * per);
    const z = Math.min(samples.length, Math.max(a + 1, Math.floor((b + 1) * per)));
    let max = 0;
    for (let i = a; i < z; i++) {
      const v = Math.abs(samples[i]!);
      if (v > max) max = v;
    }
    peaks[b] = Math.min(1, max);
  }
  return peaks;
}

/**
 * Soma um trecho mono num buffer de saída a partir de `offset` (amostras),
 * multiplicado por `gain`. Usado para montar o áudio da timeline das legendas.
 */
export function mixInto(target: Float32Array, source: Float32Array, offset: number, gain = 1): void {
  const start = Math.max(0, offset);
  const skip = start - offset;
  const n = Math.min(source.length - skip, target.length - start);
  for (let i = 0; i < n; i++) target[start + i]! += source[skip + i]! * gain;
}
