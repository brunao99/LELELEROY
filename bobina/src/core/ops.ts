/**
 * Operações de edição. Todas são puras: recebem um projeto e devolvem outro
 * (ou o mesmo objeto, quando nada muda). Nenhuma lê o relógio ou o disco.
 */
import { NO_ANIM, makeAudioClip, makeMainClip, makeOverlayClip, makeTextItem } from './defaults';
import { newId } from './ids';
import {
  keyframeIndexAt,
  liveState,
  scaleKeyframes,
  shiftKeyframes,
  splitKeyframes,
  upsertKeyframe,
  type KeyState,
} from './keyframes';
import {
  DEFAULT_IMAGE_DURATION,
  DEFAULT_TEXT_DURATION,
  MAX_IMAGE_DURATION,
  MAX_SPEED,
  MIN_CLIP,
  MIN_SPEED,
  clamp,
} from './time';
import {
  clipDuration,
  firstFreeLayer,
  itemDuration,
  itemEnd,
  layoutMain,
  neighborBounds,
  projectDuration,
  sourceLimit,
} from './timeline';
import type {
  AudioClip,
  AudioSource,
  Background,
  Caption,
  CaptionHighlight,
  CaptionSource,
  CaptionWord,
  KeyframeEase,
  ExportSettings,
  ItemKind,
  MainClip,
  MediaAsset,
  Micros,
  OverlayClip,
  Project,
  Ratio,
  TextItem,
  TextStyle,
  Transform,
  Transition,
  Visual,
} from './types';

export type AnyItem = MainClip | OverlayClip | AudioClip | TextItem | Caption;

export interface Found {
  kind: ItemKind;
  item: AnyItem;
}

export interface Added {
  project: Project;
  id: string;
}

export function findItem(project: Project, id: string): Found | null {
  const main = project.main.find((c) => c.id === id);
  if (main) return { kind: 'main', item: main };
  const overlay = project.overlays.find((c) => c.id === id);
  if (overlay) return { kind: 'overlay', item: overlay };
  const audio = project.audios.find((c) => c.id === id);
  if (audio) return { kind: 'audio', item: audio };
  const text = project.texts.find((c) => c.id === id);
  if (text) return { kind: 'text', item: text };
  const caption = project.captions.items.find((c) => c.id === id);
  if (caption) return { kind: 'caption', item: caption };
  return null;
}

/** Garante as regras do modelo que dependem da ordem (o último clipe não tem transição de saída). */
export function normalize(project: Project): Project {
  const last = project.main[project.main.length - 1];
  if (last && last.transitionOut) {
    return { ...project, main: [...project.main.slice(0, -1), { ...last, transitionOut: null }] };
  }
  return project;
}

function withCaptionsWarning(before: Project, after: Project): Project {
  if (after === before || after.captions.items.length === 0 || after.captions.maybeOutOfSync) return after;
  return { ...after, captions: { ...after.captions, maybeOutOfSync: true } };
}

