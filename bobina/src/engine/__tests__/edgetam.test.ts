/**
 * O rastreador com redes de mentira: confere nomes, tipos e formatos de cada
 * entrada (o que as redes exportadas esperam) e o caminho do banco de memória.
 * A paridade numérica com o EdgeTAM oficial é conferida fora do app
 * (tools/edgetam e o teste com onnxruntime-node).
 */
import { MASK_PIXELS, buildPrompt } from '@/core/cutout';

import { EdgeTam, type EdgeTamSessions } from '../edgetam';

class FakeTensor {
  constructor(
    readonly type: string,
    readonly data: ArrayLike<number>,
    readonly dims: number[],
  ) {}
}

type Feeds = Record<string, FakeTensor>;

function session(run: (feeds: Feeds) => Record<string, FakeTensor>) {
  const calls: Feeds[] = [];
  return {
    calls,
    run: async (feeds: Feeds) => {
      calls.push(feeds);
      return run(feeds);
    },
  };
}

const f = (n: number, v = 0) => new Float32Array(n).fill(v);

function fakes() {
  const imageEncoder = session(() => ({
    f0: new FakeTensor('float32', f(4), [1, 32, 256, 256]),
    f1: new FakeTensor('float32', f(4), [1, 64, 128, 128]),
    f2: new FakeTensor('float32', f(4), [1, 256, 64, 64]),
  }));
  const maskDecoder = session(() => {
    const masks = f(4 * MASK_PIXELS, -8);
    // Token 0: um quadrado nítido (estável). Tokens 1..3: menores.
    for (let k = 0; k < 4; k++) {
      const side = k === 0 ? 100 : 40;
      for (let y = 50; y < 50 + side; y++) for (let x = 50; x < 50 + side; x++) masks[k * MASK_PIXELS + y * 256 + x] = 8;
    }
    return {
      masks: new FakeTensor('float32', masks, [1, 4, 256, 256]),
      iou: new FakeTensor('float32', Float32Array.from([0.9, 0.5, 0.8, 0.6]), [1, 4]),
      pointers: new FakeTensor('float32', Float32Array.from({ length: 4 * 256 }, (_, i) => Math.floor(i / 256)), [1, 4, 256]),
      object_score: new FakeTensor('float32', Float32Array.from([5]), [1, 1]),
    };
  });
  const memoryEncoder = session(() => ({
    memory: new FakeTensor('float32', f(512 * 64, 1), [1, 512, 64]),
    memory_pos: new FakeTensor('float32', f(512 * 64, 2), [1, 512, 64]),
  }));
  const memoryAttention = session(() => ({ f2_conditioned: new FakeTensor('float32', f(4), [1, 256, 64, 64]) }));
  return { imageEncoder, maskDecoder, memoryEncoder, memoryAttention };
}

const lasso = [
  { x: 0.1, y: 0.1 },
  { x: 0.6, y: 0.1 },
  { x: 0.6, y: 0.6 },
  { x: 0.1, y: 0.6 },
];

describe('rastreador EdgeTAM (formatos das redes)', () => {
  it('laço: caixa no espaço 1024, sem memória, máscara única', async () => {
    const s = fakes();
    const et = new EdgeTam(s as unknown as EdgeTamSessions, FakeTensor as never);
    const feats = await et.encode(new Uint8Array(1024 * 1024 * 4));
    expect(s.imageEncoder.calls[0]!.image!.type).toBe('uint8');
    expect(s.imageEncoder.calls[0]!.image!.dims).toEqual([1024, 1024, 4]);
    const seg = await et.segment(feats, buildPrompt(lasso, [])!);
    const feeds = s.maskDecoder.calls[0]!;
    expect(feeds.points!.dims).toEqual([1, 2, 2]);
    expect(Array.from(feeds.points!.data)).toEqual([102.4, 102.4, 614.4, 614.4].map((v) => Math.fround(v)));
    expect(feeds.labels!.type).toBe('int32');
    expect(Array.from(feeds.labels!.data)).toEqual([2, 3]);
    expect(feeds.mask_input!.dims).toEqual([1, 1, 256, 256]);
    expect(Array.from(feeds.has_mask!.data)).toEqual([0]);
    expect(Array.from(feeds.cond!.data)).toEqual([1]);
    // Caixa = máscara única (token 0, o quadrado grande) e o ponteiro dela.
    expect(seg.logits[80 * 256 + 120]).toBe(8);
    expect(seg.pointer[0]).toBe(0);
  });

  it('rastreio: memória do laço + vizinhos, ponteiros e a melhor alternativa', async () => {
    const s = fakes();
    const et = new EdgeTam(s as unknown as EdgeTamSessions, FakeTensor as never);
    const feats = await et.encode(new Uint8Array(1024 * 1024 * 4));
    const seg = await et.segment(feats, buildPrompt(lasso, [])!);
    await et.setPrompt(5, feats, seg);
    expect(Array.from(s.memoryEncoder.calls[0]!.from_points!.data)).toEqual([1]);

    const t6 = await et.track(6, feats, 1, 20);
    let a = s.memoryAttention.calls[0]!;
    expect(a.memory!.dims).toEqual([1, 512, 64]);
    expect(a.slots!.type).toBe('int32');
    expect(Array.from(a.slots!.data)).toEqual([6]);
    expect(a.pointers!.dims).toEqual([1, 256]);
    // Rastreio: sem toques (ponto vazio), com as alternativas: a melhor é a 2.
    const dec = s.maskDecoder.calls[1]!;
    expect(Array.from(dec.labels!.data)).toEqual([-1]);
    expect(Array.from(dec.cond!.data)).toEqual([0]);
    expect(t6.pointer[0]).toBe(2);
    expect(Array.from(s.memoryEncoder.calls[1]!.from_points!.data)).toEqual([0]);

    await et.track(7, feats, 1, 20);
    a = s.memoryAttention.calls[1]!;
    expect(a.memory!.dims).toEqual([2, 512, 64]);
    expect(Array.from(a.slots!.data)).toEqual([6, 0]);
    expect(a.pointers!.dims).toEqual([2, 256]);

    // Volta a partir do laço: usa o que a ida rastreou logo depois dele.
    await et.track(4, feats, -1, 20);
    a = s.memoryAttention.calls[2]!;
    expect(Array.from(a.slots!.data)).toEqual([6, 2, 1]);
  });

  it('toque refina a tentativa anterior com a máscara dela', async () => {
    const s = fakes();
    const et = new EdgeTam(s as unknown as EdgeTamSessions, FakeTensor as never);
    const feats = await et.encode(new Uint8Array(1024 * 1024 * 4));
    const first = await et.segment(feats, buildPrompt(lasso, [])!);
    await et.segment(feats, buildPrompt(lasso, [{ x: 0.3, y: 0.3, include: false }])!, first.logits);
    const feeds = s.maskDecoder.calls[1]!;
    expect(Array.from(feeds.labels!.data)).toEqual([2, 3, 0]);
    expect(Array.from(feeds.has_mask!.data)).toEqual([1]);
    expect(feeds.mask_input!.data).toBe(first.logits);
  });
});
