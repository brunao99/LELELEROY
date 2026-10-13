import { newId } from './ids';
import { DEFAULT_IMAGE_DURATION } from './time';
import type {
  Adjustments,
  Anim,
  AudioClip,
  AudioSource,
  CaptionTrack,
  Crop,
  MainClip,
  MediaAsset,
  Micros,
  OverlayClip,
  Project,
  TextItem,
  TextStyle,
  Transform,
  Visual,
} from './types';

export const SCHEMA_VERSION = 1 as const;

export const NO_ADJUST: Adjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  exposure: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  sharpen: 0,
  vignette: 0,
};

export const IDENTITY_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0 };
export const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 };
export const NO_ANIM: Anim = { kind: 'none', duration: 500_000 };

export function defaultVisual(): Visual {
  return {
    transform: { ...IDENTITY_TRANSFORM },
    crop: { ...FULL_CROP },
    flipH: false,
    flipV: false,
    opacity: 1,
    filter: null,
    adjust: { ...NO_ADJUST },
    animIn: { ...NO_ANIM },
    animOut: { ...NO_ANIM },
  };
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: 'inter',
  size: 0.07,
  color: '#ffffff',
  align: 'center',
  bold: true,
  italic: false,
  stroke: null,
  shadow: { color: '#000000', blur: 0.06, dx: 0, dy: 0.03 },
  background: null,
  opacity: 1,
  letterSpacing: 0,
  lineHeight: 1.2,
};

export const DEFAULT_CAPTION_STYLE: TextStyle = {
  font: 'montserrat',
  size: 0.055,
  color: '#ffffff',
  align: 'center',
  bold: true,
  italic: false,
  stroke: { color: '#000000', width: 0.12 },
  shadow: null,
  background: null,
  opacity: 1,
  letterSpacing: 0,
  lineHeight: 1.15,
};

export function defaultCaptionTrack(): CaptionTrack {
  return {
    items: [],
    style: { ...DEFAULT_CAPTION_STYLE },
    position: { x: 0, y: 0.3 },
    language: null,
    source: 'video',
    maybeOutOfSync: false,
  };
}

/** Trecho inicial de uma mídia: o arquivo inteiro, ou 3 s para fotos. */
export function initialRange(asset: MediaAsset): { sourceIn: Micros; sourceOut: Micros } {
  if (asset.kind === 'image') return { sourceIn: 0, sourceOut: DEFAULT_IMAGE_DURATION };
  return { sourceIn: 0, sourceOut: asset.duration };
}

export function makeMainClip(asset: MediaAsset): MainClip {
  return {
    kind: 'main',
    id: newId('c'),
    assetId: asset.id,
    ...initialRange(asset),
    speed: 1,
    keepPitch: true,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    ...defaultVisual(),
    transitionOut: null,
  };
}

export function makeOverlayClip(asset: MediaAsset, start: Micros, layer: number): OverlayClip {
  const visual = defaultVisual();
  return {
    kind: 'overlay',
    id: newId('o'),
    assetId: asset.id,
    ...initialRange(asset),
    speed: 1,
    keepPitch: true,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    ...visual,
    transform: { ...visual.transform, scale: 0.5 },
    start,
    layer,
    blend: 'normal',
  };
}

export function makeAudioClip(
  asset: MediaAsset,
  start: Micros,
  layer: number,
  source: AudioSource,
  name: string,
): AudioClip {
  return {
    kind: 'audio',
    id: newId('a'),
    assetId: asset.id,
    sourceIn: 0,
    sourceOut: asset.duration,
    speed: 1,
    keepPitch: true,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    start,
    layer,
    source,
    name,
  };
}

export function makeTextItem(
  text: string,
  start: Micros,
  duration: Micros,
  layer: number,
  style: TextStyle = DEFAULT_TEXT_STYLE,
): TextItem {
  return {
    kind: 'text',
    id: newId('t'),
    start,
    duration,
    layer,
    text,
    style: { ...style },
    transform: { ...IDENTITY_TRANSFORM },
    animIn: { ...NO_ANIM },
    animOut: { ...NO_ANIM },
    animLoop: 'none',
  };
}

export interface NewProjectInput {
  id?: string;
  name: string;
  now: number;
  assets: MediaAsset[];
}

/** Projeto novo com as mídias na faixa principal, na ordem escolhida. */
export function createProject({ id, name, now, assets }: NewProjectInput): Project {
  const assetMap: Record<string, MediaAsset> = {};
  for (const a of assets) assetMap[a.id] = a;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: id ?? newId('p'),
    name,
    createdAt: now,
    updatedAt: now,
    ratio: 'original',
    background: { kind: 'blur', amount: 0.5 },
    exportSettings: { resolution: 1080, fps: 30 },
    muteMain: false,
    assets: assetMap,
    main: assets.filter((a) => a.kind !== 'audio').map(makeMainClip),
    overlays: [],
    texts: [],
    audios: [],
    captions: defaultCaptionTrack(),
    coverTime: null,
    bakes: {},
  };
}

/** Nome padrão: "Projeto 13/10 14:05". */
export function defaultProjectName(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Projeto ${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
