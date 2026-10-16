/**
 * Desenho da colagem. É um worklet: o mesmo código desenha na tela (thread de
 * UI, a cada gesto) e na exportação, então o que se vê é o que sai na imagem.
 *
 * Tudo acontece no espaço de desenho (lado menor 1080); a tela e a exportação
 * só escalam o canvas antes de chamar.
 */
import {
  BlendMode,
  BlurStyle,
  ClipOp,
  FilterMode,
  MipmapMode,
  PaintStyle,
  Skia,
  StrokeCap,
  TileMode,
  type SkCanvas,
  type SkImage,
  type SkImageFilter,
} from '@shopify/react-native-skia';

import {
  containSize,
  framingOf,
  gridGeometry,
  gridMetrics,
  photoInCell,
  type Collage,
  type CollageBackground,
  type PhotoLayer,
  type StickerLayer,
} from '@/core/collage';
import { REST } from '@/core/motion';

import { drawText } from './draw';
import type { TextParts } from './text';

export interface CollageResources {
  /** Fotos por id (a cópia menor na tela, a inteira na exportação). */
  photos: Record<string, SkImage>;
  stickers: Record<string, SkImage>;
  /** Parágrafos dos textos, montados no espaço de desenho. */
  texts: Record<string, TextParts>;
}

export interface CollageDrawOptions {
  /** Células vazias com um "+" (só no editor). */
  placeholders: boolean;
  /** Célula cuja foto está sendo arrastada para trocar de lugar (-1: nenhuma). */
  lifted: number;
}

const EXPORT_OPTIONS: CollageDrawOptions = { placeholders: false, lifted: -1 };

function drawBackground(canvas: SkCanvas, bg: CollageBackground, W: number, H: number) {
  'worklet';
  const paint = Skia.Paint();
  if (bg.kind === 'color') {
    paint.setColor(Skia.Color(bg.color));
  } else {
    // Gradiente atravessando o quadro no ângulo pedido.
    const a = (bg.angle * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const half = (Math.abs(dx) * W + Math.abs(dy) * H) / 2;
    paint.setShader(
      Skia.Shader.MakeLinearGradient(
        { x: W / 2 - dx * half, y: H / 2 - dy * half },
        { x: W / 2 + dx * half, y: H / 2 + dy * half },
        [Skia.Color(bg.from), Skia.Color(bg.to)],
        null,
        TileMode.Clamp,
      ),
    );
  }
  canvas.drawRect(Skia.XYWHRect(0, 0, W, H), paint);
}

/** Foto no retângulo, espelhada se pedido, com amostragem boa para reduzir. */
function drawPhoto(canvas: SkCanvas, image: SkImage, x: number, y: number, w: number, h: number, flipH: boolean) {
  'worklet';
  const src = Skia.XYWHRect(0, 0, image.width(), image.height());
  if (flipH) {
    canvas.save();
    canvas.translate(x + w / 2, 0);
    canvas.scale(-1, 1);
    canvas.translate(-(x + w / 2), 0);
  }
  canvas.drawImageRectOptions(image, src, Skia.XYWHRect(x, y, w, h), FilterMode.Linear, MipmapMode.Linear, null);
  if (flipH) canvas.restore();
}

function drawGrid(canvas: SkCanvas, c: Collage, res: CollageResources, W: number, H: number, opts: CollageDrawOptions) {
  'worklet';
  if (!c.grid) return;
  const m = gridMetrics(c, W, H);
  const { cells } = gridGeometry(c.grid.root, W, H, m.gap, m.margin);
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!;
    const r = Math.min(m.radius, cell.w / 2, cell.h / 2);
    const shape = Skia.RRectXY(Skia.XYWHRect(cell.x, cell.y, cell.w, cell.h), r, r);
    const photoId = c.slots[i] ?? null;
    const photo = photoId ? c.photos[photoId] : undefined;
    const image = photoId ? res.photos[photoId] : undefined;
    if (photo && image && i !== opts.lifted) {
      canvas.save();
      canvas.clipRRect(shape, ClipOp.Intersect, true);
      const f = framingOf(c, photoId!);
      const d = photoInCell(cell, photo.width, photo.height, f);
      drawPhoto(canvas, image, d.x, d.y, d.w, d.h, f.flipH);
      canvas.restore();
    } else if (opts.placeholders) {
      // Célula vazia (ou a de onde a foto saiu): cinza que funciona em fundo claro e escuro.
      const fill = Skia.Paint();
      fill.setAntiAlias(true);
      fill.setColor(Skia.Color('#808080'));
      fill.setAlphaf(i === opts.lifted ? 0.28 : 0.18);
      canvas.drawRRect(shape, fill);
      if (i !== opts.lifted) {
        const plus = Skia.Paint();
        plus.setAntiAlias(true);
        plus.setStyle(PaintStyle.Stroke);
        plus.setStrokeCap(StrokeCap.Round);
        plus.setStrokeWidth(Math.max(4, Math.min(W, H) * 0.006));
        plus.setColor(Skia.Color('#808080'));
        plus.setAlphaf(0.75);
        const s = Math.min(cell.w, cell.h, Math.min(W, H) * 0.25) * 0.14;
        const cx = cell.x + cell.w / 2;
        const cy = cell.y + cell.h / 2;
        canvas.drawLine(cx - s, cy, cx + s, cy, plus);
        canvas.drawLine(cx, cy - s, cx, cy + s, plus);
      }
    }
  }
}

function withOpacity(canvas: SkCanvas, opacity: number): boolean {
  'worklet';
  if (opacity >= 0.999) return false;
  const p = Skia.Paint();
  p.setAlphaf(Math.max(0, opacity));
  canvas.saveLayer(p);
  return true;
}

