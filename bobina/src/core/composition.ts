/**
 * Projeto → itens do motor de vídeo (@azzapp/react-native-skia-video).
 *
 * O motor recebe tempos em segundos e toca tudo a 1x. Clipes com outra velocidade
 * usam a cópia já acelerada ("bake"). Fotos e textos não são itens: são desenhados
 * direto pelo `drawProject`.
 */
import { clipDuration, layoutMain, projectDuration } from './timeline';
import type { AudioClip, Bake, MainClip, MediaAsset, Micros, OverlayClip, Project } from './types';

export interface CompositionVideoItem {
  kind?: 'video';
  id: string;
  path: string;
  compositionStartTime: number;
  startTime: number;
  duration: number;
  resolution?: { width: number; height: number };
  audio?: boolean | { volume?: number };
}

export interface CompositionAudioItem {
  kind: 'audio';
  id: string;
  path: string;
  compositionStartTime: number;
  startTime: number;
  duration: number;
  volume?: number;
}

export type CompositionItem = CompositionVideoItem | CompositionAudioItem;

export interface Composition {
  duration: number;
  items: CompositionItem[];
}

/** Uma cópia acelerada que ainda precisa ser feita. */
export interface BakeRequest {
  key: string;
  assetId: string;
  speed: number;
  keepPitch: boolean;
  /** Cópia de trás para frente. */
  reverse: boolean;
  from: Micros;
  to: Micros;
  /** Precisa do vídeo acelerado (clipes visuais) e/ou do áudio (clipes com som). */
  needsVideo: boolean;
  needsAudio: boolean;
}

/** Áudio de um clipe com fade, processado à parte (o motor só tem volume constante). */
export interface AudioRenderRequest {
  key: string;
  assetId: string;
  speed: number;
  keepPitch: boolean;
  reverse: boolean;
  sourceIn: Micros;
  sourceOut: Micros;
  fadeIn: Micros;
  fadeOut: Micros;
  /** Ganho aplicado no WAV (volume acima de 100%); 1 quando não há. */
  gain: number;
}

export interface CompositionResult {
  composition: Composition | null;
  /** Clipes com velocidade sem cópia pronta. Enquanto isso tocam a 1x (vídeo) e mudos. */
  missing: BakeRequest[];
  /** Clipes com fade sem o áudio processado. Enquanto isso tocam sem fade. */
  missingAudio: AudioRenderRequest[];
}

export interface CompositionOptions {
  /** Converte um caminho relativo da pasta do projeto em caminho absoluto (sem `file://`). */
  resolve: (relative: string) => string;
  /** No preview, reduz os vídeos para no máximo este lado (poupa o decodificador). */
  previewMaxSide?: number;
  /** Mídias cujo arquivo sumiu: os clipes delas ficam de fora (preto e mudo). */
  unavailable?: ReadonlySet<string>;
}

const US = 1_000_000;

/**
 * Chave da cópia acelerada. O sufixo de versão muda quando a cópia passa a ser
 * feita de outro jeito (v2: resolução da mídia e 60 qps); as antigas deixam de
 * servir e são apagadas ao abrir o projeto.
 */
export function bakeKey(assetId: string, speed: number, keepPitch: boolean, reverse = false): string {
  return `${assetId}@${speed.toFixed(3)}${keepPitch ? 'p' : ''}${reverse ? 'r' : ''}~v2`;
}

/** O motor só toca para frente e a 1x: outra velocidade ou o inverso pedem uma cópia. */
export function needsBake(clip: { speed: number; reverse?: boolean }): boolean {
  return clip.speed !== 1 || !!clip.reverse;
}

/**
 * Onde o clipe começa dentro da cópia (segundos). A cópia invertida começa no
 * fim do trecho original.
 */
function bakeOffset(clip: { sourceIn: Micros; sourceOut: Micros; speed: number; reverse?: boolean }, bake: Bake): number {
  const from = clip.reverse ? bake.to - clip.sourceOut : clip.sourceIn - bake.from;
  return from / clip.speed / US;
}

type AudioClipLike = {
  assetId: string;
  speed: number;
  keepPitch: boolean;
  reverse?: boolean;
  sourceIn: Micros;
  sourceOut: Micros;
  fadeIn: Micros;
  fadeOut: Micros;
  volume: number;
};