function mapMain(project: Project, id: string, fn: (c: MainClip) => MainClip): Project {
  let changed = false;
  const main = project.main.map((c) => {
    if (c.id !== id) return c;
    const next = fn(c);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...project, main } : project;
}

function mapList<T extends { id: string }>(list: T[], id: string, fn: (c: T) => T): T[] | null {
  let changed = false;
  const next = list.map((c) => {
    if (c.id !== id) return c;
    const n = fn(c);
    if (n !== c) changed = true;
    return n;
  });
  return changed ? next : null;
}

function mapOverlay(project: Project, id: string, fn: (c: OverlayClip) => OverlayClip): Project {
  const overlays = mapList(project.overlays, id, fn);
  return overlays ? { ...project, overlays } : project;
}

function mapAudio(project: Project, id: string, fn: (c: AudioClip) => AudioClip): Project {
  const audios = mapList(project.audios, id, fn);
  return audios ? { ...project, audios } : project;
}

function mapText(project: Project, id: string, fn: (c: TextItem) => TextItem): Project {
  const texts = mapList(project.texts, id, fn);
  return texts ? { ...project, texts } : project;
}

function mapCaption(project: Project, id: string, fn: (c: Caption) => Caption): Project {
  const items = mapList(project.captions.items, id, fn);
  return items ? { ...project, captions: { ...project.captions, items } } : project;
}

// ---------------------------------------------------------------- mídia

export function addAssets(project: Project, assets: MediaAsset[]): Project {
  if (assets.length === 0) return project;
  const map = { ...project.assets };
  for (const a of assets) map[a.id] = a;
  return { ...project, assets: map };
}

/** Insere mídias na faixa principal a partir de `index`. */
export function insertMainClips(project: Project, clips: MainClip[], index: number): Project {
  if (clips.length === 0) return project;
  const at = clamp(index, 0, project.main.length);
  const main = [...project.main.slice(0, at), ...clips, ...project.main.slice(at)];
  return withCaptionsWarning(project, normalize({ ...project, main }));
}

// ---------------------------------------------------------------- cortar

export type Edge = 'start' | 'end';

function trimSource(
  clip: { sourceIn: Micros; sourceOut: Micros; speed: number; reverse?: boolean },
  asset: MediaAsset | undefined,
  edge: Edge,
  delta: Micros,
): { sourceIn: Micros; sourceOut: Micros } {
  const { sourceIn, sourceOut, speed } = clip;
  const minSpan = Math.ceil(MIN_CLIP * speed);
  if (asset?.kind === 'image') {
    // Foto: só a duração muda; o trecho sempre começa em 0.
    const length = sourceOut - sourceIn;
    const next = edge === 'start' ? length - delta : length + delta;
    return { sourceIn: 0, sourceOut: clamp(Math.round(next), MIN_CLIP, MAX_IMAGE_DURATION) };
  }
  if (clip.reverse) {
    // De trás para frente: o começo na timeline é o fim do trecho original.
    if (edge === 'start') {
      const next = clamp(Math.round(sourceOut - delta * speed), sourceIn + minSpan, sourceLimit(asset));
      return { sourceIn, sourceOut: next };
    }
    const next = clamp(Math.round(sourceIn - delta * speed), 0, sourceOut - minSpan);
    return { sourceIn: next, sourceOut };
  }
  if (edge === 'start') {
    const next = clamp(Math.round(sourceIn + delta * speed), 0, sourceOut - minSpan);
    return { sourceIn: next, sourceOut };
  }
  const next = clamp(Math.round(sourceOut + delta * speed), sourceIn + minSpan, sourceLimit(asset));
  return { sourceIn, sourceOut: next };
}

/**
 * Corta uma ponta. `delta` é o deslocamento da ponta na timeline (positivo = para a direita).
 * Itens soltos (sobreposição, áudio, texto, legenda) mantêm a outra ponta parada e não invadem vizinhos.
 */
export function trimItem(project: Project, id: string, edge: Edge, delta: Micros): Project {
  const found = findItem(project, id);
  if (!found || delta === 0) return project;
  switch (found.kind) {
    case 'main': {
      const clip = found.item as MainClip;
      const range = trimSource(clip, project.assets[clip.assetId], edge, delta);
      if (range.sourceIn === clip.sourceIn && range.sourceOut === clip.sourceOut) return project;
      // Cortar o começo desloca os keyframes junto com o conteúdo.
      const shift = edge === 'start' ? clipDuration({ ...clip, ...range }) - clipDuration(clip) : 0;
      return withCaptionsWarning(
        project,
        mapMain(project, id, (c) => ({ ...c, ...range, keyframes: shiftKeyframes(c.keyframes, shift) })),
      );
    }
    case 'overlay':
    case 'audio': {
      const clip = found.item as OverlayClip | AudioClip;
      const list = found.kind === 'overlay' ? project.overlays : project.audios;
      const { prevEnd, nextStart } = neighborBounds(list, clip);
      const asset = project.assets[clip.assetId];
      let wanted = delta;
      if (edge === 'start') wanted = Math.max(wanted, prevEnd - clip.start);
      else wanted = Math.min(wanted, nextStart - itemEnd(clip));
      const range = trimSource(clip, asset, edge, wanted);
      const oldDuration = clipDuration(clip);
      const newDuration = clipDuration({ ...clip, ...range });
      const start = edge === 'start' ? clip.start + (oldDuration - newDuration) : clip.start;
      if (range.sourceIn === clip.sourceIn && range.sourceOut === clip.sourceOut) return project;
      const shift = edge === 'start' ? newDuration - oldDuration : 0;
      const update = (c: OverlayClip | AudioClip) =>
        c.kind === 'overlay'
          ? { ...c, ...range, start: Math.max(0, start), keyframes: shiftKeyframes(c.keyframes, shift) }
          : { ...c, ...range, start: Math.max(0, start) };
      return found.kind === 'overlay'
        ? mapOverlay(project, id, update as (c: OverlayClip) => OverlayClip)
        : mapAudio(project, id, update as (c: AudioClip) => AudioClip);
    }
    case 'text': {
      const text = found.item as TextItem;
      const { prevEnd, nextStart } = neighborBounds(project.texts, text);
      const end = text.start + text.duration;
      if (edge === 'start') {
        const start = clamp(text.start + delta, Math.max(0, prevEnd), end - MIN_CLIP);
        if (start === text.start) return project;
        return mapText(project, id, (t) => ({ ...t, start, duration: end - start, keyframes: shiftKeyframes(t.keyframes, text.start - start) }));
      }
      const duration = clamp(text.duration + delta, MIN_CLIP, nextStart - text.start);
      if (duration === text.duration) return project;
      return mapText(project, id, (t) => ({ ...t, duration }));
    }
    case 'caption': {
      const caption = found.item as Caption;
      const items = project.captions.items;
      const i = items.findIndex((c) => c.id === id);
      const prevEnd = i > 0 ? items[i - 1]!.end : 0;
      const nextStart = i < items.length - 1 ? items[i + 1]!.start : Number.POSITIVE_INFINITY;
      if (edge === 'start') {
        const start = clamp(caption.start + delta, prevEnd, caption.end - MIN_CLIP);
        return start === caption.start ? project : mapCaption(project, id, (c) => ({ ...c, start }));
      }
      const end = clamp(caption.end + delta, caption.start + MIN_CLIP, nextStart);
      return end === caption.end ? project : mapCaption(project, id, (c) => ({ ...c, end }));
    }
  }
}

// ---------------------------------------------------------------- dividir

/** As palavras com tempo só valem enquanto formam exatamente o texto da legenda. */
function captionWords(caption: Caption): CaptionWord[] | null {
  const words = caption.words;
  if (!words || words.length === 0) return null;
  return words.map((w) => w.text).join(' ') === caption.text ? words : null;
}

function shiftWords(words: CaptionWord[] | undefined, delta: Micros): CaptionWord[] | undefined {
  return words?.map((w) => ({ ...w, start: w.start + delta, end: w.end + delta }));
}

function splitWords(text: string, fraction: number): [string, string] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [text, text];
  const k = clamp(Math.round(words.length * fraction), 1, words.length - 1);
  return [words.slice(0, k).join(' '), words.slice(k).join(' ')];
}

