import { keyframeState, scaleKeyframes, shiftKeyframes, splitKeyframes, upsertKeyframe } from '../keyframes';
import {
  clearKeyframes,
  findItem,
  itemStateAt,
  setItemOpacity,
  setKeyframeEase,
  setSpeed,
  splitItem,
  toggleKeyframe,
  trimItem,
  updateTransform,
} from '../ops';
import { buildRenderPlan } from '../renderPlan';
import { sec } from '../time';
import type { Keyframe, MainClip } from '../types';
import { projectWith } from './fixtures';

const kf = (at: number, x: number, extra: Partial<Keyframe> = {}): Keyframe => ({
  at,
  x,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  ease: 'linear',
  ...extra,
});

describe('keyframes: interpolação', () => {
  const list = [kf(sec(1), 0), kf(sec(3), 0.4, { scale: 2, rotation: 90, opacity: 0 })];

  it('antes do primeiro e depois do último ficam parados', () => {
    expect(keyframeState(list, 0).transform.x).toBe(0);
    expect(keyframeState(list, sec(9)).transform).toEqual({ x: 0.4, y: 0, scale: 2, rotation: 90 });
  });

  it('linear: no meio, o meio de tudo', () => {
    const s = keyframeState(list, sec(2));
    expect(s.transform.x).toBeCloseTo(0.2);
    expect(s.transform.scale).toBeCloseTo(1.5);
    expect(s.transform.rotation).toBeCloseTo(45);
    expect(s.opacity).toBeCloseTo(0.5);
  });

  it('suave: começa e termina devagar, mas passa pelo meio no meio', () => {
    const smooth = [{ ...list[0]!, ease: 'smooth' as const }, list[1]!];
    expect(keyframeState(smooth, sec(1.2)).transform.x).toBeLessThan(keyframeState(list, sec(1.2)).transform.x);
    expect(keyframeState(smooth, sec(2)).transform.x).toBeCloseTo(0.2);
  });

  it('pôr um keyframe no mesmo instante substitui; em outro, entra em ordem', () => {
    const state = { transform: { x: 9, y: 0, scale: 1, rotation: 0 }, opacity: 1 };
    expect(upsertKeyframe(list, sec(1) + 5_000, state).map((k) => [k.at, k.x])).toEqual([
      [sec(1), 9],
      [sec(3), 0.4],
    ]);
    expect(upsertKeyframe(list, sec(2), state).map((k) => k.at)).toEqual([sec(1), sec(2), sec(3)]);
  });

  it('cortar o começo mantém o estado do novo começo', () => {
    const cut = shiftKeyframes(list, -sec(2))!;
    expect(cut[0]).toMatchObject({ at: 0 });
    expect(cut[0]!.x).toBeCloseTo(0.2);
    expect(cut[1]).toMatchObject({ at: sec(1), x: 0.4 });
  });

  it('velocidade estica ou encolhe os tempos', () => {
    expect(scaleKeyframes(list, 0.5)!.map((k) => k.at)).toEqual([sec(0.5), sec(1.5)]);
  });

  it('dividir põe um keyframe na emenda das duas partes', () => {
    const [a, b] = splitKeyframes(list, sec(2));
    expect(a!.map((k) => k.at)).toEqual([sec(1), sec(2)]);
    expect(b!.map((k) => k.at)).toEqual([0, sec(1)]);
    expect(a![1]!.x).toBeCloseTo(0.2);
    expect(b![0]!.x).toBeCloseTo(0.2);
  });
});

describe('keyframes: no projeto', () => {
  const base = () => {
    const p = projectWith(10);
    return { p, id: p.main[0]!.id };
  };

  it('o primeiro keyframe guarda o estado atual; mover em outro instante cria outro', () => {
    const { p, id } = base();
    let q = toggleKeyframe(p, id, sec(1));
    expect((findItem(q, id)!.item as MainClip).keyframes).toHaveLength(1);
    q = updateTransform(q, id, { x: 0.5 }, sec(4));
    const clip = findItem(q, id)!.item as MainClip;
    expect(clip.keyframes!.map((k) => [k.at, k.x])).toEqual([
      [sec(1), 0],
      [sec(4), 0.5],
    ]);
    // no meio, o item está a caminho (curva suave: no meio, exatamente o meio)
    expect(itemStateAt(q, id, sec(2.5))!.transform.x).toBeCloseTo(0.25);
    // e o transform fixo do item não mudou
    expect(clip.transform.x).toBe(0);
  });

  it('sem keyframes, mover muda o item inteiro', () => {
    const { p, id } = base();
    const q = updateTransform(p, id, { x: 0.3 }, sec(4));
    expect((findItem(q, id)!.item as MainClip).transform.x).toBe(0.3);
    expect((findItem(q, id)!.item as MainClip).keyframes).toBeUndefined();
  });

  it('tirar o último keyframe deixa o item parado onde estava', () => {
    const { p, id } = base();
    let q = toggleKeyframe(p, id, sec(1));
    q = updateTransform(q, id, { x: 0.6 }, sec(1));
    q = toggleKeyframe(q, id, sec(1));
    const clip = findItem(q, id)!.item as MainClip;
    expect(clip.keyframes).toBeUndefined();
    expect(clip.transform.x).toBeCloseTo(0.6);
  });

  it('opacidade e curva vão para o keyframe da agulha; limpar fixa o estado', () => {
    const { p, id } = base();
    let q = toggleKeyframe(p, id, 0);
    q = setItemOpacity(q, id, 0.2, sec(5));
    q = setKeyframeEase(q, id, 0, 'linear');
    const clip = findItem(q, id)!.item as MainClip;
    expect(clip.keyframes!.map((k) => [k.at, k.opacity, k.ease])).toEqual([
      [0, 1, 'linear'],
      [sec(5), 0.2, 'smooth'],
    ]);
    const cleared = clearKeyframes(q, id, sec(5));
    expect(findItem(cleared, id)!.item).toMatchObject({ opacity: 0.2, keyframes: undefined });
  });

  it('cortar, dividir e mudar a velocidade mantêm a animação no lugar', () => {
    const { p, id } = base();
    let q = toggleKeyframe(p, id, sec(2));
    q = updateTransform(q, id, { x: 1 }, sec(6));
    // cortar 1 s do começo: os keyframes andam 1 s para a esquerda
    const trimmed = trimItem(q, id, 'start', sec(1));
    expect((findItem(trimmed, id)!.item as MainClip).keyframes!.map((k) => k.at)).toEqual([sec(1), sec(5)]);
    // 2x mais rápido: tudo na metade do tempo
    const fast = setSpeed(q, id, 2, true);
    expect((findItem(fast, id)!.item as MainClip).keyframes!.map((k) => k.at)).toEqual([sec(1), sec(3)]);
    // dividir em 4 s: a segunda parte começa no meio do caminho
    const r = splitItem(q, id, sec(4))!;
    const second = findItem(r.project, r.id)!.item as MainClip;
    expect(second.keyframes![0]).toMatchObject({ at: 0 });
    expect(second.keyframes![0]!.x).toBeCloseTo(0.5);
  });

  it('o plano de desenho leva os keyframes', () => {
    const { p, id } = base();
    const q = toggleKeyframe(p, id, sec(1));
    expect(buildRenderPlan(q).main[0]!.clip.keyframes).toHaveLength(1);
    expect(buildRenderPlan(p).main[0]!.clip.keyframes).toBeNull();
  });
});
