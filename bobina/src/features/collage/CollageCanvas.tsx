/**
 * A colagem na tela, com os gestos rodando na thread de UI:
 *
 * - Grade: arrastar dentro de uma célula enquadra a foto; pinça aproxima;
 *   segurar e arrastar troca a foto de lugar com outra célula; as alças nas
 *   linhas entre as fotos mudam o tamanho das células.
 * - Camadas (fotos soltas, figurinhas e textos): arrastar move; dois dedos ou a
 *   alça do canto escalam e giram, com ímã no centro e nos ângulos retos.
 * - Toque seleciona; tocar de novo num texto selecionado abre a edição.
 *
 * Durante o gesto, o desenho aplica o deslocamento sobre a colagem (sem passar
 * pelo React); ao soltar, vira um passo de desfazer.
 */
import { BlurStyle, Canvas, Picture, Skia, createPicture } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import {
  NO_GESTURE,
  applyGesture,
  boxCorner,
  cellAt,
  collageDesignSize,
  dividerAt,
  gridGeometry,
  gridMetrics,
  layerAt,
  layerBox,
  type Collage,
  type CollageGesture,
} from '@/core/collage';
import { fitInside } from '@/core/geometry';
import { drawCollage } from '@/engine/collageDraw';
import type { CollageSelection } from '@/state/collage';
import { colors } from '@/ui/theme';

import { drawOverlay, type Fit } from './overlay';
import type { LoadedCollageResources } from './useCollageResources';

/** Folga em volta da colagem na área de edição (pt). */
const PAD = 16;
/** Alça do canto, linhas da grade e folga para tocar camadas (pt). */
const HANDLE_HIT = 26;
const DIVIDER_HIT = 16;
const LAYER_SLACK = 6;
/** Ímã do centro (pt) e dos ângulos retos (graus). */
const SNAP_PT = 7;
const SNAP_DEG = 3;
const ROTATION_DEADZONE = 4;

/** O que o gesto em andamento mexe. */
type Target = 'none' | 'layer' | 'cell' | 'divider' | 'handle';

interface Track {
  active: number;
  target: Target;
  id: string;
  index: number;
  /** Onde o gesto começou (pt). */
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  scale: number;
  rotation: number;
  /** Zona morta do giro já vencida (e com que sinal). */
  turned: boolean;
  turnOffset: number;
  /** Centro da camada no começo (pt), para a alça. */
  cx: number;
  cy: number;
  snapX: boolean;
  snapY: boolean;
  snapR: boolean;
}

const IDLE: Track = {
  active: 0,
  target: 'none',
  id: '',
  index: -1,
  sx: 0,
  sy: 0,
  tx: 0,
  ty: 0,
  scale: 1,
  rotation: 0,
  turned: false,
  turnOffset: 0,
  cx: 0,
  cy: 0,
  snapX: false,
  snapY: false,
  snapR: false,
};

export interface CollageCanvasProps {
  collage: Collage;
  loaded: LoadedCollageResources;
  selection: CollageSelection;
  onSelect: (selection: CollageSelection) => void;
  /** Grava o gesto e devolve a colagem já atualizada. */
  onCommit: (gesture: CollageGesture) => Collage;
  onSwap: (from: number, to: number) => Collage;
  onEmptyCell: (index: number) => void;
  onEditText: (id: string) => void;
}

function buzz() {
  Haptics.selectionAsync().catch(() => {});
}