function splitClipRange<T extends MainClip | OverlayClip | AudioClip>(
  clip: T,
  asset: MediaAsset | undefined,
  local: Micros,
): [T, T] {
  const duration = clipDuration(clip);
  if (asset?.kind === 'image') {
    const a = { ...clip, sourceIn: 0, sourceOut: local };
    const b = { ...clip, id: newId(clip.id[0]), sourceIn: 0, sourceOut: duration - local };
    return [a, b];
  }
  if (clip.reverse) {
    // De trás para frente: a primeira parte na timeline é o fim do trecho original.
    const cut = clip.sourceOut - Math.round(local * clip.speed);
    return [
      { ...clip, sourceIn: cut },
      { ...clip, id: newId(clip.id[0]), sourceOut: cut },
    ];
  }
  const cut = clip.sourceIn + Math.round(local * clip.speed);
  const a = { ...clip, sourceOut: cut };
  const b = { ...clip, id: newId(clip.id[0]), sourceIn: cut };
  return [a, b];
}

/**
 * Divide o item no instante `t` da timeline. Devolve `null` quando a agulha está
 * a menos de 0,1 s de uma das pontas.
 */
export function splitItem(project: Project, id: string, t: Micros): Added | null {
  const found = findItem(project, id);
  if (!found) return null;
  switch (found.kind) {
    case 'main': {
      const slot = layoutMain(project).find((s) => s.clip.id === id)!;
      const local = t - slot.start;
      if (local < MIN_CLIP || slot.duration - local < MIN_CLIP) return null;
      const clip = slot.clip;
      const [a0, b0] = splitClipRange(clip, project.assets[clip.assetId], local);
      const [ka, kb] = splitKeyframes(clip.keyframes, local);
      const a: MainClip = { ...a0, transitionOut: null, animOut: { ...NO_ANIM }, fadeOut: 0, keyframes: ka };
      const b: MainClip = { ...b0, animIn: { ...NO_ANIM }, fadeIn: 0, keyframes: kb };
      const main = [...project.main];
      main.splice(slot.index, 1, a, b);
      return { project: { ...project, main }, id: b.id };
    }
    case 'overlay':
    case 'audio': {
      const clip = found.item as OverlayClip | AudioClip;
      const local = t - clip.start;
      const duration = clipDuration(clip);
      if (local < MIN_CLIP || duration - local < MIN_CLIP) return null;
      const [a0, b0] = splitClipRange(clip, project.assets[clip.assetId], local);
      const [ka, kb] = clip.kind === 'overlay' ? splitKeyframes(clip.keyframes, local) : [undefined, undefined];
      const a = { ...a0, fadeOut: 0, ...(ka ? { keyframes: ka } : {}) };
      const b = { ...b0, fadeIn: 0, start: clip.start + clipDuration(a0), ...(kb ? { keyframes: kb } : {}) };
      if (found.kind === 'overlay') {
        const oa = { ...(a as OverlayClip), animOut: { ...NO_ANIM } };
        const ob = { ...(b as OverlayClip), animIn: { ...NO_ANIM } };
        const i = project.overlays.findIndex((c) => c.id === id);
        const overlays = [...project.overlays];
        overlays.splice(i, 1, oa, ob);
        return { project: { ...project, overlays }, id: ob.id };
      }
      const i = project.audios.findIndex((c) => c.id === id);
      const audios = [...project.audios];
      audios.splice(i, 1, a as AudioClip, b as AudioClip);
      return { project: { ...project, audios }, id: b.id };
    }
    case 'text': {
      const text = found.item as TextItem;
      const local = t - text.start;
      if (local < MIN_CLIP || text.duration - local < MIN_CLIP) return null;
      const [ka, kb] = splitKeyframes(text.keyframes, local);
      const a: TextItem = { ...text, duration: local, animOut: { ...NO_ANIM }, keyframes: ka };
      const b: TextItem = {
        ...text,
        id: newId('t'),
        start: text.start + local,
        duration: text.duration - local,
        animIn: { ...NO_ANIM },
        keyframes: kb,
      };
      const i = project.texts.findIndex((c) => c.id === id);
      const texts = [...project.texts];
      texts.splice(i, 1, a, b);
      return { project: { ...project, texts }, id: b.id };
    }
    case 'caption': {
      const caption = found.item as Caption;
      const local = t - caption.start;
      const length = caption.end - caption.start;
      if (local < MIN_CLIP || length - local < MIN_CLIP) return null;
      const words = captionWords(caption);
      // Com o tempo de cada palavra, divide entre as palavras certas.
      const k = words ? words.filter((w) => (w.start + w.end) / 2 < t).length : 0;
      let a: Caption;
      let b: Caption;
      if (words && k > 0 && k < words.length) {
        const wa = words.slice(0, k);
        const wb = words.slice(k);
        a = { ...caption, end: t, text: wa.map((w) => w.text).join(' '), words: wa };
        b = { id: newId('s'), start: t, end: caption.end, text: wb.map((w) => w.text).join(' '), words: wb };
      } else {
        const [ta, tb] = splitWords(caption.text, local / length);
        a = { ...caption, end: t, text: ta, words: undefined };
        b = { id: newId('s'), start: t, end: caption.end, text: tb };
      }
      const items = [...project.captions.items];
      const i = items.findIndex((c) => c.id === id);
      items.splice(i, 1, a, b);
      return { project: { ...project, captions: { ...project.captions, items } }, id: b.id };
    }
  }
}

// ---------------------------------------------------------------- excluir, mover, duplicar

