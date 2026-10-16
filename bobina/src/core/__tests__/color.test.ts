import {
  FILTERS,
  IDENTITY_MATRIX,
  adjustmentsMatrix,
  clipColorMatrix,
  clipShaderParams,
  filterMatrix,
  isIdentity,
  multiply,
  saturationMatrix,
} from '../color';
import { NO_ADJUST } from '../defaults';

/** Aplica a matriz a uma cor (0..1). */
function apply(m: number[], [r, g, b]: [number, number, number]): [number, number, number] {
  const row = (i: number) => m[i * 5]! * r + m[i * 5 + 1]! * g + m[i * 5 + 2]! * b + m[i * 5 + 4]!;
  return [row(0), row(1), row(2)];
}

describe('cor', () => {
  it('sem ajustes é a identidade', () => {
    expect(isIdentity(adjustmentsMatrix(NO_ADJUST))).toBe(true);
    expect(clipColorMatrix(null, NO_ADJUST)).toBeNull();
  });

  it('saturação −100 deixa cinza', () => {
    const [r, g, b] = apply(adjustmentsMatrix({ ...NO_ADJUST, saturation: -100 }), [1, 0, 0]);
    expect(r).toBeCloseTo(g);
    expect(g).toBeCloseTo(b);
  });

  it('brilho clareia e contraste afasta do cinza médio', () => {
    expect(apply(adjustmentsMatrix({ ...NO_ADJUST, brightness: 100 }), [0.5, 0.5, 0.5])[0]).toBeGreaterThan(0.5);
    const c = adjustmentsMatrix({ ...NO_ADJUST, contrast: 50 });
    expect(apply(c, [0.5, 0.5, 0.5])[0]).toBeCloseTo(0.5);
    expect(apply(c, [0.8, 0.8, 0.8])[0]).toBeGreaterThan(0.8);
  });

  it('temperatura quente puxa para o vermelho', () => {
    const [r, , b] = apply(adjustmentsMatrix({ ...NO_ADJUST, temperature: 100 }), [0.5, 0.5, 0.5]);
    expect(r).toBeGreaterThan(b);
  });

  it('multiplicar pela identidade não muda', () => {
    const s = saturationMatrix(0.3);
    expect(multiply(IDENTITY_MATRIX, s)).toEqual(s);
    expect(multiply(s, IDENTITY_MATRIX)).toEqual(s);
  });

  it('intensidade 0 desliga o filtro e todos os filtros existem', () => {
    for (const f of FILTERS) {
      expect(isIdentity(filterMatrix({ id: f.id, intensity: 0 }))).toBe(true);
      expect(isIdentity(filterMatrix({ id: f.id, intensity: 1 }))).toBe(false);
    }
    expect(isIdentity(filterMatrix({ id: 'nao-existe', intensity: 1 }))).toBe(true);
  });

  it('parâmetros do shader só quando há ajuste não linear', () => {
    expect(clipShaderParams(NO_ADJUST)).toBeNull();
    expect(clipShaderParams({ ...NO_ADJUST, vignette: 40 })).toEqual({ highlights: 0, shadows: 0, sharpen: 0, vignette: 0.4 });
  });
});
