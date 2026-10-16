/**
 * Por cima da colagem no editor (em pt da tela): guias do centro, célula e
 * camada selecionadas com a alça do canto, alças das linhas da grade e a foto
 * sendo trocada de lugar. Worklet, desenhado junto com a colagem.
 */
import { BlurStyle, ClipOp, FilterMode, MipmapMode, PaintStyle, Skia, StrokeCap, type SkCanvas } from '@shopify/react-native-skia';

import {
  boxCorner,
  framingOf,
  gridGeometry,
  gridMetrics,
  layerBox,
  photoInCell,
  type Collage,
  type CollageGesture,
} from '@/core/collage';
import type { CollageSelection } from '@/state/collage';
import { colors } from '@/ui/theme';

import type { LoadedCollageResources } from './useCollageResources';

/** Raio da alça do canto (pt). */
export const HANDLE_R = 12;

export interface Fit {
  x: number;
  y: number;
  /** pt por unidade de desenho. */
  k: number;
  W: number;
  H: number;
}

/** Alças, seleção, guias e a foto sendo trocada (por cima, em pt da tela). */
export function drawOverlay(
  canvas: SkCanvas,
  c: Collage,
  loaded: LoadedCollageResources,
  f: Fit,
  selection: CollageSelection,
  live: CollageGesture,
  guides: { x: boolean; y: boolean },
) {
  'worklet';
  const sx = (x: number) => f.x + x * f.k;
  const sy = (y: number) => f.y + y * f.k;
  const accent = Skia.Color(colors.accent);
  const stroke = Skia.Paint();
  stroke.setAntiAlias(true);
  stroke.setStyle(PaintStyle.Stroke);
  stroke.setColor(accent);

  // Guias do centro.
  if (guides.x || guides.y) {
    const guide = stroke.copy();
    guide.setStrokeWidth(1);
    guide.setAlphaf(0.9);
    if (guides.x) canvas.drawLine(sx(f.W / 2), sy(0), sx(f.W / 2), sy(f.H), guide);
    if (guides.y) canvas.drawLine(sx(0), sy(f.H / 2), sx(f.W), sy(f.H / 2), guide);
  }

  const grid = c.grid ? gridGeometry(c.grid.root, f.W, f.H, gridMetrics(c, f.W, f.H).gap, gridMetrics(c, f.W, f.H).margin) : null;
  const radius = c.grid ? gridMetrics(c, f.W, f.H).radius : 0;

  // Célula selecionada.
  if (grid && selection?.kind === 'cell' && live.kind !== 'swap') {
    const cell = grid.cells[selection.index];
    if (cell) {
      const ring = stroke.copy();
      ring.setStrokeWidth(2.5);
      const r = Math.max(0, Math.min(radius, cell.w / 2, cell.h / 2) * f.k - 1.25);
      canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(sx(cell.x) + 1.25, sy(cell.y) + 1.25, cell.w * f.k - 2.5, cell.h * f.k - 2.5), r, r), ring);
    }
  }

  // Alças das linhas da grade.
  if (grid && selection?.kind !== 'layer' && live.kind !== 'swap') {
    for (let i = 0; i < grid.dividers.length; i++) {
      const d = grid.dividers[i]!;
      if (d.span * f.k < 44) continue;
      const vertical = d.dir === 'row';
      const w = vertical ? 7 : 30;
      const h = vertical ? 30 : 7;
      const rect = Skia.RRectXY(Skia.XYWHRect(sx(d.cx) - w / 2, sy(d.cy) - h / 2, w, h), 3.5, 3.5);
      const shadow = Skia.Paint();
      shadow.setColor(Skia.Color('#000000'));
      shadow.setAlphaf(0.35);
      shadow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 3, true));
      canvas.drawRRect(rect, shadow);
      // Cor de destaque com contorno branco: aparece no espaço claro e em cima das fotos.
      const active = live.kind === 'divider' && live.divider === i;
      const pill = Skia.Paint();
      pill.setAntiAlias(true);
      pill.setColor(active ? Skia.Color('#ffffff') : accent);
      canvas.drawRRect(rect, pill);
      const edge = stroke.copy();
      edge.setStrokeWidth(1.5);
      edge.setColor(active ? accent : Skia.Color('#ffffff'));
      canvas.drawRRect(rect, edge);
    }
  }

  // Camada selecionada: caixa girada e a alça do canto.
  if (selection?.kind === 'layer') {
    const layer = c.layers.find((l) => l.id === selection.id);
    const box = layer ? layerBox(c, layer, f.W, f.H, loaded.textSizes[layer.id] ?? null) : null;
    if (box) {
      canvas.save();
      canvas.translate(sx(box.cx), sy(box.cy));
      canvas.rotate(box.rotation, 0, 0);
      const outline = stroke.copy();
      outline.setStrokeWidth(1.5);
      canvas.drawRect(Skia.XYWHRect((-box.w / 2) * f.k - 3, (-box.h / 2) * f.k - 3, box.w * f.k + 6, box.h * f.k + 6), outline);
      canvas.restore();
      const corner = boxCorner({ ...box, w: box.w + 6 / f.k, h: box.h + 6 / f.k });
      const hx = sx(corner.x);
      const hy = sy(corner.y);
      const shadow = Skia.Paint();
      shadow.setColor(Skia.Color('#000000'));
      shadow.setAlphaf(0.4);
      shadow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 4, true));
      canvas.drawCircle(hx, hy + 1, HANDLE_R, shadow);
      const fill = Skia.Paint();
      fill.setAntiAlias(true);
      fill.setColor(accent);
      canvas.drawCircle(hx, hy, HANDLE_R, fill);
      // Seta dupla na diagonal (aumentar/girar).
      const mark = Skia.Paint();
      mark.setAntiAlias(true);
      mark.setStyle(PaintStyle.Stroke);
      mark.setStrokeWidth(1.8);
      mark.setStrokeCap(StrokeCap.Round);
      mark.setColor(Skia.Color(colors.onAccent));
      const a = 4.5;
      canvas.drawLine(hx - a, hy - a, hx + a, hy + a, mark);
      canvas.drawLine(hx + a, hy + a, hx + a - 3.5, hy + a, mark);
      canvas.drawLine(hx + a, hy + a, hx + a, hy + a - 3.5, mark);
      canvas.drawLine(hx - a, hy - a, hx - a + 3.5, hy - a, mark);
      canvas.drawLine(hx - a, hy - a, hx - a, hy - a + 3.5, mark);
    }
  }

  // Trocando fotos: a célula de destino e a foto seguindo o dedo.
  if (live.kind === 'swap' && grid) {
    const target = grid.cells[live.over];
    if (target && live.over !== live.from) {
      const ring = stroke.copy();
      ring.setStrokeWidth(3);
      const r = Math.max(0, Math.min(radius, target.w / 2, target.h / 2) * f.k);
      canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(sx(target.x), sy(target.y), target.w * f.k, target.h * f.k), r, r), ring);
    }
    const from = grid.cells[live.from];
    const photoId = c.slots[live.from];
    const photo = photoId ? c.photos[photoId] : undefined;
    const image = photoId ? loaded.res.photos[photoId] : undefined;
    if (from && photo && image) {
      const side = Math.min(from.w, from.h, Math.min(f.W, f.H) * 0.45) * 0.7 * f.k;
      const w = from.w >= from.h ? side * (from.w / from.h) : side;
      const h = from.w >= from.h ? side : side * (from.h / from.w);
      const x = sx(live.x) - w / 2;
      const y = sy(live.y) - h / 2;
      const shadow = Skia.Paint();
      shadow.setColor(Skia.Color('#000000'));
      shadow.setAlphaf(0.45);
      shadow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 10, true));
      canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(x, y + 6, w, h), 10, 10), shadow);
      canvas.save();
      canvas.clipRRect(Skia.RRectXY(Skia.XYWHRect(x, y, w, h), 10, 10), ClipOp.Intersect, true);
      const d = photoInCell({ x, y, w, h }, photo.width, photo.height, framingOf(c, photoId!));
      const p = Skia.Paint();
      p.setAlphaf(0.92);
      canvas.drawImageRectOptions(
        image,
        Skia.XYWHRect(0, 0, image.width(), image.height()),
        Skia.XYWHRect(d.x, d.y, d.w, d.h),
        FilterMode.Linear,
        MipmapMode.Linear,
        p,
      );
      canvas.restore();
      const ring = stroke.copy();
      ring.setStrokeWidth(2);
      ring.setColor(Skia.Color('#ffffff'));
      canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(x, y, w, h), 10, 10), ring);
    }
  }
}
