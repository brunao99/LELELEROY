/**
 * Abertura do Ledit's: medidas da marca e do logotipo (assets/brand) e a linha
 * do tempo. Funções puras e 'worklet': rodam na thread de UI a cada quadro e
 * também nos testes.
 *
 * Roteiro (ms), estilo "bolhas":
 *   0–500     bolhas âmbar desfocadas acendem em volta da marca e flutuam
 *   350–950   as bolhas são puxadas para o centro e se fundem na marca, que
 *             acende (um brilho suave atrás dela e um reflexo diagonal)
 *   950–1450  a marca encolhe e vai para a esquerda, para o lugar dela no logotipo
 *   1150–1790 as letras "edit's" sobem de trás da linha de base, uma de cada vez
 *   1800–2300 o app aparece por uma bolha de borda macia que cresce do centro
 */

/** assets/brand/wordmark.png */
export const WORDMARK = { width: 822, height: 262 } as const;
/** Colunas de cada parte do logotipo, em px da imagem: a marca e as letras e, d, i, t, 's. */
export const WORDMARK_SEGMENTS = [
  [8, 155],
  [161, 308],
  [328, 476],
  [509, 544],
  [560, 644],
  [666, 818],
] as const;
/** Corpo (sem o brilho) da marca dentro do logotipo, em px da imagem. */
const WORDMARK_MARK_BODY = { x0: 8, y0: 8, x1: 154, y1: 253 };
/** assets/brand/mark.png (quadrada) e o corpo da marca dentro dela. */
export const MARK = { size: 418 } as const;
const MARK_BODY = { x0: 74, y0: 27, x1: 351, y1: 398 };

/** Tamanho da marca na tela de abertura nativa (app.json, expo-splash-screen imageWidth). */
export const SPLASH_SIZE = 120;
/** Altura do logotipo no fim da abertura. */
export const WORDMARK_HEIGHT = 58;

export const T = {
  orbsIn: 500,
  gatherStart: 350,
  gatherEnd: 950,
  bloomPeak: 950,
  bloomOut: 1400,
  shineStart: 820,
  shineEnd: 1250,
  moveStart: 950,
  moveEnd: 1450,
  swapStart: 1250,
  swapEnd: 1450,
  lettersStart: 1150,
  letterStagger: 55,
  letterDuration: 420,
  exitStart: 1800,
  end: 2300,
} as const;

/**
 * As bolhas: ângulo inicial (rad), distância do centro (fração do lado menor
 * da tela), raio (dp), giro (rad/s), cor e opacidade máxima. Poucas, grandes e
 * bem desfocadas, como luz fora de foco.
 */
export const ORBS = [
  { angle: -2.4, dist: 0.36, r: 46, spin: 0.35, color: "#ff8a3d", alpha: 0.55 },
  { angle: -0.9, dist: 0.42, r: 34, spin: -0.3, color: "#ffb547", alpha: 0.5 },
  { angle: 0.35, dist: 0.3, r: 26, spin: 0.45, color: "#ffd9a0", alpha: 0.45 },
  { angle: 1.25, dist: 0.46, r: 52, spin: -0.25, color: "#ff6a2b", alpha: 0.5 },
  { angle: 2.2, dist: 0.33, r: 30, spin: 0.4, color: "#ffb547", alpha: 0.55 },
  { angle: 3.0, dist: 0.5, r: 22, spin: -0.4, color: "#ffd9a0", alpha: 0.4 },
  { angle: -1.7, dist: 0.24, r: 18, spin: 0.5, color: "#ff8a3d", alpha: 0.5 },
] as const;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IntroLayout {
  /** Onde a abertura nativa desenha a marca (quadrado). */
  splash: Rect;
  /** Onde a mesma imagem da marca fica quando encaixa no logotipo. */
  markFinal: Rect;
  /** O logotipo inteiro no fim. */
  wordmark: Rect;
  /** Escala imagem do logotipo → tela. */
  k: number;
  center: { x: number; y: number };
  /** Raio que cobre a tela inteira a partir do centro. */
  cover: number;
}

