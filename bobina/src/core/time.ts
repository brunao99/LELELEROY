import type { Micros } from './types';

export const SEC: Micros = 1_000_000;
export const MS: Micros = 1_000;

/** Menor duração de um clipe na timeline. */
export const MIN_CLIP: Micros = 100_000;
export const DEFAULT_IMAGE_DURATION: Micros = 3 * SEC;
export const MAX_IMAGE_DURATION: Micros = 10 * 60 * SEC;
export const DEFAULT_TEXT_DURATION: Micros = 3 * SEC;
export const MIN_TRANSITION: Micros = 100_000;
export const DEFAULT_TRANSITION: Micros = 500_000;

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 100;

export function sec(seconds: number): Micros {
  'worklet';
  return Math.round(seconds * SEC);
}

export function toSec(us: Micros): number {
  'worklet';
  return us / SEC;
}

export function clamp(value: number, lo: number, hi: number): number {
  'worklet';
  return Math.min(hi, Math.max(lo, value));
}

/** `00:03.2`, ou `1:02:03.4` acima de uma hora. */
export function formatTime(us: Micros, withTenths = true): string {
  const totalTenths = Math.floor(Math.max(0, us) / 100_000);
  const tenths = totalTenths % 10;
  const totalSec = Math.floor(totalTenths / 10);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const base = h > 0 ? `${h}:${mmss}` : mmss;
  return withTenths ? `${base}.${tenths}` : base;
}

/** `4,5s` para rótulos curtos (selo de duração, leitor de tela). */
export function formatSeconds(us: Micros): string {
  const s = Math.round(us / 100_000) / 10;
  return `${s.toFixed(1).replace('.', ',')}s`;
}

export function formatSpeed(speed: number): string {
  return `${speed >= 10 ? speed.toFixed(0) : speed.toFixed(1)}x`;
}