export function removeItem(project: Project, id: string): Project {
  const found = findItem(project, id);
  if (!found) return project;
  switch (found.kind) {
    case 'main':
      return withCaptionsWarning(
        project,
        normalize({ ...project, main: project.main.filter((c) => c.id !== id) }),
      );
    case 'overlay':
      return { ...project, overlays: project.overlays.filter((c) => c.id !== id) };
    case 'audio':
      return { ...project, audios: project.audios.filter((c) => c.id !== id) };
    case 'text':
      return { ...project, texts: project.texts.filter((c) => c.id !== id) };
    case 'caption':
      return {
        ...project,
        captions: { ...project.captions, items: project.captions.items.filter((c) => c.id !== id) },
      };
  }
}

/** Reordena a faixa principal. */
export function moveMainClip(project: Project, id: string, toIndex: number): Project {
  const from = project.main.findIndex((c) => c.id === id);
  if (from < 0) return project;
  const to = clamp(toIndex, 0, project.main.length - 1);
  if (to === from) return project;
  const main = [...project.main];
  const [clip] = main.splice(from, 1);
  // Uma transição que saía do clipe movido não faz sentido no novo lugar.
  main.splice(to, 0, { ...clip!, transitionOut: null });
  return withCaptionsWarning(project, normalize({ ...project, main }));
}

/** Move um item solto para `start` e, se pedido, para outra camada (ou a primeira livre). */
export function moveItem(project: Project, id: string, start: Micros, layer?: number): Project {
  const found = findItem(project, id);
  if (!found) return project;
  const at = Math.max(0, Math.round(start));
  if (found.kind === 'caption') {
    const caption = found.item as Caption;
    const items = project.captions.items;
    const i = items.findIndex((c) => c.id === id);
    const length = caption.end - caption.start;
    const lo = i > 0 ? items[i - 1]!.end : 0;
    const hi = i < items.length - 1 ? items[i + 1]!.start - length : Number.POSITIVE_INFINITY;
    const s = clamp(at, lo, Math.max(lo, hi));
    return s === caption.start
      ? project
      : mapCaption(project, id, (c) => ({ ...c, start: s, end: s + length, words: shiftWords(c.words, s - c.start) }));
  }
  if (found.kind === 'main') return project;
  const item = found.item as OverlayClip | AudioClip | TextItem;
  const list: (OverlayClip | AudioClip | TextItem)[] =
    found.kind === 'overlay' ? project.overlays : found.kind === 'audio' ? project.audios : project.texts;
  const end = at + itemDuration(item);
  const wanted = Math.max(0, layer ?? item.layer);
  const clash = list.some(
    (o) => o.id !== id && o.layer === wanted && o.start < end && itemEnd(o) > at,
  );
  const finalLayer = clash ? firstFreeLayer(list, at, end, id) : wanted;
  if (at === item.start && finalLayer === item.layer) return project;
  const update = <T extends OverlayClip | AudioClip | TextItem>(c: T): T => ({ ...c, start: at, layer: finalLayer });
  if (found.kind === 'overlay') return mapOverlay(project, id, update);
  if (found.kind === 'audio') return mapAudio(project, id, update);
  return mapText(project, id, update);
}

export function duplicateItem(project: Project, id: string): Added | null {
  const found = findItem(project, id);
  if (!found) return null;
  switch (found.kind) {
    case 'main': {
      const i = project.main.findIndex((c) => c.id === id);
      const copy: MainClip = { ...(found.item as MainClip), id: newId('c') };
      const main = [...project.main];
      main.splice(i + 1, 0, copy);
      return { project: withCaptionsWarning(project, normalize({ ...project, main })), id: copy.id };
    }
    case 'overlay':
    case 'audio':
    case 'text': {
      const item = found.item as OverlayClip | AudioClip | TextItem;
      const list: (OverlayClip | AudioClip | TextItem)[] =
        found.kind === 'overlay' ? project.overlays : found.kind === 'audio' ? project.audios : project.texts;
      const start = itemEnd(item);
      const end = start + itemDuration(item);
      const sameLayerFree = !list.some((o) => o.layer === item.layer && o.start < end && itemEnd(o) > start);
      const layer = sameLayerFree ? item.layer : firstFreeLayer(list, start, end);
      const copyId = newId(found.kind === 'overlay' ? 'o' : found.kind === 'audio' ? 'a' : 't');
      const copy = { ...item, id: copyId, start, layer };
      if (found.kind === 'overlay') return { project: { ...project, overlays: [...project.overlays, copy as OverlayClip] }, id: copyId };
      if (found.kind === 'audio') return { project: { ...project, audios: [...project.audios, copy as AudioClip] }, id: copyId };
      return { project: { ...project, texts: [...project.texts, copy as TextItem] }, id: copyId };
    }
    case 'caption':
      return null;
  }
}

// ---------------------------------------------------------------- velocidade e áudio

/** Muda a velocidade (0,1x a 100x). Itens soltos que passarem a encostar no vizinho vão para outra camada. */
export function setSpeed(project: Project, id: string, speed: number, keepPitch: boolean): Project {
  const found = findItem(project, id);
  if (!found || found.kind === 'text' || found.kind === 'caption') return project;
  const clip = found.item as MainClip | OverlayClip | AudioClip;
  if (project.assets[clip.assetId]?.kind === 'image') return project;
  const s = clamp(speed, MIN_SPEED, MAX_SPEED);
  if (s === clip.speed && keepPitch === clip.keepPitch) return project;
  // O mesmo trecho passa a durar clip.speed / s vezes: os keyframes acompanham.
  const factor = clip.speed / s;
  const update = <T extends MainClip | OverlayClip | AudioClip>(c: T): T =>
    c.kind === 'audio' ? { ...c, speed: s, keepPitch } : { ...c, speed: s, keepPitch, keyframes: scaleKeyframes(c.keyframes, factor) };
  if (found.kind === 'main') return withCaptionsWarning(project, mapMain(project, id, update));
  let next = found.kind === 'overlay' ? mapOverlay(project, id, update) : mapAudio(project, id, update);
  const moved = findItem(next, id)!.item as OverlayClip | AudioClip;
  const list = found.kind === 'overlay' ? next.overlays : next.audios;
  const clash = list.some(
    (o) => o.id !== id && o.layer === moved.layer && o.start < itemEnd(moved) && itemEnd(o) > moved.start,
  );
  if (clash) next = moveItem(next, id, moved.start, firstFreeLayer(list, moved.start, itemEnd(moved), id));
  return next;
}

