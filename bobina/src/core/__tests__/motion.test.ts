import { ANIMATIONS, TRANSITIONS, animState, itemMotion, transitionFrame } from '../motion';

describe('animações', () => {
  it('toda animação termina parada', () => {
    for (const a of ANIMATIONS) {
      const s = animState(a.kind, 1);
      expect(s.opacity).toBeCloseTo(1);
      expect(s.scale).toBeCloseTo(1);
      expect(s.dx).toBeCloseTo(0);
      expect(s.dy).toBeCloseTo(0);
      expect(s.rotation).toBeCloseTo(0);
    }
  });

  it('surgir começa invisível', () => {
    expect(animState('fade', 0).opacity).toBe(0);
  });

  it('entrada no começo, saída no fim, nada no meio', () => {
    const fade = { kind: 'fade' as const, duration: 500_000 };
    expect(itemMotion(0, 3_000_000, fade, fade).opacity).toBe(0);
    expect(itemMotion(1_500_000, 3_000_000, fade, fade).opacity).toBe(1);
    expect(itemMotion(2_999_999, 3_000_000, fade, fade).opacity).toBeLessThan(0.01);
  });

  it('item curto divide a duração entre entrada e saída', () => {
    const fade = { kind: 'fade' as const, duration: 2_000_000 };
    expect(itemMotion(500_000, 1_000_000, fade, { kind: 'none', duration: 0 }).opacity).toBeCloseTo(1);
  });
});

describe('transições', () => {
  it('começam mostrando A e terminam mostrando B', () => {
    for (const t of TRANSITIONS) {
      const start = transitionFrame(t.kind, 0);
      const end = transitionFrame(t.kind, 1);
      expect(start.a.opacity).toBeCloseTo(1);
      expect(end.b.opacity).toBeCloseTo(1);
      expect(end.b.dx).toBeCloseTo(0);
      expect(end.b.dy).toBeCloseTo(0);
      expect(end.b.scale).toBeCloseTo(1);
      if (end.flash) expect(end.flash.alpha).toBeCloseTo(0);
      if (start.reveal) expect(start.reveal.amount).toBeCloseTo(0);
    }
  });

  it('fade para preto escurece no meio', () => {
    expect(transitionFrame('fadeBlack', 0.49).flash?.alpha).toBeGreaterThan(0.9);
  });
});
