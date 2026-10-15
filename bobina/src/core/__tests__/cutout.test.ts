import {
  MASK_PIXELS,
  MASK_SIZE,
  MEMORY_DIM,
  MEMORY_TOKENS,
  MemoryBank,
  POINTER_DIM,
  buildPrompt,
  chooseMask,
  constrainToLasso,
  decodeRle,
  dilate,
  encodeMaskFile,
  encodeRle,
  logitsToBytes,
  maskIndexAt,
  nearestFrame,
  parseMaskFile,
  rasterizePolygon,
  trackTimes,
  type MemoryEntry,
} from '../cutout';

function entry(tag: number): MemoryEntry {
  return {
    memory: new Float32Array(MEMORY_TOKENS * MEMORY_DIM).fill(tag),
    memoryPos: new Float32Array(MEMORY_TOKENS * MEMORY_DIM).fill(-tag),
    pointer: new Float32Array(POINTER_DIM).fill(tag),
  };
}

function square(x0: number, y0: number, x1: number, y1: number) {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/** Logits com um retângulo de células positivas. */
function blob(logits: Float32Array, c0: number, r0: number, c1: number, r1: number, v = 8) {
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) logits[r * MASK_SIZE + c] = v;
}

describe('escolha da máscara (como o SAM 2)', () => {
  const masks = new Float32Array(4 * MASK_PIXELS).fill(-10);
  const iou = Float32Array.from([0.5, 0.7, 0.9, 0.8]);

  it('um toque só: a melhor das três alternativas', () => {
    expect(chooseMask({ masks, iou }, true)).toBe(2);
  });

  it('caixa: a máscara única quando é estável', () => {
    expect(chooseMask({ masks, iou }, false)).toBe(0);
  });

  it('caixa: troca pela melhor alternativa quando a única fica em cima do muro', () => {
    const shaky = masks.slice();
    for (let i = 0; i < 5000; i++) shaky[i] = 0.01;
    for (let i = 5000; i < 6000; i++) shaky[i] = 3;
    expect(chooseMask({ masks: shaky, iou }, false)).toBe(2);
  });
});

