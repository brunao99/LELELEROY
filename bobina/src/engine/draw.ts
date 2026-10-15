/**
 * Desenho de um quadro do projeto. É um worklet: roda na thread de UI (preview)
 * e no runtime da exportação, sempre com o mesmo resultado.
 */
import type { VideoFrame } from '@azzapp/react-native-skia-video';
import {
  BlendMode,
  ClipOp,
  FilterMode,
  MipmapMode,
  Skia,
  TileMode,
  type SkCanvas,
  type SkImage,
  type SkRuntimeEffect,
} from '@shopify/react-native-skia';

import { blurSigma, effectMotion, shaderKind } from '@/core/effects';
import { liveState, type KeyState } from '@/core/keyframes';
import { combine, itemMotion, transitionFrame, type MotionState } from '@/core/motion';
import {
  activeMainAt,
  captionAt,
  clipBox,
  rotatedSize,
  type RenderClip,
  type RenderPlan,
} from '@/core/renderPlan';
import type { BlendKind, Micros, TextStyle, Transform } from '@/core/types';

import { gradeUniforms } from './shaders';
import type { TextParts } from './text';

export interface DrawResources {
  /** Fotos (e a imagem de fundo), por id da mídia. */
  images: Record<string, SkImage>;
  /** Parágrafos dos textos, por id do texto. */
  texts: Record<string, TextParts>;
  /** Parágrafos das legendas, por id da legenda. */
  captions: Record<string, TextParts>;
  grade: SkRuntimeEffect | null;
  /** Efeitos e chroma key (engine/shaders.ts). */
  fx: SkRuntimeEffect | null;
}

interface ClipImage {
  image: SkImage;
  /** Rotação a aplicar na textura para ficar em pé. */
  rotation: number;
  owned: boolean;
}

const BLEND: Record<BlendKind, BlendMode> = {
  normal: BlendMode.SrcOver,
  multiply: BlendMode.Multiply,
  screen: BlendMode.Screen,
  overlay: BlendMode.Overlay,
  darken: BlendMode.Darken,
  lighten: BlendMode.Lighten,
  add: BlendMode.Plus,
};

function clipImage(clip: RenderClip, frames: Record<string, VideoFrame>, res: DrawResources): ClipImage | null {
  'worklet';
  if (clip.source === 'image') {
    const image = res.images[clip.assetId];
    return image ? { image, rotation: 0, owned: false } : null;
  }
  const frame = frames[clip.id];
  if (!frame || !frame.texture) return null;
  const image = Skia.Image.MakeImageFromNativeTextureUnstable(frame.texture, frame.width, frame.height);
  return { image, rotation: frame.rotation, owned: true };
}

/** Gira o canvas para desenhar a textura `w`×`h` já em pé (rotação no sentido horário). */
function applyRotation(canvas: SkCanvas, rotation: number, w: number, h: number) {
  'worklet';
  const r = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  if (r === 90) {
    canvas.translate(h, 0);
    canvas.rotate(90, 0, 0);
  } else if (r === 180) {
    canvas.translate(w, h);
    canvas.rotate(180, 0, 0);
  } else if (r === 270) {
    canvas.translate(0, w);
    canvas.rotate(270, 0, 0);
  }
}

/** Desenha um clipe (vídeo ou foto) com recorte, posição, filtro e animação. */
function drawClip(
  canvas: SkCanvas,
  clip: RenderClip,
  img: ClipImage,
  motion: MotionState,
  W: number,
  H: number,
  res: DrawResources,
  state: KeyState,
  seconds: number,
) {
  'worklet';
  const texW = img.image.width();
  const texH = img.image.height();
  const disp = rotatedSize(texW, texH, img.rotation);
  const cropX = clip.crop.x * disp.width;
  const cropY = clip.crop.y * disp.height;
  const cropW = clip.crop.w * disp.width;
  const cropH = clip.crop.h * disp.height;
  const box = clipBox(W, H, cropW, cropH, state.transform);
  const alpha = state.opacity * motion.opacity;
  if (alpha <= 0.001 || box.width <= 0 || box.height <= 0) return;

  canvas.save();
  canvas.translate(box.cx + motion.dx * W, box.cy + motion.dy * H);
  canvas.rotate(box.rotation + motion.rotation, 0, 0);
  canvas.scale(motion.scale * (clip.flipH ? -1 : 1), motion.scale * (clip.flipV ? -1 : 1));
  canvas.scale(box.width / cropW, box.height / cropH);
  canvas.translate(-cropW / 2 - cropX, -cropH / 2 - cropY);
  canvas.clipRect(Skia.XYWHRect(cropX, cropY, cropW, cropH), ClipOp.Intersect, true);
  applyRotation(canvas, img.rotation, texW, texH);

  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setAlphaf(alpha);
  if (clip.blend !== 'normal') paint.setBlendMode(BLEND[clip.blend]);
  const effect = clip.effect;
  if (effect?.kind === 'blur') {
    const sigma = blurSigma(effect.amount, Math.max(texW, texH));
    paint.setImageFilter(Skia.ImageFilter.MakeBlur(sigma, sigma, TileMode.Clamp, null));
  }
  const fxKind = shaderKind(effect?.kind);
  const useFx = !!res.fx && (fxKind > 0 || !!clip.chroma);
  if ((clip.shader && res.grade) || useFx) {
    // Efeitos e chroma primeiro (sobre a cor original), depois a correção de cor.
    let shader = img.image.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None);
    if (useFx && res.fx) {
      const key = clip.chroma;
      shader = res.fx.makeShaderWithChildren(
        [
          texW,
          texH,
          seconds,
          fxKind,
          effect?.amount ?? 0,
          key ? 1 : 0,
          key?.cb ?? 0,
          key?.cr ?? 0,
          key?.similarity ?? 0,
          key?.smoothness ?? 0,
        ],
        [shader],
      );
    }
    if (clip.shader && res.grade) {
      shader = res.grade.makeShaderWithChildren(gradeUniforms(texW, texH, clip.colorMatrix, clip.shader), [shader]);
    } else if (clip.colorMatrix) {
      paint.setColorFilter(Skia.ColorFilter.MakeMatrix(clip.colorMatrix));
    }
    paint.setShader(shader);
    canvas.drawRect(Skia.XYWHRect(0, 0, texW, texH), paint);
  } else {
    if (clip.colorMatrix) paint.setColorFilter(Skia.ColorFilter.MakeMatrix(clip.colorMatrix));
    const rect = Skia.XYWHRect(0, 0, texW, texH);
    canvas.drawImageRectOptions(img.image, rect, rect, FilterMode.Linear, MipmapMode.None, paint);
  }
  canvas.restore();
}

