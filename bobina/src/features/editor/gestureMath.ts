/**
 * Regras dos gestos de mover, aproximar e girar no preview, separadas da tela
 * para serem testadas.
 */

/** Giro abaixo disso, no começo do gesto, é tremida dos dedos durante a pinça. */
export const ROTATION_DEADZONE = 4;
/** Ímã do giro nos ângulos retos e do tamanho em 100%. */
export const ROTATION_SNAP = 3;
export const SCALE_SNAP = 0.03;

export interface RotationGate {
  /** O giro já "pegou" neste gesto. */
  engaged: boolean;
  /** Quanto descontar (a zona morta já vencida, com o sinal do giro). */
  offset: number;
}

/**
 * Giro efetivo do gesto: zero até o dedo girar mais que a zona morta; depois,
 * o giro descontado da zona morta (sem salto ao começar a girar).
 */
export function gatedRotation(raw: number, gate: RotationGate): number {
  if (!gate.engaged) {
    if (Math.abs(raw) < ROTATION_DEADZONE) return 0;
    gate.engaged = true;
    gate.offset = Math.sign(raw) * ROTATION_DEADZONE;
  }
  return raw - gate.offset;
}

/** Encaixa em 0°, 90°, 180°… quando está perto. */
export function snapRotation(deg: number): { value: number; snapped: boolean } {
  const nearest = Math.round(deg / 90) * 90;
  return Math.abs(deg - nearest) < ROTATION_SNAP ? { value: nearest, snapped: true } : { value: deg, snapped: false };
}

/** Encaixa em 100% quando está perto. */
export function snapScale(scale: number): { value: number; snapped: boolean } {
  return Math.abs(scale - 1) < SCALE_SNAP ? { value: 1, snapped: true } : { value: scale, snapped: false };
}
