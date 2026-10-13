/**
 * Cor: ajustes e filtros viram uma matriz 4×5 (o formato de `ColorFilter.MakeMatrix`
 * do Skia, com valores de cor em 0..1). Os ajustes que não são lineares (realces,
 * sombras, nitidez, vinheta) vão separados para o shader.
 */
import { NO_ADJUST } from './defaults';
import type { Adjustments, FilterRef } from './types';

/** Matriz 4×5 em ordem de linhas: R, G, B, A. */
export type ColorMatrix = number[];

export const IDENTITY_MATRIX: ColorMatrix = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
];

/** `a` depois de `b` (aplica `b` primeiro). */
export function multiply(a: ColorMatrix, b: ColorMatrix): ColorMatrix {
  const out = new Array<number>(20).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[row * 5 + k]! * b[k * 5 + col]!;
      if (col === 4) sum += a[row * 5 + 4]!;
      out[row * 5 + col] = sum;
    }
  }
  return out;
}

export function isIdentity(m: ColorMatrix, epsilon = 1e-6): boolean {
  return m.every((v, i) => Math.abs(v - IDENTITY_MATRIX[i]!) < epsilon);
}

/** Mistura entre a identidade e `m` (para a intensidade do filtro). */
export function mix(m: ColorMatrix, amount: number): ColorMatrix {
  return m.map((v, i) => IDENTITY_MATRIX[i]! + (v - IDENTITY_MATRIX[i]!) * amount);
}

const LUMA = [0.2126, 0.7152, 0.0722] as const;