/** Fade ou volume acima de 100%: o motor só tem volume constante até 1. */
export function needsAudioRender(clip: Pick<AudioClipLike, 'fadeIn' | 'fadeOut' | 'volume'>): boolean {
  return clip.fadeIn > 0 || clip.fadeOut > 0 || clip.volume > 1;
}

function renderGain(clip: Pick<AudioClipLike, 'volume'>): number {
  return clip.volume > 1 ? Math.round(clip.volume * 100) / 100 : 1;
}

export function audioRenderKey(clip: AudioClipLike): string {
  const parts = [clip.assetId, clip.speed.toFixed(3), clip.keepPitch ? 'p' : '', clip.sourceIn, clip.sourceOut, clip.fadeIn, clip.fadeOut];
  const gain = renderGain(clip);
  if (gain !== 1) parts.push(`g${gain}`);
  if (clip.reverse) parts.push('r');
  return parts.join('|');
}

/** Uma cópia serve se for da mesma mídia e velocidade e cobrir o trecho do clipe. */
export function findBake(
  project: Project,
  clip: { assetId: string; speed: number; keepPitch: boolean; reverse?: boolean; sourceIn: Micros; sourceOut: Micros },
): Bake | undefined {
  const bake = project.bakes[bakeKey(clip.assetId, clip.speed, clip.keepPitch, !!clip.reverse)];
  if (!bake) return undefined;
  return bake.from <= clip.sourceIn && bake.to >= clip.sourceOut ? bake : undefined;
}

function previewResolution(asset: MediaAsset, maxSide: number | undefined) {
  if (!maxSide || asset.width <= 0 || asset.height <= 0) return undefined;
  const longest = Math.max(asset.width, asset.height);
  if (longest <= maxSide) return undefined;
  const k = maxSide / longest;
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { width: even(asset.width), height: even(asset.height) };
}

function isAudible(volume: number, asset: MediaAsset): boolean {
  return volume > 0 && (asset.kind === 'audio' || asset.hasAudio);
}

/** Junta pedidos de cópia da mesma chave num trecho só. */
function addRequest(list: BakeRequest[], request: BakeRequest) {
  const same = list.find((r) => r.key === request.key);
  if (!same) {
    list.push(request);
    return;
  }
  same.from = Math.min(same.from, request.from);
  same.to = Math.max(same.to, request.to);
  same.needsVideo = same.needsVideo || request.needsVideo;
  same.needsAudio = same.needsAudio || request.needsAudio;
}

interface Collect {
  project: Project;
  total: Micros;
  resolve: (relative: string) => string;
  items: CompositionItem[];
  missing: BakeRequest[];
  missingAudio: AudioRenderRequest[];
  unavailable: ReadonlySet<string>;
}

/**
 * Som de um clipe que precisa de processamento (fade): usa o WAV pronto ou pede
 * um. Devolve true quando o som já está resolvido (item adicionado).
 */
function addRenderedAudio(c: Collect, clip: AudioClipLike & { id: string }, start: Micros, end: Micros, id: string): boolean {
  const key = audioRenderKey(clip);
  const render = c.project.audioRenders[key];
  if (render) {
    c.items.push({
      kind: 'audio',
      id,
      path: c.resolve(render.file),
      compositionStartTime: start / US,
      startTime: 0,
      duration: (end - start) / US,
      // O ganho acima de 1 já está no arquivo.
      volume: Math.min(1, clip.volume),
    });
    return true;
  }
  if (!c.missingAudio.some((r) => r.key === key)) {
    c.missingAudio.push({
      key,
      assetId: clip.assetId,
      speed: clip.speed,
      keepPitch: clip.keepPitch,
      reverse: !!clip.reverse,
      sourceIn: clip.sourceIn,
      sourceOut: clip.sourceOut,
      fadeIn: clip.fadeIn,
      fadeOut: clip.fadeOut,
      gain: renderGain(clip),
    });
  }
  return false;
}