export function introLayout(width: number, height: number): IntroLayout {
  const cx = width / 2;
  const cy = height / 2;
  const k = WORDMARK_HEIGHT / WORDMARK.height;
  const ww = WORDMARK.width * k;
  const wordmark = {
    x: cx - ww / 2,
    y: cy - WORDMARK_HEIGHT / 2,
    width: ww,
    height: WORDMARK_HEIGHT,
  };
  // A marca grande encaixa com o corpo dela sobre o corpo da marca do logotipo.
  const bodyH = (WORDMARK_MARK_BODY.y1 - WORDMARK_MARK_BODY.y0) * k;
  const s = bodyH / (MARK_BODY.y1 - MARK_BODY.y0);
  const targetCx =
    wordmark.x + ((WORDMARK_MARK_BODY.x0 + WORDMARK_MARK_BODY.x1) / 2) * k;
  const targetCy =
    wordmark.y + ((WORDMARK_MARK_BODY.y0 + WORDMARK_MARK_BODY.y1) / 2) * k;
  const bodyCx = (MARK_BODY.x0 + MARK_BODY.x1) / 2;
  const bodyCy = (MARK_BODY.y0 + MARK_BODY.y1) / 2;
  const markFinal = {
    x: targetCx - bodyCx * s,
    y: targetCy - bodyCy * s,
    width: MARK.size * s,
    height: MARK.size * s,
  };
  const splash = {
    x: cx - SPLASH_SIZE / 2,
    y: cy - SPLASH_SIZE / 2,
    width: SPLASH_SIZE,
    height: SPLASH_SIZE,
  };
  return {
    splash,
    markFinal,
    wordmark,
    k,
    center: { x: cx, y: cy },
    cover: Math.hypot(width, height) / 2 + 24,
  };
}

/** 0..1 do trecho [start, start + duration]. */
export function phase(t: number, start: number, duration: number): number {
  "worklet";
  if (duration <= 0) return t >= start ? 1 : 0;
  return Math.min(1, Math.max(0, (t - start) / duration));
}

/** Saída forte (perto de cubic-bezier(0.23, 1, 0.32, 1)). */
export function easeOut(p: number): number {
  "worklet";
  return 1 - Math.pow(1 - p, 4);
}

/** Movimento na tela (perto de cubic-bezier(0.77, 0, 0.175, 1)). */
export function easeInOut(p: number): number {
  "worklet";
  return p < 0.5 ? 8 * p * p * p * p : 1 - Math.pow(-2 * p + 2, 4) / 2;
}

export function mix(a: number, b: number, p: number): number {
  "worklet";
  return a + (b - a) * p;
}

export function mixRect(a: Rect, b: Rect, p: number): Rect {
  "worklet";
  return {
    x: mix(a.x, b.x, p),
    y: mix(a.y, b.y, p),
    width: mix(a.width, b.width, p),
    height: mix(a.height, b.height, p),
  };
}

/**
 * Posição, raio e opacidade da bolha `i` no instante `t`, em volta de
 * `center`. `short` é o lado menor da tela. Cada bolha acende e é puxada com um
 * pequeno atraso em relação à anterior, e balança um pouco enquanto gira.
 */
export function orbState(
  t: number,
  i: number,
  center: { x: number; y: number },
  short: number,
): { x: number; y: number; r: number; opacity: number } {
  "worklet";
  const o = ORBS[i] ?? ORBS[0];
  const appear = easeOut(phase(t, i * 45, T.orbsIn));
  const gather = easeInOut(
    phase(t, T.gatherStart + i * 25, T.gatherEnd - T.gatherStart - 150),
  );
  const angle = o.angle + (o.spin * t) / 1000;
  const wobble = 1 + 0.06 * Math.sin(t / 260 + i * 1.7);
  const d = o.dist * short * wobble * (1 - gather) * (0.85 + 0.15 * appear);
  return {
    x: center.x + Math.cos(angle) * d,
    y: center.y + Math.sin(angle) * d,
    r: o.r * (0.7 + 0.3 * appear) * (1 - 0.65 * gather),
    opacity: o.alpha * appear * (1 - gather * gather),
  };
}

/** Brilho atrás da marca quando as bolhas se fundem: sobe com elas, some devagar. */
export function bloomOpacity(t: number): number {
  "worklet";
  if (t < T.bloomPeak)
    return easeInOut(
      phase(t, T.gatherStart + 200, T.bloomPeak - T.gatherStart - 200),
    );
  return 1 - easeOut(phase(t, T.bloomPeak, T.bloomOut - T.bloomPeak));
}

/** Deslocamento (0 = no lugar, 1 = escondida) e opacidade da letra `i` (0 = "e"). */
export function letterState(
  t: number,
  i: number,
): { rise: number; opacity: number } {
  "worklet";
  const p = easeOut(
    phase(t, T.lettersStart + i * T.letterStagger, T.letterDuration),
  );
  return { rise: 1 - p, opacity: Math.min(1, p * 1.6) };
}
