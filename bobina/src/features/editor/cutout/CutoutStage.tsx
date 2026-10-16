/**
 * Palco do laço, por cima do preview: mostra o quadro do clipe inteiro (sem os
 * ajustes do projeto) para desenhar com precisão.
 *
 * - Laço: o dedo desenha uma linha suave; ao soltar, ela fecha sozinha e a IA
 *   acha o objeto dentro dela.
 * - Lupa: enquanto o dedo encosta, um círculo acima dele mostra a região
 *   ampliada, com a linha e a mira (o dedo não esconde o que está desenhando).
 * - Resultado: o objeto fica com a cor original, o resto escurece, e uma linha de
 *   luz corre pela borda. Com "Incluir"/"Excluir", cada toque ajusta a máscara.
 *
 * O objeto é desenhado com o mesmo shader da exportação: o que aparece aqui é o
 * recorte final.
 */
import {
  AlphaType,
  BlendMode,
  BlurStyle,
  Canvas,
  ClipOp,
  ColorType,
  FilterMode,
  MipmapMode,
  PaintStyle,
  Picture,
  Skia,
  StrokeCap,
  StrokeJoin,
  TileMode,
  createPicture,
  useClock,
  type SkCanvas,
  type SkImage,
  type SkRuntimeEffect,
} from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { MASK_SIZE, type Point } from '@/core/cutout';
import { cutoutEdgeEffect, fxEffect } from '@/engine/shaders';
import { Txt } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

import { useCutoutEditor } from './store';

/** Raio e aumento da lupa (pt). */
const LOUPE_R = 58;
const LOUPE_ZOOM = 2.4;
/** Distância mínima entre pontos do laço (pt). */
const STEP = 2.5;
/** Laço mais curto que isso é tratado como toque sem querer. */
const MIN_LASSO = 60;

interface Fit {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ACCENT = Skia.Color(colors.accent);
const INCLUDE = Skia.Color(colors.success);
const EXCLUDE = Skia.Color(colors.danger);

/** Caminho suave pelos pontos (curvas pelos pontos médios). */
function smoothPath(pts: number[], close: boolean) {
  'worklet';
  const b = Skia.PathBuilder.Make();
  const n = pts.length / 2;
  if (n < 2) return b.detach();
  b.moveTo(pts[0]!, pts[1]!);
  for (let i = 1; i < n - 1; i++) {
    const x = pts[i * 2]!;
    const y = pts[i * 2 + 1]!;
    b.quadTo(x, y, (x + pts[i * 2 + 2]!) / 2, (y + pts[i * 2 + 3]!) / 2);
  }
  b.lineTo(pts[(n - 1) * 2]!, pts[(n - 1) * 2 + 1]!);
  if (close) b.close();
  return b.detach();
}

function lengthOf(pts: number[]): number {
  'worklet';
  let len = 0;
  for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!);
  return len;
}

interface Scene {
  image: SkImage | null;
  fit: Fit | null;
  mask: SkImage | null;
  fx: SkRuntimeEffect | null;
  edge: SkRuntimeEffect | null;
  /** Laço já fechado, em pt da tela. */
  lasso: number[];
  clicks: { x: number; y: number; include: boolean }[];
  phase: string;
}