function addVisual(c: Collect, clip: MainClip | OverlayClip, start: Micros, audible: boolean, previewMaxSide?: number) {
  const { project, total, resolve, items, missing } = c;
  const asset = project.assets[clip.assetId];
  if (!asset || asset.kind !== 'video' || c.unavailable.has(asset.id)) return;
  const duration = clipDuration(clip);
  const end = Math.min(start + duration, total);
  if (end <= start) return;
  const resolution = previewResolution(asset, previewMaxSide);
  // Com fade, o som vem do WAV processado; o vídeo fica mudo.
  const rendered = audible && needsAudioRender(clip) ? addRenderedAudio(c, clip, start, end, `${clip.id}#a`) : false;
  const fadePending = audible && needsAudioRender(clip) && !rendered;

  if (!needsBake(clip)) {
    items.push({
      id: clip.id,
      path: resolve(asset.file),
      compositionStartTime: start / US,
      startTime: clip.sourceIn / US,
      duration: (end - start) / US,
      ...(resolution ? { resolution } : {}),
      // Enquanto o fade não fica pronto, toca o som original.
      audio: audible && !rendered ? { volume: Math.min(1, clip.volume) } : false,
    });
    return;
  }
  const bake = findBake(project, clip);
  if (bake?.videoFile) {
    items.push({
      id: clip.id,
      path: resolve(bake.videoFile),
      compositionStartTime: start / US,
      startTime: bakeOffset(clip, bake),
      duration: (end - start) / US,
      ...(resolution ? { resolution } : {}),
      audio: false,
    });
  } else {
    // Sem a cópia ainda: mostra a mídia a 1x pelo tempo do clipe, até onde ela der.
    const available = Math.max(0, asset.duration - clip.sourceIn);
    const shown = Math.min(end - start, available);
    if (shown > 0) {
      items.push({
        id: clip.id,
        path: resolve(asset.file),
        compositionStartTime: start / US,
        startTime: clip.sourceIn / US,
        duration: shown / US,
        ...(resolution ? { resolution } : {}),
        audio: false,
      });
    }
  }
  const wantBakedAudio = audible && !rendered && (!needsAudioRender(clip) || fadePending);
  if (wantBakedAudio && bake?.audioFile) {
    items.push({
      kind: 'audio',
      id: `${clip.id}#a`,
      path: resolve(bake.audioFile),
      compositionStartTime: start / US,
      startTime: bakeOffset(clip, bake),
      duration: (end - start) / US,
      volume: Math.min(1, clip.volume),
    });
  }
  const needsAudio = audible && !needsAudioRender(clip);
  if (!bake?.videoFile || (needsAudio && !bake?.audioFile)) {
    addRequest(missing, {
      key: bakeKey(clip.assetId, clip.speed, clip.keepPitch, !!clip.reverse),
      assetId: clip.assetId,
      speed: clip.speed,
      keepPitch: clip.keepPitch,
      reverse: !!clip.reverse,
      from: clip.sourceIn,
      to: clip.sourceOut,
      needsVideo: true,
      needsAudio,
    });
  }
}

function addAudioItem(c: Collect, clip: AudioClip) {
  const { project, total, resolve, items, missing } = c;
  const asset = project.assets[clip.assetId];
  if (!asset || c.unavailable.has(asset.id) || !isAudible(clip.volume, asset)) return;
  const end = Math.min(clip.start + clipDuration(clip), total);
  if (end <= clip.start) return;
  if (needsAudioRender(clip) && addRenderedAudio(c, clip, clip.start, end, clip.id)) return;
  if (!needsBake(clip)) {
    items.push({
      kind: 'audio',
      id: clip.id,
      path: resolve(asset.file),
      compositionStartTime: clip.start / US,
      startTime: clip.sourceIn / US,
      duration: (end - clip.start) / US,
      volume: Math.min(1, clip.volume),
    });
    return;
  }
  const bake = findBake(project, clip);
  if (bake?.audioFile) {
    items.push({
      kind: 'audio',
      id: clip.id,
      path: resolve(bake.audioFile),
      compositionStartTime: clip.start / US,
      startTime: bakeOffset(clip, bake),
      duration: (end - clip.start) / US,
      volume: Math.min(1, clip.volume),
    });
    return;
  }
  if (needsAudioRender(clip)) return;
  addRequest(missing, {
    key: bakeKey(clip.assetId, clip.speed, clip.keepPitch, !!clip.reverse),
    assetId: clip.assetId,
    speed: clip.speed,
    keepPitch: clip.keepPitch,
    reverse: !!clip.reverse,
    from: clip.sourceIn,
    to: clip.sourceOut,
    needsVideo: false,
    needsAudio: true,
  });
}