function lift() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function CollageCanvas({ collage, loaded, selection, onSelect, onCommit, onSwap, onEmptyCell, onEditText }: CollageCanvasProps) {
  const [area, setArea] = useState({ width: 0, height: 0 });
  const { width: W, height: H } = collageDesignSize(collage);

  const state = useSharedValue<{ doc: Collage; live: CollageGesture }>({ doc: collage, live: NO_GESTURE });
  const resSV = useSharedValue(loaded);
  const selSV = useSharedValue<CollageSelection>(selection);
  const fitSV = useSharedValue<Fit>({ x: 0, y: 0, k: 0, W, H });
  const guides = useSharedValue({ x: false, y: false });
  const track = useSharedValue<Track>(IDLE);

  useEffect(() => {
    state.set({ doc: collage, live: NO_GESTURE });
  }, [collage, state]);
  useEffect(() => {
    resSV.set(loaded);
  }, [loaded, resSV]);
  useEffect(() => {
    selSV.set(selection);
  }, [selection, selSV]);
  useEffect(() => {
    if (area.width <= 0 || area.height <= 0) return;
    const box = fitInside(W / H, { width: Math.max(1, area.width - PAD * 2), height: Math.max(1, area.height - PAD * 2) });
    fitSV.set({ x: (area.width - box.width) / 2, y: (area.height - box.height) / 2, k: box.width / W, W, H });
  }, [area, W, H, fitSV]);

  const commit = useCallback(
    (g: CollageGesture) => {
      state.set({ doc: onCommit(g), live: NO_GESTURE });
    },
    [onCommit, state],
  );
  const swap = useCallback(
    (from: number, to: number) => {
      state.set({ doc: onSwap(from, to), live: NO_GESTURE });
    },
    [onSwap, state],
  );

  /** Decide o que o gesto vai mexer, pelo ponto onde começou (pt da tela). */
  const begin = (x: number, y: number, fingers: number) => {
    'worklet';
    const t = track.get();
    if (t.active > 0) {
      track.set({ ...t, active: t.active + 1 });
      return;
    }
    const f = fitSV.get();
    const { doc } = state.get();
    const sel = selSV.get();
    const res = resSV.get();
    const dx = (x - f.x) / f.k;
    const dy = (y - f.y) / f.k;
    const next: Track = { ...IDLE, active: 1, sx: x, sy: y };
    // 1. A alça do canto da camada selecionada (um dedo).
    if (fingers === 1 && sel?.kind === 'layer') {
      const layer = doc.layers.find((l) => l.id === sel.id);
      const box = layer ? layerBox(doc, layer, f.W, f.H, res.textSizes[layer.id] ?? null) : null;
      if (box) {
        const corner = boxCorner({ ...box, w: box.w + 6 / f.k, h: box.h + 6 / f.k });
        if (Math.hypot(f.x + corner.x * f.k - x, f.y + corner.y * f.k - y) <= HANDLE_HIT) {
          track.set({ ...next, target: 'handle', id: sel.id, cx: f.x + box.cx * f.k, cy: f.y + box.cy * f.k });
          return;
        }
      }
    }
    // 2. Uma linha da grade (um dedo, sem camada selecionada).
    if (fingers === 1 && doc.grid && sel?.kind !== 'layer') {
      const m = gridMetrics(doc, f.W, f.H);
      const { dividers } = gridGeometry(doc.grid.root, f.W, f.H, m.gap, m.margin);
      const i = dividerAt(dividers, dx, dy, DIVIDER_HIT / f.k);
      if (i >= 0) {
        track.set({ ...next, target: 'divider', index: i });
        return;
      }
    }
    // 3. Uma camada (com dois dedos, a selecionada vale em qualquer lugar).
    let id = layerAt(doc, f.W, f.H, dx, dy, LAYER_SLACK / f.k, res.textSizes);
    if (fingers > 1 && sel?.kind === 'layer') id = sel.id;
    if (id) {
      track.set({ ...next, target: 'layer', id });
      if (sel?.kind !== 'layer' || sel.id !== id) scheduleOnRN(onSelect, { kind: 'layer', id });
      return;
    }
    // 4. A foto de uma célula.
    if (doc.grid) {
      const m = gridMetrics(doc, f.W, f.H);
      const { cells } = gridGeometry(doc.grid.root, f.W, f.H, m.gap, m.margin);
      const i = cellAt(cells, dx, dy);
      if (i >= 0 && doc.slots[i]) {
        track.set({ ...next, target: 'cell', index: i });
        if (sel?.kind !== 'cell' || sel.index !== i) scheduleOnRN(onSelect, { kind: 'cell', index: i });
        return;
      }
    }
    track.set(next);
  };

  /** Atualiza o desenho com o gesto (com os ímãs). */
  const push = () => {
    'worklet';
    const t = track.get();
    const f = fitSV.get();
    const { doc } = state.get();
    let live: CollageGesture = NO_GESTURE;
    let snapX = false;
    let snapY = false;
    let snapR = false;
    if (t.target === 'layer' || t.target === 'handle') {
      const layer = doc.layers.find((l) => l.id === t.id);
      if (!layer) return;
      const t0 = layer.transform;
      let dx = t.tx / f.k;
      let dy = t.ty / f.k;
      let scale = t.scale;
      let rotation = t.rotation;
      if (t.target === 'handle') {
        dx = 0;
        dy = 0;
        const v0x = t.sx - t.cx;
        const v0y = t.sy - t.cy;
        const v1x = t.sx + t.tx - t.cx;
        const v1y = t.sy + t.ty - t.cy;
        scale = Math.hypot(v1x, v1y) / Math.max(1, Math.hypot(v0x, v0y));
        rotation = ((Math.atan2(v1y, v1x) - Math.atan2(v0y, v0x)) * 180) / Math.PI;
        if (rotation > 180) rotation -= 360;
        if (rotation < -180) rotation += 360;
      } else {
        // Ímã no centro do quadro.
        const cx = f.W / 2 + t0.x * f.W + dx;
        const cy = f.H / 2 + t0.y * f.H + dy;
        if (Math.abs(cx - f.W / 2) < SNAP_PT / f.k) {
          dx = -t0.x * f.W;
          snapX = true;
        }
        if (Math.abs(cy - f.H / 2) < SNAP_PT / f.k) {
          dy = -t0.y * f.H;
          snapY = true;
        }
      }
      // Ímã nos ângulos retos.
      if (rotation !== 0) {
        const total = t0.rotation + rotation;
        const nearest = Math.round(total / 90) * 90;
        if (Math.abs(total - nearest) < SNAP_DEG) {
          rotation = nearest - t0.rotation;
          snapR = true;
        }
      }
      live = { kind: 'layer', id: t.id, dx, dy, scale, rotation };
    } else if (t.target === 'cell') {
      live = { kind: 'cell', cell: t.index, dx: t.tx / f.k, dy: t.ty / f.k, zoom: t.scale };
    } else if (t.target === 'divider' && doc.grid) {
      const m = gridMetrics(doc, f.W, f.H);
      const d = gridGeometry(doc.grid.root, f.W, f.H, m.gap, m.margin).dividers[t.index];
      if (d) live = { kind: 'divider', divider: t.index, delta: (d.dir === 'row' ? t.tx : t.ty) / f.k };
    }
    if ((snapX && !t.snapX) || (snapY && !t.snapY) || (snapR && !t.snapR)) scheduleOnRN(buzz);
    track.set({ ...t, snapX, snapY, snapR });
    guides.set({ x: snapX, y: snapY });
    state.set({ doc, live });
  };

  const finish = () => {
    'worklet';
    const t = track.get();
    const active = Math.max(0, t.active - 1);
    track.set({ ...t, active });
    if (active > 0) return;
    guides.set({ x: false, y: false });
    const { live } = state.get();
    if (live.kind === 'none' || live.kind === 'swap') return;
    scheduleOnRN(commit, live);
  };

  /** Giro dos dois dedos, com zona morta (a pinça sozinha não gira). */
  const gatedRotation = (raw: number) => {
    'worklet';
    const t = track.get();
    if (!t.turned) {
      if (Math.abs(raw) < ROTATION_DEADZONE) return 0;
      track.set({ ...t, turned: true, turnOffset: Math.sign(raw) * ROTATION_DEADZONE });
      return raw - Math.sign(raw) * ROTATION_DEADZONE;
    }
    return raw - t.turnOffset;
  };

  // 6 pt antes de virar arrasto: um toque com o dedo tremendo continua sendo toque.
  const pan = Gesture.Pan()
    .minDistance(6)
    .averageTouches(true)
    .onStart((e) => {
      begin(e.x - e.translationX, e.y - e.translationY, e.numberOfPointers);
    })
    .onUpdate((e) => {
      track.set({ ...track.get(), tx: e.translationX, ty: e.translationY });
      push();
    })
    .onEnd(() => {
      finish();
    });

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      begin(e.focalX, e.focalY, 2);
    })
    .onUpdate((e) => {
      const t = track.get();
      if (t.target === 'handle' || t.target === 'divider') return;
      track.set({ ...t, scale: e.scale });
      push();
    })
    .onEnd(() => {
      finish();
    });

  const rotate = Gesture.Rotation()
    .onStart((e) => {
      begin(e.anchorX, e.anchorY, 2);
    })
    .onUpdate((e) => {
      const t = track.get();
      if (t.target !== 'layer') return;
      const deg = gatedRotation((e.rotation * 180) / Math.PI);
      track.set({ ...track.get(), rotation: deg });
      push();
    })
    .onEnd(() => {
      finish();
    });

  /** Segurar uma foto da grade e arrastar até outra célula troca as duas. */
  const swapGesture = Gesture.Pan()
    .activateAfterLongPress(380)
    .onTouchesDown((e, manager) => {
      const touch = e.allTouches[0];
      const f = fitSV.get();
      const { doc } = state.get();
      if (!touch || e.allTouches.length > 1 || !doc.grid || f.k <= 0) {
        manager.fail();
        return;
      }
      const dx = (touch.x - f.x) / f.k;
      const dy = (touch.y - f.y) / f.k;
      if (layerAt(doc, f.W, f.H, dx, dy, LAYER_SLACK / f.k, resSV.get().textSizes)) {
        manager.fail();
        return;
      }
      const m = gridMetrics(doc, f.W, f.H);
      const i = cellAt(gridGeometry(doc.grid.root, f.W, f.H, m.gap, m.margin).cells, dx, dy);
      if (i < 0 || !doc.slots[i]) manager.fail();
    })
    .onStart((e) => {
      const f = fitSV.get();
      const { doc } = state.get();
      if (!doc.grid) return;
      const x = (e.x - f.x) / f.k;
      const y = (e.y - f.y) / f.k;
      const m = gridMetrics(doc, f.W, f.H);
      const from = cellAt(gridGeometry(doc.grid.root, f.W, f.H, m.gap, m.margin).cells, x, y);
      if (from < 0) return;
      scheduleOnRN(lift);
      state.set({ doc, live: { kind: 'swap', from, x, y, over: from } });
    })
    .onUpdate((e) => {
      const { doc, live } = state.get();
      if (live.kind !== 'swap' || !doc.grid) return;
      const f = fitSV.get();
      const x = (e.x - f.x) / f.k;
      const y = (e.y - f.y) / f.k;
      const m = gridMetrics(doc, f.W, f.H);
      const over = cellAt(gridGeometry(doc.grid.root, f.W, f.H, m.gap, m.margin).cells, x, y);
      if (over !== live.over && over >= 0 && over !== live.from) scheduleOnRN(buzz);
      state.set({ doc, live: { ...live, x, y, over } });
    })
    .onEnd(() => {
      const { doc, live } = state.get();
      if (live.kind !== 'swap') return;
      if (live.over >= 0 && live.over !== live.from) scheduleOnRN(swap, live.from, live.over);
      else state.set({ doc, live: NO_GESTURE });
    });

  const tap = Gesture.Tap()
    .maxDuration(320)
    .onEnd((e, success) => {
      if (!success) return;
      const f = fitSV.get();
      const { doc } = state.get();
      const sel = selSV.get();
      const dx = (e.x - f.x) / f.k;
      const dy = (e.y - f.y) / f.k;
      const id = layerAt(doc, f.W, f.H, dx, dy, LAYER_SLACK / f.k, resSV.get().textSizes);
      if (id) {
        const layer = doc.layers.find((l) => l.id === id);
        if (layer?.kind === 'text' && sel?.kind === 'layer' && sel.id === id) scheduleOnRN(onEditText, id);
        else scheduleOnRN(onSelect, { kind: 'layer', id });
        return;
      }
      if (doc.grid) {
        const m = gridMetrics(doc, f.W, f.H);
        const i = cellAt(gridGeometry(doc.grid.root, f.W, f.H, m.gap, m.margin).cells, dx, dy);
        if (i >= 0) {
          if (doc.slots[i]) scheduleOnRN(onSelect, { kind: 'cell', index: i });
          else scheduleOnRN(onEmptyCell, i);
          return;
        }
      }
      scheduleOnRN(onSelect, null);
    });

  const gesture = Gesture.Race(swapGesture, Gesture.Simultaneous(pan, pinch, rotate), tap);

  const picture = useDerivedValue(() => {
    const { doc, live } = state.get();
    const f = fitSV.get();
    const loadedRes = resSV.get();
    const sel = selSV.get();
    const g = guides.get();
    return createPicture((canvas) => {
      if (f.k <= 0) return;
      const shown = live.kind === 'none' || live.kind === 'swap' ? doc : applyGesture(doc, live, f.W, f.H);
      // Sombra da "folha" sobre o fundo escuro do app.
      const shadow = Skia.Paint();
      shadow.setColor(Skia.Color('#000000'));
      shadow.setAlphaf(0.55);
      shadow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 12, true));
      canvas.drawRect(Skia.XYWHRect(f.x, f.y + 4, f.W * f.k, f.H * f.k), shadow);
      canvas.save();
      canvas.translate(f.x, f.y);
      canvas.scale(f.k, f.k);
      drawCollage(canvas, shown, loadedRes.res, f.W, f.H, { placeholders: true, lifted: live.kind === 'swap' ? live.from : -1 });
      canvas.restore();
      drawOverlay(canvas, shown, loadedRes, f, sel, live, g);
    });
  });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea({ width, height });
  };

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.area} onLayout={onLayout} accessibilityLabel="Colagem. Toque numa foto para editar.">
        <Canvas style={StyleSheet.absoluteFill}>
          <Picture picture={picture} />
        </Canvas>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  area: { flex: 1, backgroundColor: colors.bg },
});
