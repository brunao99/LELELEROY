/**
 * Keyframes: o estado do item (posição, escala, rotação, opacidade) em
 * instantes escolhidos, interpolado entre eles. As funções de leitura são
 * 'worklet': rodam a cada quadro no desenho.
 */
import type { Keyframe, KeyframeEase, Micros, Transform } from './types';

/** Dois keyframes mais perto que isso são o mesmo (meio quadro a 30 qps). */
export const KEYFRAME_SNAP: Micros = 20_000;

export interface KeyState {
  transform: Transform;
  opacity: number;
}

function curve(ease: KeyframeEase, p: number): number {
  'worklet';
  if (ease === 'linear') return p;
  // Suave: acelera e desacelera (cubic in-out).
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

function stateOf(k: Keyframe): KeyState {
  'worklet';
  return { transform: { x: k.x, y: k.y, scale: k.scale, rotation: k.rotation }, opacity: k.opacity };
}

/**
 * Estado no instante `local` (µs desde o começo do item). Antes do primeiro
 * keyframe vale o primeiro; depois do último, o último.
 */
export function keyframeState(keyframes: Keyframe[], local: Micros): KeyState {
  'worklet';
  const n = keyframes.length;
  const first = keyframes[0]!;
  if (n === 1 || local <= first.at) return stateOf(first);
  const last = keyframes[n - 1]!;
  if (local >= last.at) return stateOf(last);
  let i = 0;
  while (i + 1 < n && keyframes[i + 1]!.at <= local) i++;
  const a = keyframes[i]!;
  const b = keyframes[i + 1]!;
  const span = b.at - a.at;
  const p = span > 0 ? curve(a.ease, (local - a.at) / span) : 1;
  const mix = (u: number, v: number) => u + (v - u) * p;
  return {
    transform: { x: mix(a.x, b.x), y: mix(a.y, b.y), scale: mix(a.scale, b.scale), rotation: mix(a.rotation, b.rotation) },
    opacity: mix(a.opacity, b.opacity),
  };
}

/** Estado do item no instante: dos keyframes, ou o fixo do item. */
export function liveState(
  item: { transform: Transform; keyframes?: Keyframe[] | null },
  baseOpacity: number,
  local: Micros,
): KeyState {
  'worklet';
  const kfs = item.keyframes;
  if (kfs && kfs.length > 0) return keyframeState(kfs, local);
  return { transform: item.transform, opacity: baseOpacity };
}

/** Índice do keyframe a menos de `KEYFRAME_SNAP` de `local`, ou -1. */
export function keyframeIndexAt(keyframes: Keyframe[] | undefined, local: Micros): number {
  if (!keyframes) return -1;
  return keyframes.findIndex((k) => Math.abs(k.at - local) <= KEYFRAME_SNAP);
}

function sorted(list: Keyframe[]): Keyframe[] {
  return [...list].sort((a, b) => a.at - b.at);
}

/** Cria ou substitui o keyframe em `local` com o estado dado. */
export function upsertKeyframe(keyframes: Keyframe[] | undefined, local: Micros, state: KeyState, ease?: KeyframeEase): Keyframe[] {
  const list = keyframes ?? [];
  const i = keyframeIndexAt(list, local);
  const at = i >= 0 ? list[i]!.at : Math.max(0, Math.round(local));
  const k: Keyframe = { at, ...state.transform, opacity: state.opacity, ease: ease ?? (i >= 0 ? list[i]!.ease : 'smooth') };
  if (i >= 0) return list.map((old, j) => (j === i ? k : old));
  return sorted([...list, k]);
}

/** Desloca todos os keyframes (cortar o começo do item) e descarta os que caem antes de 0 sem perder o estado inicial. */
export function shiftKeyframes(keyframes: Keyframe[] | undefined, delta: Micros): Keyframe[] | undefined {
  if (!keyframes || keyframes.length === 0 || delta === 0) return keyframes;
  if (delta > 0) return keyframes.map((k) => ({ ...k, at: k.at + delta }));
  // Cortou o começo: o que estava em -delta passa a ser o 0.
  const cut = -delta;
  const kept = keyframes.filter((k) => k.at >= cut).map((k) => ({ ...k, at: k.at - cut }));
  // Nenhum keyframe foi cortado: só andam para a esquerda.
  if (keyframes[0]!.at >= cut) return kept;
  if (kept.length > 0 && kept[0]!.at <= KEYFRAME_SNAP) return kept;
  const start = keyframeState(keyframes, cut);
  const prev = [...keyframes].reverse().find((k) => k.at < cut);
  return [{ at: 0, ...start.transform, opacity: start.opacity, ease: prev?.ease ?? 'smooth' }, ...kept];
}

/** Mudou a velocidade: o mesmo trecho dura `factor` vezes o que durava. */
export function scaleKeyframes(keyframes: Keyframe[] | undefined, factor: number): Keyframe[] | undefined {
  if (!keyframes || factor === 1) return keyframes;
  return keyframes.map((k) => ({ ...k, at: Math.round(k.at * factor) }));
}

/**
 * Divide em `local`: cada parte fica com os seus keyframes e, na emenda, um
 * keyframe com o estado daquele instante (assim nada pula).
 */
export function splitKeyframes(keyframes: Keyframe[] | undefined, local: Micros): [Keyframe[] | undefined, Keyframe[] | undefined] {
  if (!keyframes || keyframes.length === 0) return [keyframes, keyframes];
  const at = keyframeState(keyframes, local);
  const prev = [...keyframes].reverse().find((k) => k.at <= local);
  const edge = (t: Micros): Keyframe => ({ at: t, ...at.transform, opacity: at.opacity, ease: prev?.ease ?? 'smooth' });
  const left = keyframes.filter((k) => k.at < local - KEYFRAME_SNAP);
  const right = keyframes.filter((k) => k.at > local + KEYFRAME_SNAP).map((k) => ({ ...k, at: k.at - local }));
  return [[...left, edge(local)], [edge(0), ...right]];
}
