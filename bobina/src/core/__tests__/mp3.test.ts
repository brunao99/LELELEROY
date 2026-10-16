import { encodeMp3, isMonoLike } from '../mp3';

function sine(seconds: number, rate: number, hz: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

describe('MP3', () => {
  it('gera quadros MP3 válidos, do tamanho esperado para o bitrate', async () => {
    const rate = 44_100;
    const progress: number[] = [];
    const mp3 = await encodeMp3({ sampleRate: rate, channels: [sine(3, rate, 440), sine(3, rate, 660)] }, 128, (f) => progress.push(f));
    // Começa com a sincronia de quadro MPEG (11 bits ligados).
    expect(mp3[0]).toBe(0xff);
    expect(mp3[1]! & 0xe0).toBe(0xe0);
    // Estéreo de verdade: o cabeçalho do quadro não diz "mono" (modo 3, nos 2 bits altos do 4º byte).
    expect(mp3[3]! >> 6).not.toBe(3);
    // 3 s a 128 kbps ≈ 48 KB
    expect(mp3.length).toBeGreaterThan(40_000);
    expect(mp3.length).toBeLessThan(60_000);
    expect(progress[progress.length - 1]).toBe(1);
    if (process.env.MP3_OUT) require('fs').writeFileSync(process.env.MP3_OUT, mp3);
  });

  it('canais iguais viram mono (metade do trabalho)', () => {
    const a = sine(1, 8000, 300);
    expect(isMonoLike({ sampleRate: 8000, channels: [a, a.slice()] })).toBe(true);
    expect(isMonoLike({ sampleRate: 8000, channels: [a, sine(1, 8000, 500)] })).toBe(false);
  });

  it('mono também funciona', async () => {
    const mp3 = await encodeMp3({ sampleRate: 22_050, channels: [sine(1, 22_050, 300)] }, 64);
    expect(mp3[0]).toBe(0xff);
    expect(mp3[3]! >> 6).toBe(3);
  });
});
