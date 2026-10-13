/**
 * Animações e transições como números puros. Estas funções rodam dentro do
 * worklet de desenho (preview e exportação), por isso têm a diretiva 'worklet'.
 */
import type { AnimKind, LoopAnimKind, TransitionKind } from './types';

export interface MotionState {
  opacity: number;
  scale: number;
  /** Deslocamento em fração do quadro. */
  dx: number;
  dy: number;
  /** Graus. */
  rotation: number;
}

export const REST: MotionState = { opacity: 1, scale: 1, dx: 0, dy: 0, rotation: 0 };

export function easeOutCubic(t: number): number {
  'worklet';
  const u = 1 - t;
  return 1 - u * u * u;
}

export function easeInOutCubic(t: number): number {
  'worklet';
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutBack(t: number): number {
  'worklet';
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Estado de uma animação de entrada (`progress` 0 → 1 = começando → parado).
 * Para a saída, chame com `1 - progressDaSaida`: a saída é a entrada ao contrário.
 */
export function animState(kind: AnimKind, progress: number): MotionState {
  'worklet';
  const p = Math.min(1, Math.max(0, progress));
  const e = easeOutCubic(p);
  switch (kind) {
    case 'none':
      return { opacity: 1, scale: 1, dx: 0, dy: 0, rotation: 0 };
    case 'fade':
      return { opacity: e, scale: 1, dx: 0, dy: 0, rotation: 0 };
    case 'zoomIn':
      return { opacity: e, scale: 0.6 + 0.4 * e, dx: 0, dy: 0, rotation: 0 };
    case 'zoomOut':
      return { opacity: e, scale: 1.4 - 0.4 * e, dx: 0, dy: 0, rotation: 0 };
    case 'slideUp':
      return { opacity: e, scale: 1, dx: 0, dy: 0.25 * (1 - e), rotation: 0 };
    case 'slideDown':
      return { opacity: e, scale: 1, dx: 0, dy: -0.25 * (1 - e), rotation: 0 };
    case 'slideLeft':
      return { opacity: e, scale: 1, dx: 0.3 * (1 - e), dy: 0, rotation: 0 };
    case 'slideRight':
      return { opacity: e, scale: 1, dx: -0.3 * (1 - e), dy: 0, rotation: 0 };
    case 'spin':
      return { opacity: e, scale: 0.7 + 0.3 * e, dx: 0, dy: 0, rotation: -120 * (1 - e) };
    case 'pop':
      return { opacity: Math.min(1, p * 3), scale: Math.max(0, easeOutBack(p)), dx: 0, dy: 0, rotation: 0 };
  }
}

/** Animação em laço (texto), em função do tempo dentro do item. */
export function loopState(kind: LoopAnimKind, seconds: number): MotionState {
  'worklet';
  switch (kind) {
    case 'none':
      return { opacity: 1, scale: 1, dx: 0, dy: 0, rotation: 0 };
    case 'pulse':
      return { opacity: 1, scale: 1 + 0.06 * Math.sin(seconds * Math.PI * 2), dx: 0, dy: 0, rotation: 0 };
    case 'float':
      return { opacity: 1, scale: 1, dx: 0, dy: 0.015 * Math.sin(seconds * Math.PI * 1.2), rotation: 0 };
    case 'blink':
      return { opacity: Math.sin(seconds * Math.PI * 2) > -0.4 ? 1 : 0.15, scale: 1, dx: 0, dy: 0, rotation: 0 };
    case 'wiggle':
      return { opacity: 1, scale: 1, dx: 0, dy: 0, rotation: 4 * Math.sin(seconds * Math.PI * 4) };
  }
}

/** Combina dois estados (as escalas multiplicam, os deslocamentos somam). */
export function combine(a: MotionState, b: MotionState): MotionState {
  'worklet';
  return {
    opacity: a.opacity * b.opacity,
    scale: a.scale * b.scale,
    dx: a.dx + b.dx,
    dy: a.dy + b.dy,
    rotation: a.rotation + b.rotation,
  };
}

/**
 * Estado das animações de entrada, saída e laço de um item no instante `local`
 * (microssegundos desde o começo do item).
 */
export function itemMotion(
  local: number,
  duration: number,
  animIn: { kind: AnimKind; duration: number },
  animOut: { kind: AnimKind; duration: number },
  loop: LoopAnimKind = 'none',
): MotionState {
  'worklet';
  let state: MotionState = { opacity: 1, scale: 1, dx: 0, dy: 0, rotation: 0 };
  const half = duration / 2;
  if (animIn.kind !== 'none') {
    const d = Math.min(animIn.duration, half);
    if (local < d) state = combine(state, animState(animIn.kind, d > 0 ? local / d : 1));
  }
  if (animOut.kind !== 'none') {
    const d = Math.min(animOut.duration, half);
    const fromEnd = duration - local;
    if (fromEnd < d) state = combine(state, animState(animOut.kind, d > 0 ? fromEnd / d : 1));
  }
  if (loop !== 'none') state = combine(state, loopState(loop, local / 1_000_000));
  return state;
}

export interface TransitionFrame {
  /** Clipe que sai. */
  a: MotionState;
  /** Clipe que entra. */
  b: MotionState;
  /** Cor chapada por cima (fade para preto/branco). */
  flash: { color: string; alpha: number } | null;
  /** Revelação de B por cortina ou círculo: fração revelada 0..1. */
  reveal: { shape: 'left' | 'right' | 'circle'; amount: number } | null;
}

/** Como desenhar os dois clipes no `progress` (0..1) de uma transição. */
export function transitionFrame(kind: TransitionKind, progress: number): TransitionFrame {
  'worklet';
  const p = Math.min(1, Math.max(0, progress));
  const e = easeInOutCubic(p);
  const rest = (): MotionState => ({ opacity: 1, scale: 1, dx: 0, dy: 0, rotation: 0 });
  const hidden = (): MotionState => ({ opacity: 0, scale: 1, dx: 0, dy: 0, rotation: 0 });
  switch (kind) {
    case 'dissolve':
      return { a: rest(), b: { ...rest(), opacity: e }, flash: null, reveal: null };
    case 'fadeBlack':
    case 'fadeWhite': {
      const color = kind === 'fadeBlack' ? '#000000' : '#ffffff';
      // Primeira metade escurece A, segunda metade clareia B.
      if (p < 0.5) return { a: rest(), b: hidden(), flash: { color, alpha: easeInOutCubic(p * 2) }, reveal: null };
      return { a: hidden(), b: rest(), flash: { color, alpha: 1 - easeInOutCubic((p - 0.5) * 2) }, reveal: null };
    }
    case 'slideLeft':
      return { a: { ...rest(), dx: -e }, b: { ...rest(), dx: 1 - e }, flash: null, reveal: null };
    case 'slideRight':
      return { a: { ...rest(), dx: e }, b: { ...rest(), dx: -(1 - e) }, flash: null, reveal: null };
    case 'slideUp':
      return { a: { ...rest(), dy: -e }, b: { ...rest(), dy: 1 - e }, flash: null, reveal: null };
    case 'slideDown':
      return { a: { ...rest(), dy: e }, b: { ...rest(), dy: -(1 - e) }, flash: null, reveal: null };
    case 'zoomIn':
      return {
        a: { ...rest(), scale: 1 + 0.6 * e, opacity: 1 - e },
        b: { ...rest(), scale: 0.6 + 0.4 * e, opacity: e },
        flash: null,
        reveal: null,
      };
    case 'zoomOut':
      return {
        a: { ...rest(), scale: 1 - 0.4 * e, opacity: 1 - e },
        b: { ...rest(), scale: 1.6 - 0.6 * e, opacity: e },
        flash: null,
        reveal: null,
      };
    case 'wipeLeft':
      return { a: rest(), b: rest(), flash: null, reveal: { shape: 'left', amount: e } };
    case 'wipeRight':
      return { a: rest(), b: rest(), flash: null, reveal: { shape: 'right', amount: e } };
    case 'circle':
      return { a: rest(), b: rest(), flash: null, reveal: { shape: 'circle', amount: e } };
  }
}

export interface TransitionInfo {
  kind: TransitionKind;
  name: string;
}

/** Transições próprias, feitas só com transformações e máscaras simples. */
export const TRANSITIONS: TransitionInfo[] = [
  { kind: 'dissolve', name: 'Dissolver' },
  { kind: 'fadeBlack', name: 'Preto' },
  { kind: 'fadeWhite', name: 'Branco' },
  { kind: 'slideLeft', name: 'Deslizar ←' },
  { kind: 'slideRight', name: 'Deslizar →' },
  { kind: 'slideUp', name: 'Deslizar ↑' },
  { kind: 'slideDown', name: 'Deslizar ↓' },
  { kind: 'zoomIn', name: 'Aproximar' },
  { kind: 'zoomOut', name: 'Afastar' },
  { kind: 'wipeLeft', name: 'Cortina ←' },
  { kind: 'wipeRight', name: 'Cortina →' },
  { kind: 'circle', name: 'Círculo' },
];

export interface AnimInfo {
  kind: AnimKind;
  name: string;
}

export const ANIMATIONS: AnimInfo[] = [
  { kind: 'none', name: 'Nenhuma' },
  { kind: 'fade', name: 'Surgir' },
  { kind: 'zoomIn', name: 'Crescer' },
  { kind: 'zoomOut', name: 'Encolher' },
  { kind: 'slideUp', name: 'Subir' },
  { kind: 'slideDown', name: 'Descer' },
  { kind: 'slideLeft', name: 'Da direita' },
  { kind: 'slideRight', name: 'Da esquerda' },
  { kind: 'spin', name: 'Girar' },
  { kind: 'pop', name: 'Saltar' },
];

export const LOOP_ANIMATIONS: { kind: LoopAnimKind; name: string }[] = [
  { kind: 'none', name: 'Nenhuma' },
  { kind: 'pulse', name: 'Pulsar' },
  { kind: 'float', name: 'Flutuar' },
  { kind: 'blink', name: 'Piscar' },
  { kind: 'wiggle', name: 'Balançar' },
];