export function saturationMatrix(s: number): ColorMatrix {
  const [lr, lg, lb] = LUMA;
  const inv = 1 - s;
  return [
    lr * inv + s, lg * inv, lb * inv, 0, 0,
    lr * inv, lg * inv + s, lb * inv, 0, 0,
    lr * inv, lg * inv, lb * inv + s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

export function contrastMatrix(c: number): ColorMatrix {
  const t = 0.5 * (1 - c);
  return [
    c, 0, 0, 0, t,
    0, c, 0, 0, t,
    0, 0, c, 0, t,
    0, 0, 0, 1, 0,
  ];
}

export function brightnessMatrix(b: number): ColorMatrix {
  return [
    1, 0, 0, 0, b,
    0, 1, 0, 0, b,
    0, 0, 1, 0, b,
    0, 0, 0, 1, 0,
  ];
}

export function scaleMatrix(r: number, g: number, b: number): ColorMatrix {
  return [
    r, 0, 0, 0, 0,
    0, g, 0, 0, 0,
    0, 0, b, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** Temperatura (−1 frio … 1 quente) e matiz (−1 verde … 1 magenta). */
export function temperatureTintMatrix(temperature: number, tint: number): ColorMatrix {
  const r = 1 + 0.18 * temperature + 0.06 * tint;
  const g = 1 - 0.12 * tint;
  const b = 1 - 0.18 * temperature + 0.06 * tint;
  return scaleMatrix(r, g, b);
}

/** Converte os ajustes (−100..100) numa matriz única. A ordem segue a de um editor comum. */
export function adjustmentsMatrix(adjust: Adjustments): ColorMatrix {
  let m = IDENTITY_MATRIX;
  if (adjust.exposure) {
    const gain = Math.pow(2, adjust.exposure / 100);
    m = multiply(scaleMatrix(gain, gain, gain), m);
  }
  if (adjust.brightness) m = multiply(brightnessMatrix((adjust.brightness / 100) * 0.25), m);
  if (adjust.contrast) m = multiply(contrastMatrix(1 + adjust.contrast / 100), m);
  if (adjust.saturation) m = multiply(saturationMatrix(1 + adjust.saturation / 100), m);
  if (adjust.temperature || adjust.tint) {
    m = multiply(temperatureTintMatrix(adjust.temperature / 100, adjust.tint / 100), m);
  }
  return m;
}

export interface FilterPreset {
  id: string;
  name: string;
  /** Feito com os mesmos ajustes do painel, para ser fácil de entender e mudar. */
  adjust: Partial<Adjustments>;
  /** Mistura extra de cor (sépia, tons frios...), aplicada depois dos ajustes. */
  extra?: ColorMatrix;
}

const SEPIA: ColorMatrix = [
  0.393, 0.769, 0.189, 0, 0,
  0.349, 0.686, 0.168, 0, 0,
  0.272, 0.534, 0.131, 0, 0,
  0, 0, 0, 1, 0,
];

const TEAL_ORANGE: ColorMatrix = [
  1.08, 0.02, -0.06, 0, 0.01,
  -0.02, 1.02, 0.0, 0, 0.0,
  -0.08, 0.06, 1.06, 0, 0.03,
  0, 0, 0, 1, 0,
];

/** Filtros próprios do Bobina, feitos do zero. */
export const FILTERS: FilterPreset[] = [
  { id: 'vivo', name: 'Vivo', adjust: { saturation: 35, contrast: 12 } },
  { id: 'suave', name: 'Suave', adjust: { contrast: -18, brightness: 8, saturation: -10 } },
  { id: 'quente', name: 'Quente', adjust: { temperature: 35, saturation: 8 } },
  { id: 'frio', name: 'Frio', adjust: { temperature: -35, tint: -6 } },
  { id: 'pb', name: 'P&B', adjust: { saturation: -100, contrast: 15 } },
  { id: 'noir', name: 'Noir', adjust: { saturation: -100, contrast: 45, exposure: -10 } },
  { id: 'retro', name: 'Retrô', adjust: { contrast: -8, saturation: -20 }, extra: mix(SEPIA, 0.55) },
  { id: 'sepia', name: 'Sépia', adjust: {}, extra: SEPIA },
  { id: 'cinema', name: 'Cinema', adjust: { contrast: 18, saturation: -8 }, extra: TEAL_ORANGE },
  { id: 'verao', name: 'Verão', adjust: { exposure: 10, temperature: 22, saturation: 18 } },
  { id: 'noite', name: 'Noite', adjust: { exposure: -25, temperature: -25, contrast: 10 } },
  { id: 'desbotado', name: 'Desbotado', adjust: { contrast: -35, brightness: 12, saturation: -30 } },
];

export function findFilter(id: string): FilterPreset | undefined {
  return FILTERS.find((f) => f.id === id);
}

export function filterMatrix(filter: FilterRef | null): ColorMatrix {
  if (!filter) return IDENTITY_MATRIX;
  const preset = findFilter(filter.id);
  if (!preset) return IDENTITY_MATRIX;
  let m = adjustmentsMatrix({ ...NO_ADJUST, ...preset.adjust });
  if (preset.extra) m = multiply(preset.extra, m);
  return mix(m, Math.min(1, Math.max(0, filter.intensity)));
}

/** Matriz final de um clipe: filtro primeiro, ajustes manuais por cima. `null` quando não muda nada. */
export function clipColorMatrix(filter: FilterRef | null, adjust: Adjustments): ColorMatrix | null {
  const m = multiply(adjustmentsMatrix(adjust), filterMatrix(filter));
  return isIdentity(m) ? null : m;
}

/** Parâmetros que precisam do shader (não cabem numa matriz). Todos 0 = desligado. */
export interface ShaderParams {
  highlights: number;
  shadows: number;
  sharpen: number;
  vignette: number;
}

export function clipShaderParams(adjust: Adjustments): ShaderParams | null {
  const p = {
    highlights: adjust.highlights / 100,
    shadows: adjust.shadows / 100,
    sharpen: adjust.sharpen / 100,
    vignette: adjust.vignette / 100,
  };
  return p.highlights || p.shadows || p.sharpen || p.vignette ? p : null;
}
