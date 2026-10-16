import { decodeAudioData } from 'react-native-audio-api';

import type { PcmBuffer } from '@/core/audio';

/**
 * Decodifica o áudio de um arquivo (áudio ou vídeo) já na taxa pedida.
 * `uri` precisa começar com `file://`: sem isso, em build de produção no Android,
 * a biblioteca procura o arquivo dentro do pacote do app.
 */
export async function decodeFile(uri: string, sampleRate: number): Promise<PcmBuffer> {
  const fileUri = uri.startsWith('file://') ? uri : `file://${uri}`;
  const buffer = await decodeAudioData(fileUri, sampleRate);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    // Cópia: o buffer nativo pode ser liberado depois.
    channels.push(new Float32Array(buffer.getChannelData(c)));
  }
  return { sampleRate: buffer.sampleRate, channels };
}

/** Mono, já na taxa pedida. */
export async function decodeMono(uri: string, sampleRate: number): Promise<Float32Array> {
  const pcm = await decodeFile(uri, sampleRate);
  if (pcm.channels.length === 1) return pcm.channels[0]!;
  const n = pcm.channels[0]?.length ?? 0;
  const out = new Float32Array(n);
  for (const ch of pcm.channels) for (let i = 0; i < n; i++) out[i]! += ch[i]! / pcm.channels.length;
  return out;
}
