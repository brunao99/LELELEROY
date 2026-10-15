/**
 * Projeto → plano de desenho: só números e textos, sem objetos do Skia. O mesmo
 * plano alimenta o preview e a exportação. As funções marcadas com 'worklet'
 * rodam a cada quadro, dentro do desenho.
 */
import { clipColorMatrix, clipShaderParams, type ColorMatrix, type ShaderParams } from './color';
import { chromaUniforms, type ChromaUniforms } from './effects';
import { designSize } from './geometry';
import { clipDuration, layoutMain, projectDuration } from './timeline';
import type {
  Anim,
  Background,
  BlendKind,
  CaptionHighlight,
  Crop,
  Keyframe,
  LoopAnimKind,
  MainClip,
  Micros,
  OverlayClip,
  Project,
  Rotation,
  TextStyle,
  Transform,
  TransitionKind,
  VideoEffect,
} from './types';

export interface RenderClip {
  /** Também é o id do item na composição (chave de `frames`). */
  id: string;
  source: 'video' | 'image';
  assetId: string;
  start: Micros;
  end: Micros;
  /** Dimensões do arquivo antes da rotação (para fotos, da imagem). */
  srcWidth: number;
  srcHeight: number;
  rotation: Rotation;
  crop: Crop;
  transform: Transform;
  flipH: boolean;
  flipV: boolean;
  opacity: number;
  colorMatrix: ColorMatrix | null;
  shader: ShaderParams | null;
  animIn: Anim;
  animOut: Anim;
  blend: BlendKind;
  keyframes: Keyframe[] | null;
  effect: VideoEffect | null;
  chroma: ChromaUniforms | null;
}

export interface RenderTransition {
  kind: TransitionKind;
  start: Micros;
  end: Micros;
}

export interface RenderMainSlot {
  clip: RenderClip;
  transitionIn: RenderTransition | null;
  transitionOut: RenderTransition | null;
}

export interface RenderText {
  id: string;
  start: Micros;
  end: Micros;
  transform: Transform;
  animIn: Anim;
  animOut: Anim;
  animLoop: LoopAnimKind;
  keyframes: Keyframe[] | null;
  /** Muda quando o texto ou o estilo mudam: o motor refaz o parágrafo. */
  version: string;
  text: string;
  style: TextStyle;
  layer: number;
}

/** Uma palavra da legenda: tempo e posição no texto (índices UTF-16, como o Skia usa). */
export interface RenderWord {
  start: Micros;
  end: Micros;
  from: number;
  to: number;
}

export interface RenderCaption {
  id: string;
  start: Micros;
  end: Micros;
  text: string;
  version: string;
  words: RenderWord[] | null;
}

export interface RenderPlan {
  width: number;
  height: number;
  duration: Micros;
  background: Background;
  main: RenderMainSlot[];
  overlays: RenderClip[];
  texts: RenderText[];
  captions: { items: RenderCaption[]; position: { x: number; y: number }; style: TextStyle; highlight: CaptionHighlight | null };
}

function renderClip(project: Project, clip: MainClip | OverlayClip, start: Micros): RenderClip | null {
  const asset = project.assets[clip.assetId];
  if (!asset || asset.kind === 'audio') return null;
  return {
    id: clip.id,
    source: asset.kind,
    assetId: asset.id,
    start,
    end: start + clipDuration(clip),
    srcWidth: asset.width,
    srcHeight: asset.height,
    rotation: asset.rotation,
    crop: clip.crop,
    transform: clip.transform,
    flipH: clip.flipH,
    flipV: clip.flipV,
    opacity: clip.opacity,
    colorMatrix: clipColorMatrix(clip.filter, clip.adjust),
    shader: clipShaderParams(clip.adjust),
    animIn: clip.animIn,
    animOut: clip.animOut,
    blend: clip.kind === 'overlay' ? clip.blend : 'normal',
    keyframes: clip.keyframes && clip.keyframes.length > 0 ? clip.keyframes : null,
    effect: clip.effect && clip.effect.amount > 0 ? clip.effect : null,
    chroma: clip.chroma ? chromaUniforms(clip.chroma) : null,
  };
}

/** Onde cada palavra está no texto da legenda; null se as palavras não batem com o texto. */
export function wordRanges(caption: { text: string; words?: { text: string; start: Micros; end: Micros }[] }): RenderWord[] | null {
  const words = caption.words;
  if (!words || words.length === 0 || words.map((w) => w.text).join(' ') !== caption.text) return null;
  const out: RenderWord[] = [];
  let at = 0;
  for (const w of words) {
    out.push({ start: w.start, end: w.end, from: at, to: at + w.text.length });
    at += w.text.length + 1;
  }
  return out;
}

/** Palavra sendo falada no instante `t`: fica destacada até a próxima começar. */
export function activeWord(words: RenderWord[], t: Micros): number {
  'worklet';
  let found = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i]!.start <= t) found = i;
    else break;
  }
  return found;
}

function styleVersion(text: string, style: TextStyle): string {
  return `${text}\u0000${JSON.stringify(style)}`;
}