describe('banco de memória do rastreio', () => {
  it('ida: o quadro do laço + os anteriores mais recentes, nos lugares certos', () => {
    const bank = new MemoryBank();
    bank.setPrompt(10, entry(10));
    bank.add(11, entry(11));
    bank.add(12, entry(12));
    const a = bank.inputs(13, 1, 100);
    expect(a.frames).toBe(3);
    expect(Array.from(a.slots)).toEqual([6, 1, 0]);
    expect(a.memory[0]).toBe(10);
    expect(a.memory[MEMORY_TOKENS * MEMORY_DIM]).toBe(11);
    expect(a.memoryPos[2 * MEMORY_TOKENS * MEMORY_DIM]).toBe(-12);
    expect(a.numPointers).toBe(3);
    expect(Array.from(a.pointers.filter((_, i) => i % POINTER_DIM === 0))).toEqual([10, 12, 11]);
  });

  it('volta: começa usando o que a ida rastreou logo depois do laço', () => {
    const bank = new MemoryBank();
    bank.setPrompt(10, entry(10));
    for (let t = 11; t <= 20; t++) bank.add(t, entry(t));
    const a = bank.inputs(9, -1, 100);
    // Quadros 15, 14, 13, 12, 11 (o 10 é o do laço): lugares 5..1.
    expect(Array.from(a.slots)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(a.numPointers).toBe(11);
  });

  it('esquece o que ficou longe do quadro atual e do laço', () => {
    const bank = new MemoryBank();
    bank.setPrompt(10, entry(10));
    for (let t = 11; t <= 60; t++) bank.add(t, entry(t));
    // Ficam 11..26 (perto do laço) e 44..60 (perto do atual) + o laço.
    expect(bank.size).toBe(1 + 16 + 17);
  });

  it('poucos quadros no vídeo limitam os ponteiros', () => {
    const bank = new MemoryBank();
    bank.setPrompt(0, entry(1));
    for (let t = 1; t <= 4; t++) bank.add(t, entry(t));
    expect(bank.inputs(5, 1, 6).numPointers).toBe(1 + 4);
    expect(bank.inputs(5, 1, 3).numPointers).toBe(1 + 2);
  });
});

describe('laço vira caixa e toques', () => {
  it('caixa do laço no espaço 1024, máscara única', () => {
    const p = buildPrompt(square(0.25, 0.5, 0.75, 1.2), [])!;
    expect(Array.from(p.points)).toEqual([256, 512, 768, 1024]);
    expect(Array.from(p.labels)).toEqual([2, 3]);
    expect(p.multimask).toBe(false);
  });

  it('toques entram depois da caixa; um toque sozinho usa as alternativas', () => {
    const p = buildPrompt(square(0.1, 0.1, 0.9, 0.9), [{ x: 0.5, y: 0.5, include: false }])!;
    expect(Array.from(p.labels)).toEqual([2, 3, 0]);
    const single = buildPrompt([], [{ x: 0.5, y: 0.25, include: true }])!;
    expect(Array.from(single.points)).toEqual([512, 256]);
    expect(single.multimask).toBe(true);
    expect(buildPrompt([], [])).toBeNull();
  });
});

describe('máscara do laço', () => {
  it('pinta o polígono pelo centro das células', () => {
    const m = rasterizePolygon(square(0.25, 0.25, 0.75, 0.75));
    const count = m.reduce((s, v) => s + v, 0);
    expect(count).toBe(128 * 128);
    expect(m[MASK_SIZE * 128 + 128]).toBe(1);
    expect(m[MASK_SIZE * 10 + 10]).toBe(0);
  });

  it('folga em volta (dilatação aproximadamente redonda)', () => {
    const one = new Uint8Array(MASK_PIXELS);
    one[100 * MASK_SIZE + 100] = 1;
    const d = dilate(one, 3);
    expect(d[100 * MASK_SIZE + 103]).toBe(1);
    expect(d[100 * MASK_SIZE + 104]).toBe(0);
    expect(d[103 * MASK_SIZE + 103]).toBe(0);
  });

  it('corta o que está fora do laço e os pedaços soltos; toque de incluir traz de volta', () => {
    const logits = new Float32Array(MASK_PIXELS).fill(-6);
    blob(logits, 100, 100, 150, 150); // o objeto, dentro do laço
    blob(logits, 10, 10, 30, 30); // outro objeto, longe
    blob(logits, 150, 100, 200, 110); // braço que passa do laço
    const lasso = square(90 / 256, 90 / 256, 160 / 256, 160 / 256);
    const out = constrainToLasso(logits, lasso, []);
    expect(out[120 * MASK_SIZE + 120]).toBe(8);
    expect(out[20 * MASK_SIZE + 20]).toBeLessThan(0);
    expect(out[105 * MASK_SIZE + 163]).toBe(8); // dentro da folga
    expect(out[105 * MASK_SIZE + 190]).toBeLessThan(0); // longe demais da linha
    const withClick = constrainToLasso(logits, lasso, [{ x: 20 / 256, y: 20 / 256, include: true }]);
    expect(withClick[20 * MASK_SIZE + 20]).toBe(8);
  });
});

describe('guardar as máscaras', () => {
  it('compressão por sequências volta igual', () => {
    const logits = new Float32Array(MASK_PIXELS).fill(-9);
    blob(logits, 40, 40, 200, 180, 9);
    blob(logits, 39, 40, 39, 180, 0.3);
    const bytes = logitsToBytes(logits);
    const rle = encodeRle(bytes);
    expect(rle.length).toBeLessThan(bytes.length / 20);
    expect(decodeRle(rle, new Uint8Array(MASK_PIXELS))).toEqual(bytes);
  });

  it('arquivo com vários quadros, lido por instante da mídia', () => {
    const frames = [0, 1, 2].map((k) => {
      const f = new Uint8Array(MASK_PIXELS);
      f.fill(k * 100, 0, 1000 * (k + 1));
      return f;
    });
    const file = parseMaskFile(encodeMaskFile({ size: MASK_SIZE, fps: 10, from: 2_000_000 }, frames));
    expect(file.header).toEqual({ size: MASK_SIZE, fps: 10, from: 2_000_000, count: 3 });
    const second = decodeRle(file.data, new Uint8Array(MASK_PIXELS), file.offsets[1], file.offsets[2]);
    expect(second).toEqual(frames[1]);
    expect(maskIndexAt(file.header, 2_000_000)).toBe(0);
    expect(maskIndexAt(file.header, 2_140_000)).toBe(1);
    expect(maskIndexAt(file.header, 2_260_000)).toBe(-1);
    expect(maskIndexAt(file.header, 1_900_000)).toBe(-1);
  });

  it('instantes do rastreio e o quadro do laço', () => {
    const times = trackTimes(1_000_000, 2_000_000, 4);
    expect(times).toEqual([1_000_000, 1_250_000, 1_500_000, 1_750_000, 2_000_000]);
    expect(nearestFrame(times, 1_600_000)).toBe(2);
  });
});