/** Fundo: cor, imagem ou o próprio clipe ampliado e desfocado. */
function drawBackground(
  canvas: SkCanvas,
  plan: RenderPlan,
  primary: { clip: RenderClip; img: ClipImage } | null,
  W: number,
  H: number,
  res: DrawResources,
) {
  'worklet';
  const bg = plan.background;
  if (bg.kind === 'color') {
    canvas.drawColor(Skia.Color(bg.color));
    return;
  }
  let image: SkImage | null = null;
  let rotation = 0;
  if (bg.kind === 'image') {
    image = res.images[bg.assetId] ?? null;
  } else if (primary) {
    image = primary.img.image;
    rotation = primary.img.rotation;
  }
  canvas.drawColor(Skia.Color('#000000'));
  if (!image) return;
  const texW = image.width();
  const texH = image.height();
  const disp = rotatedSize(texW, texH, rotation);
  // Cobre o quadro inteiro (o oposto de "ajustar").
  const cover = Math.max(W / disp.width, H / disp.height);
  canvas.save();
  canvas.translate(W / 2, H / 2);
  canvas.scale(cover, cover);
  canvas.translate(-disp.width / 2, -disp.height / 2);
  applyRotation(canvas, rotation, texW, texH);
  const paint = Skia.Paint();
  if (bg.kind === 'blur') {
    const sigma = (2 + bg.amount * 38) / cover;
    paint.setImageFilter(Skia.ImageFilter.MakeBlur(sigma, sigma, TileMode.Clamp, null));
  }
  const rect = Skia.XYWHRect(0, 0, texW, texH);
  canvas.drawImageRectOptions(image, rect, rect, FilterMode.Linear, MipmapMode.None, paint);
  canvas.restore();
}

/** Desenha um texto (ou legenda) centrado na posição do transform. */
function drawText(
  canvas: SkCanvas,
  parts: TextParts,
  style: TextStyle,
  transform: Transform,
  motion: MotionState,
  W: number,
  H: number,
) {
  'worklet';
  const alpha = style.opacity * motion.opacity;
  if (alpha <= 0.001) return;
  canvas.save();
  canvas.translate(W / 2 + (transform.x + motion.dx) * W, H / 2 + (transform.y + motion.dy) * H);
  canvas.rotate(transform.rotation + motion.rotation, 0, 0);
  const s = transform.scale * motion.scale;
  canvas.scale(s, s);
  const x = -parts.width / 2;
  const y = -parts.height / 2;
  const layered = alpha < 0.999;
  if (layered) {
    const layerPaint = Skia.Paint();
    layerPaint.setAlphaf(alpha);
    canvas.saveLayer(layerPaint);
  }
  if (style.background) {
    const pad = parts.padding;
    const bgPaint = Skia.Paint();
    bgPaint.setAntiAlias(true);
    bgPaint.setColor(Skia.Color(style.background.color));
    bgPaint.setAlphaf(style.background.opacity);
    const r = style.background.radius * parts.fontSize;
    canvas.drawRRect(
      Skia.RRectXY(Skia.XYWHRect(x - pad, y - pad, parts.width + pad * 2, parts.height + pad * 2), r, r),
      bgPaint,
    );
  }
  if (parts.stroke) parts.stroke.paint(canvas, x, y);
  parts.fill.paint(canvas, x, y);
  if (layered) canvas.restore();
  canvas.restore();
}

