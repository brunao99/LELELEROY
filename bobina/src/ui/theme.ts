/**
 * Tokens do design (replica/design/tokens.json). O teste `theme.test.ts` garante
 * que estes valores são os mesmos do arquivo de tokens.
 */
export const colors = {
  bg: '#0b0c0f',
  surface: '#16181d',
  surfaceRaised: '#22252c',
  border: '#2c3038',
  borderInput: '#737a87',
  text: '#f4f5f7',
  textMuted: '#a4aab5',
  textFaint: '#8a909c',
  accent: '#ffb547',
  onAccent: '#1a1204',
  danger: '#ff6b6b',
  success: '#3dd68c',
  playhead: '#ffffff',
  trackVideo: '#ffb547',
  trackText: '#c49bff',
  trackAudio: '#3ccfc0',
  trackCaption: '#7aa2ff',
  trackOverlay: '#ff8cc6',
  trackFilter: '#ffd36e',
  onTrack: '#0b0c0f',
  scrim: '#000000',
} as const;

export const type = {
  xs: { fontSize: 11, lineHeight: 14, fontWeight: '500' },
  sm: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  base: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  lg: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  xl: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  display: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
} as const;

export const space = [0, 4, 8, 12, 16, 20, 24, 32, 48] as const;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

export const layout = {
  topBar: 48,
  toolbar: 68,
  toolbarItem: 64,
  ruler: 22,
  trackMain: 52,
  trackSecondary: 30,
  trackGap: 6,
  playheadWidth: 2,
  handleWidth: 16,
  touchMin: 44,
  pxPerSecondDefault: 60,
  pxPerSecondMin: 8,
  pxPerSecondMax: 600,
} as const;

export const motion = { fast: 120, base: 200 } as const;

/** Paleta rápida dos seletores de cor (texto, legenda, fundo). */
export const SWATCHES = [
  '#ffffff',
  '#000000',
  '#ffb547',
  '#ff6b6b',
  '#ff8cc6',
  '#c49bff',
  '#7aa2ff',
  '#3ccfc0',
  '#3dd68c',
  '#ffd36e',
  '#8a909c',
  '#5b3a29',
] as const;