/** Quadro + recorte + laço + toques (desenhado duas vezes: normal e na lupa). */
function drawScene(canvas: SkCanvas, s: Scene, live: number[], drawing: boolean, time: number) {
  'worklet';
  const { image, fit } = s;
  if (!image || !fit) return;
  const iw = image.width();
  const ih = image.height();
  const k = fit.w / iw;
  canvas.save();
  canvas.translate(fit.x, fit.y);
  canvas.scale(k, k);
  const rect = Skia.XYWHRect(0, 0, iw, ih);
  if (s.mask && s.fx) {
    // Fundo escurecido e sem cor; o objeto por cima com o shader do recorte.
    const dim = Skia.Paint();
    dim.setColorFilter(
      Skia.ColorFilter.MakeMatrix([
        0.08, 0.16, 0.03, 0, 0, 0.08, 0.16, 0.03, 0, 0, 0.08, 0.16, 0.03, 0, 0, 0, 0, 0, 1, 0,
      ]),
    );
    canvas.drawImageRectOptions(image, rect, rect, FilterMode.Linear, MipmapMode.None, dim);
    const maskShader = s.mask.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Nearest, MipmapMode.None);
    const paint = Skia.Paint();
    paint.setShader(
      s.fx.makeShaderWithChildren(
        [iw, ih, 0, 0, 0, 0, 0, 0, 0, 0, 1, MASK_SIZE, 0, 0, 0],
        [image.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None), maskShader],
      ),
    );
    canvas.drawRect(rect, paint);
    if (s.edge) {
      const glow = Skia.Paint();
      glow.setShader(s.edge.makeShaderWithChildren([iw, ih, MASK_SIZE, time / 1000, 1, 0.71, 0.28, 0.9], [maskShader]));
      glow.setBlendMode(BlendMode.Plus);
      canvas.drawRect(rect, glow);
    }
  } else {
    const plain = Skia.Paint();
    if (s.phase === 'thinking' || s.phase === 'opening') plain.setAlphaf(0.85);
    canvas.drawImageRectOptions(image, rect, rect, FilterMode.Linear, MipmapMode.None, plain);
  }
  canvas.restore();

  // Laço: o que está sendo desenhado (com a volta prevista tracejada) ou o fechado.
  const stroke = Skia.Paint();
  stroke.setAntiAlias(true);
  stroke.setStyle(PaintStyle.Stroke);
  stroke.setStrokeCap(StrokeCap.Round);
  stroke.setStrokeJoin(StrokeJoin.Round);
  const glowPaint = stroke.copy();
  glowPaint.setStrokeWidth(7);
  glowPaint.setColor(ACCENT);
  glowPaint.setAlphaf(0.35);
  glowPaint.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 4, true));
  stroke.setStrokeWidth(2.4);
  stroke.setColor(ACCENT);
  if (drawing && live.length >= 4) {
    const path = smoothPath(live, false);
    canvas.drawPath(path, glowPaint);
    canvas.drawPath(path, stroke);
    const back = Skia.PathBuilder.Make()
      .moveTo(live[live.length - 2]!, live[live.length - 1]!)
      .lineTo(live[0]!, live[1]!)
      .detach();
    const dashed = stroke.copy();
    dashed.setAlphaf(0.55);
    dashed.setPathEffect(Skia.PathEffect.MakeDash([6, 6], 0));
    canvas.drawPath(back, dashed);
    const near = Math.hypot(live[live.length - 2]! - live[0]!, live[live.length - 1]! - live[1]!) < 28;
    const dot = Skia.Paint();
    dot.setAntiAlias(true);
    dot.setColor(ACCENT);
    canvas.drawCircle(live[0]!, live[1]!, near ? 7 : 4, dot);
  } else if (s.lasso.length >= 6 && !s.mask) {
    const path = smoothPath(s.lasso, true);
    const fill = Skia.Paint();
    fill.setColor(ACCENT);
    fill.setAlphaf(0.1);
    canvas.drawPath(path, fill);
    const running = stroke.copy();
    // Pensando: o tracejado anda em volta do laço.
    running.setPathEffect(Skia.PathEffect.MakeDash([12, 9], -(time / 16) % 21));
    canvas.drawPath(path, glowPaint);
    canvas.drawPath(path, running);
  }

  // Toques de ajuste.
  for (const c of s.clicks) {
    const ring = Skia.Paint();
    ring.setAntiAlias(true);
    ring.setColor(Skia.Color('#0b0c0f'));
    canvas.drawCircle(c.x, c.y, 10, ring);
    ring.setColor(c.include ? INCLUDE : EXCLUDE);
    canvas.drawCircle(c.x, c.y, 8, ring);
    const mark = Skia.Paint();
    mark.setAntiAlias(true);
    mark.setStyle(PaintStyle.Stroke);
    mark.setStrokeWidth(2);
    mark.setStrokeCap(StrokeCap.Round);
    mark.setColor(Skia.Color('#0b0c0f'));
    canvas.drawLine(c.x - 4, c.y, c.x + 4, c.y, mark);
    if (c.include) canvas.drawLine(c.x, c.y - 4, c.x, c.y + 4, mark);
  }
}

const HINTS: Record<string, string> = {
  thinking: 'Procurando o objeto…',
  saving: 'Criando a figurinha…',
  drawing: 'Contorne o objeto com o dedo',
  include: 'Toque no que falta no recorte',
  exclude: 'Toque no que deve sair do recorte',
  result: 'Desenhe de novo para refazer, ou ajuste com Incluir e Excluir',
};

function hintFor(phase: string, tool: string, kind: 'clip' | 'photo'): string {
  if (phase === 'opening') return kind === 'photo' ? 'Preparando a foto…' : 'Preparando o quadro…';
  if (phase === 'result') return HINTS[tool] ?? HINTS.result!;
  return HINTS[phase] ?? HINTS.result!;
}

