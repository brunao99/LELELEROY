import { chromaUniforms, effectMotion, hexToRgb, shaderKind } from '../effects';
import { updateVisual } from '../ops';
import { buildRenderPlan } from '../renderPlan';
import { projectWith } from './fixtures';

describe('efeitos', () => {
  it('cada efeito de shader tem o seu código; os de movimento e o desfoque não', () => {
    expect([shaderKind('glitch'), shaderKind('rgb'), shaderKind('grain'), shaderKind('pixelate'), shaderKind('flash')]).toEqual([1, 2, 3, 4, 5]);
    expect([shaderKind('shake'), shaderKind('pulse'), shaderKind('blur'), shaderKind(null)]).toEqual([0, 0, 0, 0]);
  });

  it('tremida mexe pouco e sempre igual no mesmo instante (exportação = preview)', () => {
    const a = effectMotion('shake', 1, 1.234);
    expect(a).toEqual(effectMotion('shake', 1, 1.234));
    expect(Math.abs(a.dx)).toBeLessThan(0.02);
    expect(Math.abs(a.rotation)).toBeLessThanOrEqual(1.2);
    expect(effectMotion(null, 1, 1)).toEqual({ opacity: 1, scale: 1, dx: 0, dy: 0, rotation: 0 });
  });

  it('pulsar cresce na batida e volta ao normal entre batidas', () => {
    expect(effectMotion('pulse', 1, 0.125).scale).toBeCloseTo(1.08);
    expect(effectMotion('pulse', 1, 0).scale).toBeCloseTo(1);
  });

  it('chroma: a cor vira tom (CbCr); verde tem Cb e Cr negativos', () => {
    expect(hexToRgb('#0f8')).toEqual([0, 255, 136]);
    const green = chromaUniforms({ color: '#00b140', similarity: 0.1, smoothness: 0.05 });
    expect(green.cb).toBeLessThan(0);
    expect(green.cr).toBeLessThan(0);
    const gray = chromaUniforms({ color: '#808080', similarity: 0.1, smoothness: 0.05 });
    expect(gray.cb).toBeCloseTo(0);
    expect(gray.cr).toBeCloseTo(0);
  });

  it('o plano de desenho leva o efeito e o chroma do clipe', () => {
    const p = projectWith(5);
    const id = p.main[0]!.id;
    const q = updateVisual(p, id, { effect: { kind: 'glitch', amount: 0.5 }, chroma: { color: '#00b140', similarity: 0.1, smoothness: 0.05 } });
    const clip = buildRenderPlan(q).main[0]!.clip;
    expect(clip.effect).toEqual({ kind: 'glitch', amount: 0.5 });
    expect(clip.chroma).toMatchObject({ similarity: 0.1, smoothness: 0.05 });
    expect(buildRenderPlan(p).main[0]!.clip.effect).toBeNull();
  });
});
