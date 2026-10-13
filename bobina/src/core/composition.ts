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
  from: Micros;
  to: Micros;
  /** Precisa do vídeo acelerado (clipes visuais) e/ou do áudio (clipes com som). */
  needsVideo: boolean;
  needsAudio: boolean;
}

export interface CompositionResult {
  composition: Composition | null;
  /** Clipes com velocidade sem cópia pronta. Enquanto isso tocam a 1x (vídeo) e mudos. */
  missing: BakeRequest[];
}

export interface CompositionOptions {
  /** Converte um caminho relativo da pasta do projeto em caminho absoluto (sem `file://`). */
  resolve: (relative: string) => string;
  /** No preview, reduz os vídeos para no máximo este lado (poupa o decodificador). */
  previewMaxSide?: number;
}

const US = 1_000_000;

export function bakeKey(assetId: string, speed: number, keepPitch: boolean): string {
  return `${assetId}@${speed.toFixed(3)}${keepPitch ? 'p' : ''}`;
}

/** Uma cópia serve se for da mesma mídia e velocidade e cobrir o trecho do clipe. */
export function findBake(
  project: Project,
  clip: { assetId: string; speed: number; keepPitch: boolean; sourceIn: Micros; sourceOut: Micros },
): Bake | undefined {
  const bake = project.bakes[bakeKey(clip.assetId, clip.speed, clip.keepPitch)];
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

export function buildComposition(project: Project, options: CompositionOptions): CompositionResult {
  const total = projectDuration(project);
  const missing: BakeRequest[] = [];
  if (total <= 0) return { composition: null, missing };
  const items: CompositionItem[] = [];
  const { resolve, previewMaxSide } = options;

  const visual = (clip: MainClip | OverlayClip, start: Micros, audible: boolean) => {
    const asset = project.assets[clip.assetId];
    if (!asset || asset.kind !== 'video') return;
    const duration = clipDuration(clip);
    const end = Math.min(start + duration, total);
    if (end <= start) return;
    const resolution = previewResolution(asset, previewMaxSide);
    if (clip.speed === 1) {
      items.push({
        id: clip.id,
        path: resolve(asset.file),
        compositionStartTime: start / US,
        startTime: clip.sourceIn / US,
        duration: (end - start) / US,
        ...(resolution ? { resolution } : {}),
        audio: audible ? { volume: clip.volume } : false,
      });
      return;
    }
    const bake = findBake(project, clip);
    if (bake?.videoFile) {
      items.push({
        id: clip.id,
        path: resolve(bake.videoFile),
        compositionStartTime: start / US,
        startTime: (clip.sourceIn - bake.from) / clip.speed / US,
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
    if (audible && bake?.audioFile) {
      items.push({
        kind: 'audio',
        id: `${clip.id}#a`,
        path: resolve(bake.audioFile),
        compositionStartTime: start / US,
        startTime: (clip.sourceIn - bake.from) / clip.speed / US,
        duration: (end - start) / US,
        volume: clip.volume,
      });
    }
    if (!bake?.videoFile || (audible && !bake?.audioFile)) {
      addRequest(missing, {
        key: bakeKey(clip.assetId, clip.speed, clip.keepPitch),
        assetId: clip.assetId,
        speed: clip.speed,
        keepPitch: clip.keepPitch,
        from: clip.sourceIn,
        to: clip.sourceOut,
        needsVideo: true,
        needsAudio: audible,
      });
    }
  };

  for (const slot of layoutMain(project)) {
    const asset = project.assets[slot.clip.assetId];
    const audible = !project.muteMain && !!asset && isAudible(slot.clip.volume, asset);
    visual(slot.clip, slot.start, audible);
  }
  for (const overlay of project.overlays) {
    const asset = project.assets[overlay.assetId];
    visual(overlay, overlay.start, !!asset && isAudible(overlay.volume, asset));
  }
  for (const clip of project.audios) addAudioItem(project, clip, total, resolve, items, missing);

  return { composition: { duration: total / US, items }, missing };
}

function addAudioItem(
  project: Project,
  clip: AudioClip,
  total: Micros,
  resolve: (relative: string) => string,
  items: CompositionItem[],
  missing: BakeRequest[],
) {
  const asset = project.assets[clip.assetId];
  if (!asset || !isAudible(clip.volume, asset)) return;
  const end = Math.min(clip.start + clipDuration(clip), total);
  if (end <= clip.start) return;
  if (clip.speed === 1) {
    items.push({
      kind: 'audio',
      id: clip.id,
      path: resolve(asset.file),
      compositionStartTime: clip.start / US,
      startTime: clip.sourceIn / US,
      duration: (end - clip.start) / US,
      volume: clip.volume,
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
      startTime: (clip.sourceIn - bake.from) / clip.speed / US,
      duration: (end - clip.start) / US,
      volume: clip.volume,
    });
    return;
  }
  addRequest(missing, {
    key: bakeKey(clip.assetId, clip.speed, clip.keepPitch),
    assetId: clip.assetId,
    speed: clip.speed,
    keepPitch: clip.keepPitch,
    from: clip.sourceIn,
    to: clip.sourceOut,
    needsVideo: false,
    needsAudio: true,
  });
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
