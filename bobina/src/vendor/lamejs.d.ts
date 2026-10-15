/** Tipos do codificador MP3 (src/vendor/lamejs.js). */
export class Mp3Encoder {
  /** `quality`: 0 (melhor) a 9 (mais rápido); padrão 3. */
  constructor(channels: number, sampleRate: number, kbps: number, quality?: number);
  encodeBuffer(left: Int16Array, right?: Int16Array): Uint8Array;
  flush(): Uint8Array;
}