/** Escolhe o instante da timeline que vira a capa do projeto (null: o começo). */
export function setCoverTime(project: Project, t: Micros | null): Project {
  const value = t === null ? null : Math.max(0, Math.round(t));
  return project.coverTime === value ? project : { ...project, coverTime: value };
}

/** Quanto dura um quadro congelado ao ser criado. */
export const FREEZE_DURATION: Micros = 3_000_000;

/**
 * Congela o quadro do instante `t`: divide o clipe principal ali e põe entre as
 * duas partes a foto `image` desse quadro, com o mesmo enquadramento e cor.
 * Perto de uma ponta, a foto entra antes ou depois do clipe, sem dividir.
 */
export function insertFreezeFrame(project: Project, id: string, t: Micros, image: MediaAsset): Added | null {
  const found = findItem(project, id);
  if (!found || found.kind !== 'main' || image.kind !== 'image') return null;
  const slot = layoutMain(project).find((s) => s.clip.id === id);
  if (!slot) return null;
  const clip = slot.clip;
  const local = clamp(t - slot.start, 0, slot.duration);
  const base = makeMainClip(image);
  // Com keyframes, a foto fica parada no estado daquele instante.
  const state = liveState(clip, clip.opacity, local);
  const freeze: MainClip = {
    ...base,
    sourceIn: 0,
    sourceOut: FREEZE_DURATION,
    transform: { ...state.transform },
    crop: { ...clip.crop },
    flipH: clip.flipH,
    flipV: clip.flipV,
    opacity: state.opacity,
    filter: clip.filter ? { ...clip.filter } : null,
    adjust: { ...clip.adjust },
  };
  const main = [...project.main];
  if (local < MIN_CLIP) {
    main.splice(slot.index, 0, freeze);
  } else if (slot.duration - local < MIN_CLIP) {
    // A transição que saía do clipe passa a sair do quadro congelado.
    main.splice(slot.index, 1, { ...clip, transitionOut: null }, { ...freeze, transitionOut: clip.transitionOut });
  } else {
    const [a0, b0] = splitClipRange(clip, project.assets[clip.assetId], local);
    const [ka, kb] = splitKeyframes(clip.keyframes, local);
    const a: MainClip = { ...a0, transitionOut: null, animOut: { ...NO_ANIM }, fadeOut: 0, keyframes: ka };
    const b: MainClip = { ...b0, animIn: { ...NO_ANIM }, fadeIn: 0, keyframes: kb };
    main.splice(slot.index, 1, a, freeze, b);
  }
  const next = normalize({ ...addAssets(project, [image]), main });
  return { project: withCaptionsWarning(project, next), id: freeze.id };
}

/** Toca o clipe de trás para frente (ou volta ao normal). Só vídeos. */
export function setReverse(project: Project, id: string, reverse: boolean): Project {
  const found = findItem(project, id);
  if (!found || (found.kind !== 'main' && found.kind !== 'overlay')) return project;
  const clip = found.item as MainClip | OverlayClip;
  if (project.assets[clip.assetId]?.kind !== 'video' || !!clip.reverse === reverse) return project;
  const update = <T extends MainClip | OverlayClip>(c: T): T => ({ ...c, reverse: reverse || undefined });
  if (found.kind === 'main') return withCaptionsWarning(project, mapMain(project, id, update));
  return mapOverlay(project, id, update);
}

export const MAX_VOLUME = 2;

export function setVolume(project: Project, id: string, volume: number): Project {
  const v = clamp(volume, 0, MAX_VOLUME);
  const found = findItem(project, id);
  if (!found) return project;
  const update = <T extends MainClip | OverlayClip | AudioClip>(c: T): T => (c.volume === v ? c : { ...c, volume: v });
  if (found.kind === 'main') return mapMain(project, id, update);
  if (found.kind === 'overlay') return mapOverlay(project, id, update);
  if (found.kind === 'audio') return mapAudio(project, id, update);
  return project;
}

export function setFades(project: Project, id: string, fadeIn: Micros, fadeOut: Micros): Project {
  const found = findItem(project, id);
  if (!found || found.kind === 'text' || found.kind === 'caption') return project;
  const clip = found.item as MainClip | OverlayClip | AudioClip;
  const half = Math.floor(clipDuration(clip) / 2);
  const fi = clamp(Math.round(fadeIn), 0, half);
  const fo = clamp(Math.round(fadeOut), 0, half);
  if (fi === clip.fadeIn && fo === clip.fadeOut) return project;
  const update = <T extends MainClip | OverlayClip | AudioClip>(c: T): T => ({ ...c, fadeIn: fi, fadeOut: fo });
  if (found.kind === 'main') return mapMain(project, id, update);
  if (found.kind === 'overlay') return mapOverlay(project, id, update);
  return mapAudio(project, id, update);
}

export function setMuteMain(project: Project, muted: boolean): Project {
  return project.muteMain === muted ? project : { ...project, muteMain: muted };
}

