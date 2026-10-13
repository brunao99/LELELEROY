import {
  applyFades,
  applyGain,
  changeSpeed,
  computePeaks,
  encodeWav,
  mixInto,
  resample,
  sliceSeconds,
  timeStretch,
  toMono,
  toPcm16,
  type PcmBuffer,
} from '../audio';

const RATE = 8000;

function sine(freq: number, seconds: number, rate = RATE): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

/** Frequência dominante por cruzamentos de zero. */
function zeroCrossFreq(x: Float32Array, rate = RATE): number {
  let crossings = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1]! < 0 !== x[i]! < 0) crossings++;
  return crossings / 2 / (x.length / rate);
}

describe('áudio', () => {
  it('reamostrar dobra a velocidade e o tom', () => {
    const x = sine(200, 1);
    const y = resample(x, 2);
    expect(y.length).toBe(RATE / 2);
    expect(zeroCrossFreq(y)).toBeCloseTo(400, -1);
  });

  it('WSOLA muda a duração e mantém o tom', () => {
    const buffer: PcmBuffer = { sampleRate: RATE, channels: [sine(200, 2)] };
    const fast = timeStretch(buffer, 2);
    const slow = timeStretch(buffer, 0.5);
    expect(fast.channels[0]!.length).toBe(RATE);
    expect(slow.channels[0]!.length).toBe(RATE * 4);
    expect(zeroCrossFreq(fast.channels[0]!.subarray(400, -400))).toBeGreaterThan(185);
    expect(zeroCrossFreq(fast.channels[0]!.subarray(400, -400))).toBeLessThan(215);
    expect(zeroCrossFreq(slow.channels[0]!.subarray(400, -400))).toBeGreaterThan(185);
    expect(zeroCrossFreq(slow.channels[0]!.subarray(400, -400))).toBeLessThan(215);
  });

  it('changeSpeed escolhe o método pelo "manter tom"', () => {
    const buffer: PcmBuffer = { sampleRate: RATE, channels: [sine(200, 1), sine(200, 1)] };
    const kept = changeSpeed(buffer, 2, true);
    const plain = changeSpeed(buffer, 2, false);
    expect(kept.channels).toHaveLength(2);
    expect(zeroCrossFreq(plain.channels[0]!)).toBeCloseTo(400, -1);
  });

  it('fades zeram as pontas', () => {
    const buffer: PcmBuffer = { sampleRate: RATE, channels: [new Float32Array(RATE).fill(1)] };
    applyFades(buffer, 0.25, 0.25);
    const ch = buffer.channels[0]!;
    expect(ch[0]).toBe(0);
    expect(ch[ch.length - 1]).toBe(0);
    expect(ch[RATE / 2]).toBe(1);
  });

  it('WAV tem cabeçalho certo e 16 bits', () => {
    const wav = encodeWav({ sampleRate: 44100, channels: [new Float32Array([0, 1]), new Float32Array([0, -1])] });
    const text = (a: number, b: number) => String.fromCharCode(...wav.subarray(a, b));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 12)).toBe('WAVE');
    const view = new DataView(wav.buffer);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(48, true)).toBe(32767);
    expect(view.getInt16(50, true)).toBe(-32768);
  });

  it('PCM16 para o Whisper', () => {
    const pcm = new Int16Array(toPcm16(new Float32Array([0, 0.5, -1, 2])));
    expect(Array.from(pcm)).toEqual([0, 16384, -32768, 32767]);
  });

  it('mono, trecho, picos e mistura', () => {
    const buffer: PcmBuffer = { sampleRate: 4, channels: [new Float32Array([1, 1, 0, 0]), new Float32Array([0, 1, 0, 0])] };
    expect(Array.from(toMono(buffer))).toEqual([0.5, 1, 0, 0]);
    expect(sliceSeconds(buffer, 0.25, 0.75).channels[0]!.length).toBe(2);
    expect(computePeaks(new Float32Array([0.1, -0.9, 0.2, 0.3]), 2)).toEqual([expect.closeTo(0.9), expect.closeTo(0.3)]);
    const target = new Float32Array(4);
    mixInto(target, new Float32Array([1, 1, 1]), 2, 0.5);
    expect(Array.from(target)).toEqual([0, 0, 0.5, 0.5]);
    mixInto(target, new Float32Array([1, 1]), -1);
    expect(Array.from(target)).toEqual([1, 0, 0.5, 0.5]);
  });
});

describe('ganho', () => {
  it('amplifica sem passar de 1', () => {
    const buffer: PcmBuffer = { sampleRate: 4, channels: [new Float32Array([0.1, 0.5, -0.9, 1])] };
    applyGain(buffer, 2);
    const ch = Array.from(buffer.channels[0]!);
    expect(ch[0]).toBeCloseTo(0.2);
    for (const v of ch) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    expect(ch[2]).toBeLessThan(-0.9);
  });
});
