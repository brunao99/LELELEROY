import { MAX_IMAGE_DURATION, MIN_CLIP, MIN_TRANSITION } from './time';
import type {
  AudioClip,
  ClipBase,
  MainClip,
  MediaAsset,
  Micros,
  OverlayClip,
  Project,
  TextItem,
  TimedItem,
  Transition,
} from './types';

/** Duração de um clipe na timeline: trecho da mídia ÷ velocidade. */
export function clipDuration(clip: Pick<ClipBase, 'sourceIn' | 'sourceOut' | 'speed'>): Micros {
  return Math.max(MIN_CLIP, Math.round((clip.sourceOut - clip.sourceIn) / clip.speed));
}

/** Até onde o fim do trecho pode ir dentro da mídia. Fotos não têm fim. */
export function sourceLimit(asset: MediaAsset | undefined): Micros {
  if (!asset || asset.kind === 'image') return MAX_IMAGE_DURATION;
  return asset.duration;
}

export function itemStart(item: TimedItem): Micros {
  return item.start;
}

export function itemDuration(item: TimedItem): Micros {
  return item.kind === 'text' ? item.duration : clipDuration(item);
}

export function itemEnd(item: TimedItem): Micros {
  return itemStart(item) + itemDuration(item);
}

export interface MainSlot {
  clip: MainClip;
  index: number;
  start: Micros;
  end: Micros;
  duration: Micros;
  /** Transição vinda do clipe anterior, já com a duração efetiva. */
  transitionIn: Transition | null;
  /** Transição para o próximo clipe, já com a duração efetiva. */
  transitionOut: Transition | null;
  /** Fim da parte "própria" do clipe: onde o próximo começa (ou `end`, no último). */
  coreEnd: Micros;
}

/**
 * Duração efetiva de uma transição entre dois clipes: no máximo metade do mais
 * curto, para nunca haver três clipes ao mesmo tempo.
 */
export function effectiveTransition(
  transition: Transition | null,
  durationA: Micros,
  durationB: Micros,
): Transition | null {
  if (!transition) return null;
  const max = Math.floor(Math.min(durationA, durationB) / 2);
  const duration = Math.min(transition.duration, max);
  if (duration < MIN_TRANSITION) return null;
  return duration === transition.duration ? transition : { ...transition, duration };
}

/** Posições da faixa principal. As transições sobrepõem o fim de um clipe ao começo do seguinte. */
export function layoutMain(project: Pick<Project, 'main'>): MainSlot[] {
  const clips = project.main;
  const durations = clips.map(clipDuration);
  const slots: MainSlot[] = [];
  let start = 0;
  let incoming: Transition | null = null;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]!;
    const duration = durations[i]!;
    const next = durations[i + 1];
    const outgoing = next === undefined ? null : effectiveTransition(clip.transitionOut, duration, next);
    const end = start + duration;
    const coreEnd = outgoing ? end - outgoing.duration : end;
    slots.push({
      clip,
      index: i,
      start,
      end,
      duration,
      transitionIn: incoming,
      transitionOut: outgoing,
      coreEnd,
    });
    start = coreEnd;
    incoming = outgoing;
  }
  return slots;
}

export function mainDuration(project: Pick<Project, 'main'>): Micros {
  const slots = layoutMain(project);
  return slots.length ? slots[slots.length - 1]!.end : 0;
}

/** Duração do vídeo: até o fim da última coisa visível. Áudio além disso é cortado. */
export function projectDuration(project: Project): Micros {
  let end = mainDuration(project);
  for (const o of project.overlays) end = Math.max(end, itemEnd(o));
  for (const t of project.texts) end = Math.max(end, itemEnd(t));
  return end;
}

/** O clipe da faixa principal "dono" do instante `t` (no trecho de transição, o anterior). */
export function mainSlotAt(slots: MainSlot[], t: Micros): MainSlot | undefined {
  if (slots.length === 0) return undefined;
  for (const slot of slots) {
    if (t >= slot.start && t < slot.coreEnd) return slot;
  }
  const last = slots[slots.length - 1]!;
  return t >= last.end ? undefined : last;
}

/** Onde inserir mídia nova com a agulha em `t`: antes do clipe se a agulha está na primeira metade dele. */
export function insertIndexAt(project: Pick<Project, 'main'>, t: Micros): number {
  const slots = layoutMain(project);
  const slot = mainSlotAt(slots, t);
  if (!slot) return t <= 0 ? 0 : slots.length;
  const middle = (slot.start + slot.coreEnd) / 2;
  return t < middle ? slot.index : slot.index + 1;
}

type Layered = { id: string; layer: number; start: Micros } & (
  | Pick<OverlayClip, 'kind' | 'sourceIn' | 'sourceOut' | 'speed'>
  | Pick<AudioClip, 'kind' | 'sourceIn' | 'sourceOut' | 'speed'>
  | Pick<TextItem, 'kind' | 'duration'>
);

function layeredEnd(item: Layered): Micros {
  return item.start + (item.kind === 'text' ? item.duration : clipDuration(item));
}

/** Primeira camada em que o intervalo [start, end) cabe sem encostar em ninguém. */
export function firstFreeLayer(
  items: readonly Layered[],
  start: Micros,
  end: Micros,
  ignoreId?: string,
): number {
  for (let layer = 0; ; layer++) {
    const clash = items.some(
      (it) => it.id !== ignoreId && it.layer === layer && it.start < end && layeredEnd(it) > start,
    );
    if (!clash) return layer;
  }
}

/** Limites para um item crescer sem invadir os vizinhos da mesma camada. */
export function neighborBounds(
  items: readonly Layered[],
  item: Layered,
): { prevEnd: Micros; nextStart: Micros } {
  let prevEnd = 0;
  let nextStart = Number.POSITIVE_INFINITY;
  const start = item.start;
  for (const other of items) {
    if (other.id === item.id || other.layer !== item.layer) continue;
    const otherEnd = layeredEnd(other);
    if (otherEnd <= start + 1) prevEnd = Math.max(prevEnd, otherEnd);
    else if (other.start >= start) nextStart = Math.min(nextStart, other.start);
  }
  return { prevEnd, nextStart };
}

/** Número de camadas usadas (para desenhar as linhas da timeline). */
export function layerCount(items: readonly { layer: number }[]): number {
  let max = -1;
  for (const it of items) max = Math.max(max, it.layer);
  return max + 1;
}
