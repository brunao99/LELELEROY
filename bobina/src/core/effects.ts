/**
 * Efeitos de vídeo próprios (feitos do zero, sem material de terceiros) e o
 * chroma key. Uns mexem no movimento do clipe (tremida, pulsar), outros são
 * desenhados por shader (engine/shaders.ts) e o desfoque é um filtro do Skia.
 */
import type { ChromaKey, EffectKind } from './types';
import type { MotionState } from './motion';

export interface EffectInfo {
  kind: EffectKind;
  name: string;
}

export const EFFECTS: EffectInfo[] = [
  { kind: 'blur', name: 'Desfoque' },
  { kind: 'shake', name: 'Tremida' },
  { kind: 'glitch', name: 'Glitch' },
  { kind: 'rgb', name: 'RGB' },
  { kind: 'grain', name: 'VHS' },
  { kind: 'pixelate', name: 'Pixelado' },
  { kind: 'pulse', name: 'Pulsar' },
  { kind: 'flash', name: 'Flash' },
];

/** Código do efeito no shader (0: o efeito não é de shader). */
export function shaderKind(kind: EffectKind | null | undefined): number {
  'worklet';
  switch (kind) {
    case 'glitch':
      return 1;
    case 'rgb':
      return 2;
    case 'grain':
      return 3;
    case 'pixelate':
      return 4;
    case 'flash':
      return 5;
    default:
      return 0;
  }
}

/** Movimento dos efeitos de tremida e pulsar no instante `seconds` do clipe. */
export function effectMotion(kind: EffectKind | null | undefined, amount: number, seconds: number): MotionState {
  'worklet';
  if (kind === 'shake') {
    // Soma de senos com frequências "quebradas": parece aleatório e é igual em toda exportação.
    const a = 0.018 * amount;
    const dx = a * (Math.sin(seconds * 37.1) * 0.6 + Math.sin(seconds * 23.3 + 1.7) * 0.4);
    const dy = a * (Math.sin(seconds * 29.7 + 0.5) * 0.6 + Math.sin(seconds * 41.9 + 2.3) * 0.4);
    return { opacity: 1, scale: 1 + 0.03 * amount, dx, dy, rotation: 1.2 * amount * Math.sin(seconds * 19.3) };
  }
  if (kind === 'pulse') {
    // Duas batidas por segundo: cresce rápido e volta.
    const beat = Math.pow(Math.max(0, Math.sin(seconds * Math.PI * 4)), 6);
    return { opacity: 1, scale: 1 + 0.08 * amount * beat, dx: 0, dy: 0, rotation: 0 };
  }
  return { opacity: 1, scale: 1, dx: 0, dy: 0, rotation: 0 };
}

/** Desfoque em pixels da textura (sigma) para a intensidade. */
export function blurSigma(amount: number, textureSide: number): number {
  'worklet';
  return Math.max(0.5, amount * 0.025 * textureSide);
}

/** "#rrggbb" (ou "#rgb") → [r, g, b] em 0..255. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export interface ChromaUniforms {
  cb: number;
  cr: number;
  similarity: number;
  smoothness: number;
}

/** A cor do chroma em tom (CbCr), como o shader compara. */
export function chromaUniforms(key: ChromaKey): ChromaUniforms {
  const [r, g, b] = hexToRgb(key.color).map((v) => v / 255) as [number, number, number];
  return {
    cb: -0.168736 * r - 0.331264 * g + 0.5 * b,
    cr: 0.5 * r - 0.418688 * g - 0.081312 * b,
    similarity: key.similarity,
    smoothness: key.smoothness,
  };
}

export const CHROMA_PRESETS: { color: string; name: string }[] = [
  { color: '#00b140', name: 'Tela verde' },
  { color: '#0047bb', name: 'Tela azul' },
];

export const DEFAULT_CHROMA: ChromaKey = { color: '#00b140', similarity: 0.12, smoothness: 0.08 };