export function buildComposition(project: Project, options: CompositionOptions): CompositionResult {
  const total = projectDuration(project);
  const c: Collect = {
    project,
    total,
    resolve: options.resolve,
    items: [],
    missing: [],
    missingAudio: [],
    unavailable: options.unavailable ?? new Set(),
  };
  if (total <= 0) return { composition: null, missing: [], missingAudio: [] };
  for (const slot of layoutMain(project)) {
    const asset = project.assets[slot.clip.assetId];
    const audible = !project.muteMain && !!asset && isAudible(slot.clip.volume, asset);
    addVisual(c, slot.clip, slot.start, audible, options.previewMaxSide);
  }
  for (const overlay of project.overlays) {
    const asset = project.assets[overlay.assetId];
    addVisual(c, overlay, overlay.start, !!asset && isAudible(overlay.volume, asset), options.previewMaxSide);
  }
  for (const clip of project.audios) addAudioItem(c, clip);
  return { composition: { duration: total / US, items: c.items }, missing: c.missing, missingAudio: c.missingAudio };
}

// ---------------------------------------------------------------- janelas

/** Quantos vídeos o preview e a exportação decodificam de uma vez, no máximo. */
export const MAX_VIDEO_ITEMS_PER_WINDOW = 6;

export interface TimeWindow {
  /** Segundos. */
  start: number;
  end: number;
}

function isVideo(item: CompositionItem): item is CompositionVideoItem {
  return item.kind !== 'audio';
}

function itemEndSec(item: CompositionItem): number {
  return item.compositionStartTime + item.duration;
}

/**
 * Divide a timeline em janelas com no máximo `maxVideo` vídeos cada. O motor abre
 * um decodificador por vídeo da composição, e o aparelho tem um limite.
 * Com poucos vídeos, a janela é o projeto inteiro.
 */
export function planWindows(composition: Composition, maxVideo = MAX_VIDEO_ITEMS_PER_WINDOW): TimeWindow[] {
  const duration = composition.duration;
  const videos = composition.items.filter(isVideo).sort((a, b) => a.compositionStartTime - b.compositionStartTime);
  if (videos.length <= maxVideo) return [{ start: 0, end: duration }];
  const windows: TimeWindow[] = [];
  let start = 0;
  while (start < duration) {
    // Candidatos a corte: começos de vídeos depois de `start`.
    const touching = (end: number) =>
      videos.filter((v) => v.compositionStartTime < end && itemEndSec(v) > start).length;
    let end = duration;
    const cuts = videos.map((v) => v.compositionStartTime).filter((t) => t > start + 1e-6);
    for (const cut of cuts) {
      if (touching(cut + 1e-6) > maxVideo) {
        end = cut;
        break;
      }
    }
    if (end <= start + 1e-6) {
      // Mais de `maxVideo` vídeos no mesmo instante: janela mínima até o próximo corte.
      end = cuts.find((t) => t > start + 1e-6) ?? duration;
    }
    windows.push({ start, end });
    start = end;
  }
  return windows;
}

export function windowAt(windows: TimeWindow[], seconds: number): TimeWindow {
  for (const w of windows) if (seconds >= w.start && seconds < w.end) return w;
  return windows[windows.length - 1]!;
}

/** Composição só com o que toca dentro da janela (a duração continua a do projeto). */
export function compositionForWindow(composition: Composition, window: TimeWindow): Composition {
  const items = composition.items.filter(
    (it) => it.compositionStartTime < window.end && itemEndSec(it) > window.start,
  );
  return { duration: composition.duration, items };
}

/** Chave que muda só quando o que o motor precisa decodificar muda (não com textos ou filtros). */
export function compositionSignature(composition: Composition | null): string {
  if (!composition) return 'empty';
  const parts = composition.items.map((it) =>
    [
      it.id,
      it.path,
      it.compositionStartTime.toFixed(4),
      it.startTime.toFixed(4),
      it.duration.toFixed(4),
      isVideo(it) ? JSON.stringify(it.audio ?? false) + JSON.stringify(it.resolution ?? null) : `v${it.volume ?? 1}`,
    ].join('|'),
  );
  return `${composition.duration.toFixed(4)}::${parts.join(';')}`;
}
