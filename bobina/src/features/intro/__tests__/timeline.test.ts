import { ORBS, T, WORDMARK_SEGMENTS, bloomOpacity, easeInOut, easeOut, introLayout, letterState, orbState, phase } from '../timeline';

describe('abertura', () => {
  const layout = introLayout(390, 844);

  it('a marca começa no lugar da abertura nativa, no centro', () => {
    expect(layout.splash).toEqual({ x: 135, y: 362, width: 120, height: 120 });
  });

  it('o logotipo final fica centralizado e a marca encaixa à esquerda dele', () => {
    const w = layout.wordmark;
    expect(w.x + w.width / 2).toBeCloseTo(195);
    expect(w.y + w.height / 2).toBeCloseTo(422);
    // a marca grande encolhe para cerca de metade do tamanho e fica no começo do logotipo
    expect(layout.markFinal.width).toBeLessThan(layout.splash.width * 0.6);
    expect(layout.markFinal.x + layout.markFinal.width / 2).toBeLessThan(w.x + (WORDMARK_SEGMENTS[0][1] + 20) * layout.k);
  });

  it('o círculo final cobre a tela toda', () => {
    expect(layout.cover).toBeGreaterThan(Math.hypot(195, 422));
  });

  it('curvas começam em 0 e terminam em 1', () => {
    for (const f of [easeOut, easeInOut]) {
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
    }
    expect(phase(T.moveStart - 10, T.moveStart, 100)).toBe(0);
    expect(phase(T.moveStart + 200, T.moveStart, 100)).toBe(1);
  });

  it('as bolhas começam apagadas, acendem em volta da marca e se fundem no centro', () => {
    const c = layout.center;
    for (let i = 0; i < ORBS.length; i++) {
      // 1º quadro igual à abertura nativa: nenhuma bolha visível
      expect(orbState(0, i, c, 390).opacity).toBe(0);
      const lit = orbState(T.gatherStart, i, c, 390);
      expect(lit.opacity).toBeGreaterThan(0.2);
      expect(Math.hypot(lit.x - c.x, lit.y - c.y)).toBeGreaterThan(60);
      const merged = orbState(T.gatherEnd, i, c, 390);
      expect(merged.opacity).toBe(0);
      expect(merged.x).toBeCloseTo(c.x);
      expect(merged.y).toBeCloseTo(c.y);
    }
  });

  it('o brilho da fusão acende quando as bolhas chegam e apaga antes da saída', () => {
    expect(bloomOpacity(0)).toBe(0);
    expect(bloomOpacity(T.bloomPeak)).toBe(1);
    expect(bloomOpacity(T.bloomOut)).toBe(0);
    expect(T.bloomOut).toBeLessThan(T.exitStart);
  });

  it('as letras entram uma depois da outra e terminam no lugar', () => {
    const t = T.lettersStart + T.letterStagger * 2;
    expect(letterState(t, 0).rise).toBeLessThan(letterState(t, 2).rise);
    expect(letterState(T.exitStart, 4)).toEqual({ rise: 0, opacity: 1 });
  });
});