/** `kind`: o que está embaixo do laço (um quadro do clipe ou uma foto da colagem). */
export function CutoutStage({ kind = 'clip' }: { kind?: 'clip' | 'photo' }) {
  const session = useCutoutEditor((s) => s.session);
  const phase = useCutoutEditor((s) => s.phase);
  const tool = useCutoutEditor((s) => s.tool);
  const lasso = useCutoutEditor((s) => s.lasso);
  const clicks = useCutoutEditor((s) => s.clicks);
  const maskBytes = useCutoutEditor((s) => s.mask);
  const error = useCutoutEditor((s) => s.error);
  const finishLasso = useCutoutEditor((s) => s.finishLasso);
  const addClick = useCutoutEditor((s) => s.addClick);
  const [area, setArea] = useState({ width: 0, height: 0 });
  // Com o dedo encostado, a dica sai de cima (a lupa pode passar por ali).
  const [touching, setTouching] = useState(false);

  const image = session?.image ?? null;
  const fit = useMemo<Fit | null>(() => {
    if (!image || area.width <= 0 || area.height <= 0) return null;
    const pad = space[3];
    const aw = area.width - pad * 2;
    const ah = area.height - pad * 2;
    const k = Math.min(aw / image.width(), ah / image.height());
    const w = image.width() * k;
    const h = image.height() * k;
    return { x: (area.width - w) / 2, y: (area.height - h) / 2, w, h };
  }, [image, area]);

  const mask = useMemo(() => {
    if (!maskBytes) return null;
    return Skia.Image.MakeImage(
      { width: MASK_SIZE, height: MASK_SIZE, colorType: ColorType.Gray_8, alphaType: AlphaType.Opaque },
      Skia.Data.fromBytes(maskBytes),
      MASK_SIZE,
    );
  }, [maskBytes]);
  useEffect(() => () => mask?.dispose(), [mask]);

  const toScreen = useCallback((p: Point) => (fit ? { x: fit.x + p.x * fit.w, y: fit.y + p.y * fit.h } : { x: 0, y: 0 }), [fit]);
  const scene: Scene = useMemo(
    () => ({
      image,
      fit,
      mask: phase === 'drawing' ? null : mask,
      fx: fxEffect(),
      edge: cutoutEdgeEffect(),
      lasso: lasso.flatMap((p) => {
        const s = toScreen(p);
        return [s.x, s.y];
      }),
      clicks: clicks.map((c) => ({ ...toScreen(c), include: c.include })),
      phase,
    }),
    [image, fit, mask, lasso, clicks, phase, toScreen],
  );

  // Estado do dedo (thread de UI).
  const live = useSharedValue<number[]>([]);
  const finger = useSharedValue({ x: 0, y: 0, on: 0, drawing: 0 });
  const toolSV = useSharedValue(tool);
  const canDraw = phase === 'drawing' || phase === 'result';
  const canDrawSV = useSharedValue(canDraw);
  useEffect(() => {
    toolSV.set(tool);
    canDrawSV.set(canDraw);
  }, [tool, canDraw, toolSV, canDrawSV]);
  const clock = useClock();

  const commitLasso = useCallback(
    (pts: number[]) => {
      if (!fit) return;
      const norm: Point[] = [];
      for (let i = 0; i < pts.length; i += 2) {
        norm.push({
          x: Math.min(1, Math.max(0, (pts[i]! - fit.x) / fit.w)),
          y: Math.min(1, Math.max(0, (pts[i + 1]! - fit.y) / fit.h)),
        });
      }
      Haptics.selectionAsync().catch(() => {});
      finishLasso(norm).finally(() => live.set([]));
    },
    [fit, finishLasso, live],
  );

  const commitClick = useCallback(
    (x: number, y: number, include: boolean) => {
      if (!fit) return;
      const u = (x - fit.x) / fit.w;
      const v = (y - fit.y) / fit.h;
      if (u < 0 || u > 1 || v < 0 || v > 1) return;
      Haptics.selectionAsync().catch(() => {});
      addClick({ x: u, y: v, include });
    },
    [fit, addClick],
  );

  const gesture = Gesture.Manual()
    .onTouchesDown((e, manager) => {
      const t = e.allTouches[0];
      if (!t || !canDrawSV.get() || e.allTouches.length > 1) {
        manager.fail();
        return;
      }
      manager.activate();
      scheduleOnRN(setTouching, true);
      const drawing = toolSV.get() === 'lasso' ? 1 : 0;
      finger.set({ x: t.x, y: t.y, on: 1, drawing });
      live.set(drawing ? [t.x, t.y] : []);
    })
    .onTouchesMove((e) => {
      const t = e.allTouches[0];
      if (!t || !finger.get().on) return;
      finger.set({ ...finger.get(), x: t.x, y: t.y });
      if (!finger.get().drawing) return;
      const pts = live.get();
      const n = pts.length;
      if (n >= 2 && Math.hypot(t.x - pts[n - 2]!, t.y - pts[n - 1]!) < STEP) return;
      live.modify((value) => {
        'worklet';
        value.push(t.x, t.y);
        return value;
      }, true);
    })
    .onTouchesUp((e, manager) => {
      const f = finger.get();
      finger.set({ ...f, on: 0 });
      scheduleOnRN(setTouching, false);
      if (f.drawing) {
        const pts = live.get();
        if (pts.length >= 12 && lengthOf(pts) >= MIN_LASSO) scheduleOnRN(commitLasso, pts.slice());
        else live.set([]);
      } else {
        scheduleOnRN(commitClick, f.x, f.y, toolSV.get() === 'include');
      }
      manager.end();
    })
    .onTouchesCancelled((_e, manager) => {
      finger.set({ ...finger.get(), on: 0 });
      scheduleOnRN(setTouching, false);
      live.set([]);
      manager.fail();
    });

  const picture = useDerivedValue(() => {
    const time = clock.get();
    const f = finger.get();
    const pts = live.get();
    const drawing = f.on === 1 && f.drawing === 1;
    return createPicture((canvas) => {
      drawScene(canvas, scene, pts, drawing, time);
      if (!f.on || !scene.fit) return;
      // Lupa: acima do dedo (ou abaixo, perto do topo), sem sair da tela.
      let cx = f.x;
      let cy = f.y - LOUPE_R - 44;
      if (cy - LOUPE_R < 4) cy = f.y + LOUPE_R + 44;
      cx = Math.min(Math.max(cx, LOUPE_R + 4), area.width - LOUPE_R - 4);
      const shadow = Skia.Paint();
      shadow.setColor(Skia.Color('#000000'));
      shadow.setAlphaf(0.45);
      shadow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 8, true));
      canvas.drawCircle(cx, cy + 3, LOUPE_R, shadow);
      canvas.save();
      canvas.clipPath(Skia.PathBuilder.Make().addCircle(cx, cy, LOUPE_R).detach(), ClipOp.Intersect, true);
      canvas.drawColor(Skia.Color(colors.bg));
      canvas.translate(cx, cy);
      canvas.scale(LOUPE_ZOOM, LOUPE_ZOOM);
      canvas.translate(-f.x, -f.y);
      drawScene(canvas, scene, pts, drawing, time);
      canvas.restore();
      const ring = Skia.Paint();
      ring.setAntiAlias(true);
      ring.setStyle(PaintStyle.Stroke);
      ring.setStrokeWidth(2);
      ring.setColor(Skia.Color(colors.text));
      ring.setAlphaf(0.9);
      canvas.drawCircle(cx, cy, LOUPE_R, ring);
      const aim = Skia.Paint();
      aim.setAntiAlias(true);
      aim.setStyle(PaintStyle.Stroke);
      aim.setStrokeWidth(1.5);
      aim.setColor(f.drawing ? ACCENT : toolSV.get() === 'include' ? INCLUDE : EXCLUDE);
      canvas.drawCircle(cx, cy, 6, aim);
      canvas.drawLine(cx - 14, cy, cx - 9, cy, aim);
      canvas.drawLine(cx + 9, cy, cx + 14, cy, aim);
      canvas.drawLine(cx, cy - 14, cx, cy - 9, aim);
      canvas.drawLine(cx, cy + 9, cx, cy + 14, aim);
    });
  });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea({ width, height });
  };

  const hint = error ?? hintFor(phase, tool, kind);

  return (
    <View style={styles.stage} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} accessibilityLabel="Área do laço: contorne o objeto com o dedo">
          <Canvas style={StyleSheet.absoluteFill}>
            <Picture picture={picture} />
          </Canvas>
        </View>
      </GestureDetector>
      <View style={[styles.hintRow, touching ? { opacity: 0 } : null]} pointerEvents="none">
        <View style={styles.hint} accessibilityLiveRegion="polite">
          <Txt variant="sm" tone={error ? 'danger' : 'default'} align="center">
            {hint}
          </Txt>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { ...StyleSheet.absoluteFill, backgroundColor: colors.bg },
  hintRow: { position: 'absolute', top: space[2], left: 0, right: 0, alignItems: 'center' },
  hint: {
    maxWidth: '90%',
    paddingHorizontal: space[3],
    paddingVertical: space[1] + 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(22,24,29,0.88)',
  },
});