export function addAudio(
  project: Project,
  asset: MediaAsset,
  at: Micros,
  source: AudioSource,
  name: string,
): Added {
  const withAsset = addAssets(project, [asset]);
  const start = Math.max(0, Math.round(at));
  const clip = makeAudioClip(asset, start, 0, source, name);
  const layer = firstFreeLayer(withAsset.audios, start, start + clipDuration(clip));
  const placed = { ...clip, layer };
  return { project: { ...withAsset, audios: [...withAsset.audios, placed] }, id: placed.id };
}

/** Separa o áudio de um clipe: o clipe fica mudo e o som vira um item na faixa de áudio. */
export function extractAudio(project: Project, id: string): Added | null {
  const found = findItem(project, id);
  if (!found || (found.kind !== 'main' && found.kind !== 'overlay')) return null;
  const clip = found.item as MainClip | OverlayClip;
  const asset = project.assets[clip.assetId];
  if (!asset || asset.kind !== 'video' || !asset.hasAudio) return null;
  const start =
    found.kind === 'main' ? layoutMain(project).find((s) => s.clip.id === id)!.start : (clip as OverlayClip).start;
  const duration = clipDuration(clip);
  const layer = firstFreeLayer(project.audios, start, start + duration);
  const audio: AudioClip = {
    kind: 'audio',
    id: newId('a'),
    assetId: clip.assetId,
    sourceIn: clip.sourceIn,
    sourceOut: clip.sourceOut,
    speed: clip.speed,
    keepPitch: clip.keepPitch,
    ...(clip.reverse ? { reverse: true } : {}),
    volume: clip.volume,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
    start,
    layer,
    source: 'extract',
    name: 'Áudio extraído',
  };
  const muted = setVolume(project, id, 0);
  return { project: { ...muted, audios: [...muted.audios, audio] }, id: audio.id };
}

// ---------------------------------------------------------------- visual

export function updateVisual(project: Project, id: string, patch: Partial<Visual>): Project {
  const found = findItem(project, id);
  if (!found) return project;
  const update = <T extends MainClip | OverlayClip>(c: T): T => ({ ...c, ...patch });
  if (found.kind === 'main') return mapMain(project, id, update);
  if (found.kind === 'overlay') return mapOverlay(project, id, update);
  return project;
}

/** "Aplicar a todos": copia o mesmo ajuste para todos os clipes da faixa principal. */
export function updateVisualAll(project: Project, patch: Partial<Visual>): Project {
  if (project.main.length === 0) return project;
  return { ...project, main: project.main.map((c) => ({ ...c, ...patch })) };
}

// ---------------------------------------------------------------- keyframes

type Animatable = MainClip | OverlayClip | TextItem;

/** Começo do item na timeline (µs), para converter a agulha em tempo do item. */
export function itemStartTime(project: Project, id: string): Micros | null {
  const found = findItem(project, id);
  if (!found) return null;
  if (found.kind === 'main') return layoutMain(project).find((s) => s.clip.id === id)?.start ?? null;
  if (found.kind === 'overlay' || found.kind === 'text') return (found.item as OverlayClip | TextItem).start;
  return null;
}

function animatable(project: Project, id: string): { kind: 'main' | 'overlay' | 'text'; item: Animatable; start: Micros } | null {
  const found = findItem(project, id);
  if (!found || (found.kind !== 'main' && found.kind !== 'overlay' && found.kind !== 'text')) return null;
  const start = itemStartTime(project, id);
  if (start === null) return null;
  return { kind: found.kind, item: found.item as Animatable, start };
}

function baseOpacity(item: Animatable): number {
  return item.kind === 'text' ? 1 : item.opacity;
}

/** Estado do item no instante `t` da timeline (keyframes ou valores fixos). */
export function itemStateAt(project: Project, id: string, t: Micros): KeyState | null {
  const a = animatable(project, id);
  if (!a) return null;
  return liveState(a.item, baseOpacity(a.item), t - a.start);
}

function mapAnimatable(project: Project, id: string, kind: 'main' | 'overlay' | 'text', fn: (item: Animatable) => Animatable): Project {
  if (kind === 'main') return mapMain(project, id, (c) => fn(c) as MainClip);
  if (kind === 'overlay') return mapOverlay(project, id, (c) => fn(c) as OverlayClip);
  return mapText(project, id, (c) => fn(c) as TextItem);
}

/** Põe ou tira um keyframe na agulha. O primeiro guarda o estado atual do item. */
export function toggleKeyframe(project: Project, id: string, t: Micros): Project {
  const a = animatable(project, id);
  if (!a) return project;
  const local = t - a.start;
  const state = liveState(a.item, baseOpacity(a.item), local);
  const list = a.item.keyframes;
  const i = keyframeIndexAt(list, local);
  if (i >= 0 && list) {
    const rest = list.filter((_, j) => j !== i);
    if (rest.length > 0) return mapAnimatable(project, id, a.kind, (it) => ({ ...it, keyframes: rest }));
    // Último keyframe: o item fica parado no estado que tinha.
    return mapAnimatable(project, id, a.kind, (it) => withBase({ ...it, keyframes: undefined }, state));
  }
  return mapAnimatable(project, id, a.kind, (it) => ({ ...it, keyframes: upsertKeyframe(list, local, state) }));
}

function withBase(item: Animatable, state: KeyState): Animatable {
  if (item.kind === 'text') return { ...item, transform: state.transform };
  return { ...item, transform: state.transform, opacity: state.opacity };
}

/** Tira todos os keyframes; o item fica parado no estado do instante `t`. */
export function clearKeyframes(project: Project, id: string, t: Micros): Project {
  const a = animatable(project, id);
  if (!a?.item.keyframes) return project;
  const state = liveState(a.item, baseOpacity(a.item), t - a.start);
  return mapAnimatable(project, id, a.kind, (it) => withBase({ ...it, keyframes: undefined }, state));
}