function drawPhotoLayer(canvas: SkCanvas, c: Collage, layer: PhotoLayer, image: SkImage, W: number, H: number) {
  'worklet';
  const photo = c.photos[layer.photoId];
  if (!photo || layer.opacity <= 0.001) return;
  const base = containSize(photo.width, photo.height, W, H);
  const w = base.width * layer.transform.scale;
  const h = base.height * layer.transform.scale;
  const b = layer.border ? layer.border.width * Math.min(w, h) : 0;
  canvas.save();
  canvas.translate(W / 2 + layer.transform.x * W, H / 2 + layer.transform.y * H);
  canvas.rotate(layer.transform.rotation, 0, 0);
  const layered = withOpacity(canvas, layer.opacity);
  const outer = Skia.XYWHRect(-w / 2 - b, -h / 2 - b, w + b * 2, h + b * 2);
  if (layer.shadow) {
    const long = Math.max(w, h);
    const shadow = Skia.Paint();
    shadow.setColor(Skia.Color('#000000'));
    shadow.setAlphaf(0.32);
    shadow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, long * 0.025, true));
    canvas.drawRect(Skia.XYWHRect(outer.x, outer.y + long * 0.015, outer.width, outer.height), shadow);
  }
  if (layer.border) {
    const frame = Skia.Paint();
    frame.setAntiAlias(true);
    frame.setColor(Skia.Color(layer.border.color));
    canvas.drawRect(outer, frame);
  }
  drawPhoto(canvas, image, -w / 2, -h / 2, w, h, layer.flipH);
  if (layered) canvas.restore();
  canvas.restore();
}

/**
 * Contorno de figurinha: a silhueta desfocada e cortada num limiar vira uma
 * borda lisa e arredondada em volta do recorte (como as figurinhas de papel).
 * Medidas em pixels da imagem da figurinha.
 */
export function stickerFilter(layer: StickerLayer, iw: number, ih: number): SkImageFilter | null {
  'worklet';
  const long = Math.max(iw, ih);
  let filter: SkImageFilter | null = null;
  if (layer.outline && layer.outline.width > 0.001) {
    const offset = layer.outline.width * 0.05 * long;
    const sigma = Math.max(0.5, offset / 1.645);
    // Limiar em 5% da silhueta desfocada; a rampa de ~1,5 px deixa a borda lisa.
    const k = Math.max(4, sigma / 0.155);
    const t = 0.05;
    const color = Skia.Color(layer.outline.color);
    const shape = Skia.ImageFilter.MakeColorFilter(
      Skia.ColorFilter.MakeMatrix([0, 0, 0, 0, color[0]!, 0, 0, 0, 0, color[1]!, 0, 0, 0, 0, color[2]!, 0, 0, 0, k, -k * t]),
      Skia.ImageFilter.MakeBlur(sigma, sigma, TileMode.Decal, null),
    );
    filter = Skia.ImageFilter.MakeBlend(BlendMode.SrcOver, shape, null);
  }
  if (layer.shadow) {
    const shadowColor = Skia.Color('#000000');
    shadowColor[3] = 0.35;
    filter = Skia.ImageFilter.MakeDropShadow(0, long * 0.015, long * 0.02, long * 0.02, shadowColor, filter);
  }
  return filter;
}

function drawStickerLayer(canvas: SkCanvas, c: Collage, layer: StickerLayer, image: SkImage, W: number, H: number) {
  'worklet';
  const sticker = c.stickers[layer.stickerId];
  if (!sticker || layer.opacity <= 0.001) return;
  const iw = image.width();
  const ih = image.height();
  const base = containSize(sticker.width, sticker.height, W, H);
  const k = (base.width * layer.transform.scale) / iw;
  canvas.save();
  canvas.translate(W / 2 + layer.transform.x * W, H / 2 + layer.transform.y * H);
  canvas.rotate(layer.transform.rotation, 0, 0);
  canvas.scale(layer.flipH ? -k : k, k);
  const layered = withOpacity(canvas, layer.opacity);
  const paint = Skia.Paint();
  const filter = stickerFilter(layer, iw, ih);
  if (filter) paint.setImageFilter(filter);
  canvas.drawImageRectOptions(
    image,
    Skia.XYWHRect(0, 0, iw, ih),
    Skia.XYWHRect(-iw / 2, -ih / 2, iw, ih),
    FilterMode.Linear,
    MipmapMode.Linear,
    paint,
  );
  if (layered) canvas.restore();
  canvas.restore();
}

/** Desenha a colagem inteira em `W`×`H` (unidades de desenho). */
export function drawCollage(
  canvas: SkCanvas,
  c: Collage,
  res: CollageResources,
  W: number,
  H: number,
  opts: CollageDrawOptions = EXPORT_OPTIONS,
) {
  'worklet';
  canvas.save();
  canvas.clipRect(Skia.XYWHRect(0, 0, W, H), ClipOp.Intersect, false);
  drawBackground(canvas, c.background, W, H);
  drawGrid(canvas, c, res, W, H, opts);
  for (const layer of c.layers) {
    if (layer.kind === 'photo') {
      const image = res.photos[layer.photoId];
      if (image) drawPhotoLayer(canvas, c, layer, image, W, H);
    } else if (layer.kind === 'sticker') {
      const image = res.stickers[layer.stickerId];
      if (image) drawStickerLayer(canvas, c, layer, image, W, H);
    } else {
      const parts = res.texts[layer.id];
      if (parts) drawText(canvas, parts, layer.style, layer.transform, REST, W, H);
    }
  }
  canvas.restore();
}