/** Revelação do clipe que entra (cortina ou círculo). */
function clipReveal(canvas: SkCanvas, shape: 'left' | 'right' | 'circle', amount: number, W: number, H: number) {
  'worklet';
  if (shape === 'left') {
    canvas.clipRect(Skia.XYWHRect(W * (1 - amount), 0, W * amount, H), ClipOp.Intersect, true);
  } else if (shape === 'right') {
    canvas.clipRect(Skia.XYWHRect(0, 0, W * amount, H), ClipOp.Intersect, true);
  } else {
    const path = Skia.Path.Circle(W / 2, H / 2, (amount * Math.sqrt(W * W + H * H)) / 2);
    canvas.clipPath(path, ClipOp.Intersect, true);
  }
}

/**
 * Desenha o projeto no instante `t` (microssegundos) num canvas de `outW`×`outH`
 * pixels. `frames` são os quadros decodificados pelo motor, por id de item.
 */
export function drawProject(
  canvas: SkCanvas,
  plan: RenderPlan,
  res: DrawResources,
  t: Micros,
  frames: Record<string, VideoFrame>,
  outW: number,
  outH: number,
) {
  'worklet';
  const W = plan.width;
  const H = plan.height;
  const owned: SkImage[] = [];
  const take = (clip: RenderClip): ClipImage | null => {
    const img = clipImage(clip, frames, res);
    if (img?.owned) owned.push(img.image);
    return img;
  };

  canvas.save();
  canvas.scale(outW / W, outH / H);
  canvas.clipRect(Skia.XYWHRect(0, 0, W, H), ClipOp.Intersect, false);

  const active = activeMainAt(plan.main, t);
  const primaryImg = active.primary ? take(active.primary.clip) : null;
  const outgoingImg = active.outgoing ? take(active.outgoing.clip) : null;
  const bgSource =
    active.outgoing && active.progress < 0.5 && outgoingImg
      ? { clip: active.outgoing.clip, img: outgoingImg }
      : active.primary && primaryImg
        ? { clip: active.primary.clip, img: primaryImg }
        : null;
  drawBackground(canvas, plan, bgSource, W, H, res);

  const ownMotion = (clip: RenderClip) =>
    combine(
      itemMotion(t - clip.start, clip.end - clip.start, clip.animIn, clip.animOut),
      effectMotion(clip.effect?.kind, clip.effect?.amount ?? 0, (t - clip.start) / 1_000_000),
    );
  const secondsIn = (clip: RenderClip) => (t - clip.start) / 1_000_000;
  // Posição, escala, rotação e opacidade no instante (keyframes ou fixas).
  const stateOf = (clip: RenderClip) => liveState(clip, clip.opacity, t - clip.start);

  if (active.outgoing && active.transition && outgoingImg) {
    const tf = transitionFrame(active.transition.kind, active.progress);
    drawClip(canvas, active.outgoing.clip, outgoingImg, combine(ownMotion(active.outgoing.clip), tf.a), W, H, res, stateOf(active.outgoing.clip), secondsIn(active.outgoing.clip));
    if (active.primary && primaryImg) {
      canvas.save();
      if (tf.reveal) clipReveal(canvas, tf.reveal.shape, tf.reveal.amount, W, H);
      drawClip(canvas, active.primary.clip, primaryImg, combine(ownMotion(active.primary.clip), tf.b), W, H, res, stateOf(active.primary.clip), secondsIn(active.primary.clip));
      canvas.restore();
    }
    if (tf.flash && tf.flash.alpha > 0) {
      const flash = Skia.Paint();
      flash.setColor(Skia.Color(tf.flash.color));
      flash.setAlphaf(tf.flash.alpha);
      canvas.drawRect(Skia.XYWHRect(0, 0, W, H), flash);
    }
  } else if (active.primary && primaryImg) {
    drawClip(canvas, active.primary.clip, primaryImg, ownMotion(active.primary.clip), W, H, res, stateOf(active.primary.clip), secondsIn(active.primary.clip));
  }

  for (const overlay of plan.overlays) {
    if (t < overlay.start || t >= overlay.end) continue;
    const img = take(overlay);
    if (img) drawClip(canvas, overlay, img, ownMotion(overlay), W, H, res, stateOf(overlay), secondsIn(overlay));
  }

  for (const text of plan.texts) {
    if (t < text.start || t >= text.end) continue;
    const parts = res.texts[text.id];
    if (!parts) continue;
    const motion = itemMotion(t - text.start, text.end - text.start, text.animIn, text.animOut, text.animLoop);
    const state = liveState(text, 1, t - text.start);
    drawText(canvas, parts, text.style, state.transform, { ...motion, opacity: motion.opacity * state.opacity }, W, H);
  }

  const caption = captionAt(plan.captions.items, t);
  if (caption) {
    const parts = res.captions[caption.id];
    if (parts) {
      const position = plan.captions.position;
      drawText(
        canvas,
        parts,
        plan.captions.style,
        { x: position.x, y: position.y, scale: 1, rotation: 0 },
        { opacity: 1, scale: 1, dx: 0, dy: 0, rotation: 0 },
        W,
        H,
      );
    }
  }

  canvas.restore();
  for (const image of owned) image.dispose();
}
