/**
 * MP3 a partir do áudio decodificado (lamejs, em JavaScript). Codifica em
 * blocos e devolve o controle entre eles, para a tela não travar e a barra de
 * progresso andar.
 */
import { Mp3Encoder } from '../vendor/lamejs';

import type { PcmBuffer } from './audio';

/** Amostras por bloco do codificador (múltiplo de 1152, o tamanho de um quadro MP3). */
const BLOCK = 1152 * 20;

function toInt16(samples: Float32Array, from: number, to: number): Int16Array {
  const out = new Int16Array(to - from);
  for (let i = from; i < to; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    out[i - from] = v < 0 ? v * 32768 : v * 32767;
  }
  return out;
}

/**
 * Os dois canais são praticamente iguais (comum em vídeos de celular)? Aí o
 * MP3 sai em mono: soa igual e codifica em metade do tempo.
 */
export function isMonoLike(pcm: PcmBuffer): boolean {
  const [l, r] = pcm.channels;
  if (!l || !r) return true;
  let diff = 0;
  let energy = 0;
  for (let i = 0; i < l.length; i += 7) {
    diff += Math.abs(l[i]! - r[i]!);
    energy += Math.abs(l[i]!) + Math.abs(r[i]!);
  }
  return energy === 0 || diff / energy < 0.01;
}

/**
 * Codifica em MP3 a `kbps` (estéreo, ou mono quando os canais são iguais).
 * Qualidade 7 do LAME: no celular o JavaScript é interpretado e a 3 (padrão
 * da biblioteca) demora bem mais, sem diferença audível a 192 kbps.
 */
export async function encodeMp3(
  pcm: PcmBuffer,
  kbps = 192,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const left = pcm.channels[0] ?? new Float32Array(0);
  const right = isMonoLike(pcm) ? undefined : pcm.channels[1];
  const encoder = new Mp3Encoder(right ? 2 : 1, pcm.sampleRate, right ? kbps : Math.min(kbps, 128), 7);
  const parts: Uint8Array[] = [];
  let size = 0;
  for (let i = 0; i < left.length; i += BLOCK) {
    if (signal?.aborted) throw new Error('cancelado');
    const end = Math.min(left.length, i + BLOCK);
    const chunk = right ? encoder.encodeBuffer(toInt16(left, i, end), toInt16(right, i, end)) : encoder.encodeBuffer(toInt16(left, i, end));
    if (chunk.length > 0) {
      parts.push(chunk);
      size += chunk.length;
    }
    // A cada ~10 blocos, devolve o controle para a interface.
    if ((i / BLOCK) % 10 === 9) {
      onProgress?.(end / left.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  const tail = encoder.flush();
  if (tail.length > 0) {
    parts.push(tail);
    size += tail.length;
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  onProgress?.(1);
  return out;
}