export function buildRenderPlan(project: Project): RenderPlan {
  const size = designSize(project);
  const main: RenderMainSlot[] = [];
  for (const slot of layoutMain(project)) {
    const clip = renderClip(project, slot.clip, slot.start);
    if (!clip) continue;
    main.push({
      clip,
      transitionIn: slot.transitionIn
        ? { kind: slot.transitionIn.kind, start: slot.start, end: slot.start + slot.transitionIn.duration }
        : null,
      transitionOut: slot.transitionOut
        ? { kind: slot.transitionOut.kind, start: slot.end - slot.transitionOut.duration, end: slot.end }
        : null,
    });
  }
  const overlays = [...project.overlays]
    .sort((a, b) => a.layer - b.layer || a.start - b.start)
    .map((o) => renderClip(project, o, o.start))
    .filter((c): c is RenderClip => c !== null);
  const texts: RenderText[] = [...project.texts]
    .sort((a, b) => a.layer - b.layer || a.start - b.start)
    .map((t) => ({
      id: t.id,
      start: t.start,
      end: t.start + t.duration,
      transform: t.transform,
      animIn: t.animIn,
      animOut: t.animOut,
      animLoop: t.animLoop,
      keyframes: t.keyframes && t.keyframes.length > 0 ? t.keyframes : null,
      version: styleVersion(t.text, t.style),
      text: t.text,
      style: t.style,
      layer: t.layer,
    }));
  const captionStyle = project.captions.style;
  const highlight = project.captions.highlight ?? null;
  const captions = project.captions.items.map((c) => {
    const words = highlight ? wordRanges(c) : null;
    return {
      id: c.id,
      start: c.start,
      end: c.end,
      text: c.text,
      // O destaque em cor pede um segundo parágrafo, na cor dele.
      version: `${styleVersion(c.text, captionStyle)}${words && highlight ? `\u0000${highlight.mode}${highlight.color}` : ''}`,
      words,
    };
  });
  return {
    width: size.width,
    height: size.height,
    duration: projectDuration(project),
    background: project.background,
    main,
    overlays,
    texts,
    captions: { items: captions, position: project.captions.position, style: captionStyle, highlight },
  };
}

// ---------------------------------------------------------------- por quadro

export interface ActiveMain {
  /** Clipe principal no instante (o que entra, durante uma transição). */
  primary: RenderMainSlot | null;
  /** Durante uma transição: o clipe que sai. */
  outgoing: RenderMainSlot | null;
  transition: RenderTransition | null;
  /** 0..1 dentro da transição. */
  progress: number;
}

/** Quais clipes da faixa principal aparecem no instante `t`. Busca binária: roda a cada quadro. */
export function activeMainAt(slots: RenderMainSlot[], t: Micros): ActiveMain {
  'worklet';
  let lo = 0;
  let hi = slots.length - 1;
  let found = -1;
  // Último clipe com start <= t.
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (slots[mid]!.clip.start <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return { primary: null, outgoing: null, transition: null, progress: 0 };
  const slot = slots[found]!;
  if (t >= slot.clip.end) return { primary: null, outgoing: null, transition: null, progress: 0 };
  const tr = slot.transitionIn;
  if (tr && t < tr.end && found > 0) {
    const length = tr.end - tr.start;
    return {
      primary: slot,
      outgoing: slots[found - 1]!,
      transition: tr,
      progress: length > 0 ? (t - tr.start) / length : 1,
    };
  }
  return { primary: slot, outgoing: null, transition: null, progress: 0 };
}

/** Legenda visível no instante `t` (busca binária). */
export function captionAt(items: RenderCaption[], t: Micros): RenderCaption | null {
  'worklet';
  let lo = 0;
  let hi = items.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = items[mid]!;
    if (t < c.start) hi = mid - 1;
    else if (t >= c.end) lo = mid + 1;
    else return c;
  }
  return null;
}

export interface ClipBox {
  /** Centro e tamanho do retângulo de destino no quadro (unidades de desenho). */
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
}

/**
 * Onde um clipe aparece: o recorte (`cropW` × `cropH`, já girado) cabe inteiro no
 * quadro (como no modo "ajustar"), depois a escala, a posição e a rotação do usuário.
 */
export function clipBox(
  canvasW: number,
  canvasH: number,
  cropW: number,
  cropH: number,
  transform: Transform,
): ClipBox {
  'worklet';
  if (cropW <= 0 || cropH <= 0) {
    return { cx: canvasW / 2, cy: canvasH / 2, width: 0, height: 0, rotation: 0 };
  }
  const fit = Math.min(canvasW / cropW, canvasH / cropH);
  return {
    cx: canvasW / 2 + transform.x * canvasW,
    cy: canvasH / 2 + transform.y * canvasH,
    width: cropW * fit * transform.scale,
    height: cropH * fit * transform.scale,
    rotation: transform.rotation,
  };
}

/** Dimensões depois da rotação do arquivo. */
export function rotatedSize(width: number, height: number, rotation: number): { width: number; height: number } {
  'worklet';
  const r = ((rotation % 360) + 360) % 360;
  return r === 90 || r === 270 ? { width: height, height: width } : { width, height };
}