/** Curva do keyframe na agulha (vale do keyframe até o próximo). */
export function setKeyframeEase(project: Project, id: string, t: Micros, ease: KeyframeEase): Project {
  const a = animatable(project, id);
  const list = a?.item.keyframes;
  if (!a || !list) return project;
  const i = keyframeIndexAt(list, t - a.start);
  if (i < 0 || list[i]!.ease === ease) return project;
  return mapAnimatable(project, id, a.kind, (it) => ({ ...it, keyframes: list.map((k, j) => (j === i ? { ...k, ease } : k)) }));
}

/** Opacidade: com keyframes, grava no keyframe da agulha; sem, muda a do item. */
export function setItemOpacity(project: Project, id: string, opacity: number, t?: Micros): Project {
  const a = animatable(project, id);
  if (!a) return project;
  const value = clamp(opacity, 0, 1);
  if (a.item.keyframes && t !== undefined) {
    const local = t - a.start;
    const state = liveState(a.item, baseOpacity(a.item), local);
    return mapAnimatable(project, id, a.kind, (it) => ({ ...it, keyframes: upsertKeyframe(it.keyframes, local, { ...state, opacity: value }) }));
  }
  if (a.kind === 'text') return project;
  return updateVisual(project, id, { opacity: value });
}

/**
 * Posição, escala e rotação. Com keyframes e com `t`, grava (ou cria) o keyframe
 * no instante `t` da timeline; sem keyframes, muda o item inteiro.
 */
export function updateTransform(project: Project, id: string, patch: Partial<Transform>, t?: Micros): Project {
  const found = findItem(project, id);
  if (!found) return project;
  const a = animatable(project, id);
  if (a?.item.keyframes && t !== undefined) {
    const local = t - a.start;
    const state = liveState(a.item, baseOpacity(a.item), local);
    const next: KeyState = { transform: { ...state.transform, ...patch }, opacity: state.opacity };
    return mapAnimatable(project, id, a.kind, (it) => ({ ...it, keyframes: upsertKeyframe(it.keyframes, local, next) }));
  }
  if (found.kind === 'text') {
    return mapText(project, id, (t) => ({ ...t, transform: { ...t.transform, ...patch } }));
  }
  if (found.kind === 'main' || found.kind === 'overlay') {
    const clip = found.item as MainClip | OverlayClip;
    return updateVisual(project, id, { transform: { ...clip.transform, ...patch } });
  }
  return project;
}

export function rotate90(project: Project, id: string): Project {
  const found = findItem(project, id);
  if (!found || (found.kind !== 'main' && found.kind !== 'overlay')) return project;
  const clip = found.item as MainClip | OverlayClip;
  const rotation = (Math.round(clip.transform.rotation / 90) * 90 + 90) % 360;
  return updateVisual(project, id, { transform: { ...clip.transform, rotation } });
}

export function flip(project: Project, id: string, axis: 'h' | 'v'): Project {
  const found = findItem(project, id);
  if (!found || (found.kind !== 'main' && found.kind !== 'overlay')) return project;
  const clip = found.item as MainClip | OverlayClip;
  return updateVisual(project, id, axis === 'h' ? { flipH: !clip.flipH } : { flipV: !clip.flipV });
}

// ---------------------------------------------------------------- transições

export function setTransition(project: Project, id: string, transition: Transition | null): Project {
  const i = project.main.findIndex((c) => c.id === id);
  if (i < 0 || i === project.main.length - 1) return project;
  return withCaptionsWarning(
    project,
    mapMain(project, id, (c) => ({ ...c, transitionOut: transition ? { ...transition } : null })),
  );
}

export function setTransitionAll(project: Project, transition: Transition | null): Project {
  if (project.main.length < 2) return project;
  const main = project.main.map((c, i) =>
    i === project.main.length - 1 ? c : { ...c, transitionOut: transition ? { ...transition } : null },
  );
  return withCaptionsWarning(project, { ...project, main });
}

// ---------------------------------------------------------------- projeto

export function setRatio(project: Project, ratio: Ratio): Project {
  return project.ratio === ratio ? project : { ...project, ratio };
}

export function setBackground(project: Project, background: Background): Project {
  return { ...project, background };
}

export function setExportSettings(project: Project, patch: Partial<ExportSettings>): Project {
  return { ...project, exportSettings: { ...project.exportSettings, ...patch } };
}

export function renameProject(project: Project, name: string): Project {
  const clean = name.trim();
  return clean && clean !== project.name ? { ...project, name: clean } : project;
}

export function setCover(project: Project, t: Micros | null): Project {
  return { ...project, coverTime: t };
}

// ---------------------------------------------------------------- texto

export function addText(project: Project, at: Micros, text: string, style?: TextStyle): Added {
  const start = Math.max(0, Math.round(at));
  const total = projectDuration(project);
  // O texto fica dentro do vídeo quando dá; num projeto vazio dura 3 s.
  const room = total - start;
  const duration = room >= MIN_CLIP ? Math.min(DEFAULT_TEXT_DURATION, room) : DEFAULT_TEXT_DURATION;
  const layer = firstFreeLayer(project.texts, start, start + duration);
  const item = makeTextItem(text, start, duration, layer, style);
  return { project: { ...project, texts: [...project.texts, item] }, id: item.id };
}

export function updateText(
  project: Project,
  id: string,
  patch: Partial<Omit<TextItem, 'id' | 'kind' | 'start' | 'duration' | 'layer'>>,
): Project {
  return mapText(project, id, (t) => ({ ...t, ...patch }));
}

export function updateTextStyle(project: Project, id: string, patch: Partial<TextStyle>): Project {
  return mapText(project, id, (t) => ({ ...t, style: { ...t.style, ...patch } }));
}

// ---------------------------------------------------------------- sobreposição

export function addOverlay(project: Project, asset: MediaAsset, at: Micros): Added {
  const withAsset = addAssets(project, [asset]);
  const start = Math.max(0, Math.round(at));
  const clip = makeOverlayClip(asset, start, 0);
  const sized = asset.kind === 'image' ? { ...clip, sourceOut: DEFAULT_IMAGE_DURATION } : clip;
  const layer = firstFreeLayer(withAsset.overlays, start, start + clipDuration(sized));
  const placed = { ...sized, layer };
  return { project: { ...withAsset, overlays: [...withAsset.overlays, placed] }, id: placed.id };
}

export function setBlend(project: Project, id: string, blend: OverlayClip['blend']): Project {
  return mapOverlay(project, id, (c) => (c.blend === blend ? c : { ...c, blend }));
}

/** Troca a mídia de um clipe mantendo a duração na timeline quando a nova mídia é longa o bastante. */
export function replaceMedia(project: Project, id: string, asset: MediaAsset): Project {
  const found = findItem(project, id);
  if (!found || (found.kind !== 'main' && found.kind !== 'overlay') || asset.kind === 'audio') return project;
  const clip = found.item as MainClip | OverlayClip;
  const duration = clipDuration(clip);
  const withAsset = addAssets(project, [asset]);
  const speed = asset.kind === 'image' ? 1 : clip.speed;
  const span = Math.round(duration * speed);
  const sourceOut = asset.kind === 'image' ? duration : Math.max(Math.ceil(MIN_CLIP * speed), Math.min(span, asset.duration));
  const update = <T extends MainClip | OverlayClip>(c: T): T => ({
    ...c,
    assetId: asset.id,
    sourceIn: 0,
    sourceOut,
    speed,
    crop: { x: 0, y: 0, w: 1, h: 1 },
  });
  const next = found.kind === 'main' ? mapMain(withAsset, id, update) : mapOverlay(withAsset, id, update);
  return found.kind === 'main' ? withCaptionsWarning(project, next) : next;
}

// ---------------------------------------------------------------- legendas

export function setCaptions(
  project: Project,
  items: Caption[],
  language: string | null,
  source: CaptionSource,
): Project {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  return {
    ...project,
    captions: { ...project.captions, items: sorted, language, source, maybeOutOfSync: false },
  };
}

export function updateCaptionText(project: Project, id: string, text: string): Project {
  return mapCaption(project, id, (c) => {
    if (c.text === text) return c;
    // Corrigiu palavras sem mudar quantas são: mantém o tempo de cada uma.
    const words = captionWords(c);
    const parts = text.trim().split(/\s+/);
    if (words && parts.length === words.length && parts.join(' ') === text) {
      return { ...c, text, words: words.map((w, i) => ({ ...w, text: parts[i]! })) };
    }
    return { ...c, text, words: undefined };
  });
}

export function setCaptionStyle(project: Project, patch: Partial<TextStyle>): Project {
  return { ...project, captions: { ...project.captions, style: { ...project.captions.style, ...patch } } };
}

export function setCaptionHighlight(project: Project, highlight: CaptionHighlight | null): Project {
  return { ...project, captions: { ...project.captions, highlight } };
}

export function setCaptionPosition(project: Project, position: { x: number; y: number }): Project {
  return { ...project, captions: { ...project.captions, position } };
}

export function dismissCaptionsWarning(project: Project): Project {
  return project.captions.maybeOutOfSync
    ? { ...project, captions: { ...project.captions, maybeOutOfSync: false } }
    : project;
}

/** Divide uma legenda na posição `charIndex` do texto; o tempo é dividido na mesma proporção. */
export function splitCaptionAtChar(project: Project, id: string, charIndex: number): Added | null {
  const items = project.captions.items;
  const i = items.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const caption = items[i]!;
  const left = caption.text.slice(0, charIndex).trim();
  const right = caption.text.slice(charIndex).trim();
  if (!left || !right) return null;
  const length = caption.end - caption.start;
  const words = captionWords(caption);
  const k = left.split(/\s+/).length;
  // Com o tempo das palavras, divide no começo da primeira palavra da direita.
  const exact = words && words.map((w) => w.text).slice(0, k).join(' ') === left ? words : null;
  const t = exact
    ? Math.max(caption.start, exact[k]!.start)
    : caption.start + Math.round((length * left.length) / (left.length + right.length));
  if (t - caption.start < MIN_CLIP || caption.end - t < MIN_CLIP) return null;
  const a: Caption = { ...caption, end: t, text: left, words: exact ? exact.slice(0, k) : undefined };
  const b: Caption = { id: newId('s'), start: t, end: caption.end, text: right, words: exact ? exact.slice(k) : undefined };
  const next = [...items];
  next.splice(i, 1, a, b);
  return { project: { ...project, captions: { ...project.captions, items: next } }, id: b.id };
}

export function mergeCaptionWithNext(project: Project, id: string): Project {
  const items = project.captions.items;
  const i = items.findIndex((c) => c.id === id);
  if (i < 0 || i >= items.length - 1) return project;
  const a = items[i]!;
  const b = items[i + 1]!;
  const wa = captionWords(a);
  const wb = captionWords(b);
  const merged: Caption = {
    ...a,
    end: b.end,
    text: `${a.text} ${b.text}`.trim(),
    words: wa && wb ? [...wa, ...wb] : undefined,
  };
  const next = [...items];
  next.splice(i, 2, merged);
  return { ...project, captions: { ...project.captions, items: next } };
}
