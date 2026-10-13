/**
 * Preview: o quadro desenhado pelo motor numa tela Skia, a caixa do item
 * selecionado e os gestos para mover, escalar e girar (texto, sobreposição,
 * clipe). Tocar no vídeo toca/pausa; tocar num texto seleciona.
 */
import { Canvas, Image } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { fitInside } from '@/core/geometry';
import { findItem, updateTransform } from '@/core/ops';
import type { RenderPlan } from '@/core/renderPlan';
import { clipBox, rotatedSize } from '@/core/renderPlan';
import type { MainClip, OverlayClip, Project, TextItem, Transform } from '@/core/types';
import type { DrawResources } from '@/engine/draw';
import type { PreviewPlayer } from '@/engine/player';
import { useEditor } from '@/state/editor';
import { BusyBanner } from '@/ui/Feedback';
import { colors } from '@/ui/theme';

interface Box {
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
}

/** Caixa do item (em pontos do preview), ou null se ele não tem caixa. */
function selectionBox(project: Project, plan: RenderPlan, res: DrawResources | null, id: string, scale: number): Box | null {
  const found = findItem(project, id);
  if (!found) return null;
  const W = plan.width;
  const H = plan.height;
  if (found.kind === 'text') {
    const text = found.item as TextItem;
    const parts = res?.texts[id];
    if (!parts) return null;
    const pad = text.style.background ? parts.padding : 0;
    return {
      cx: (W / 2 + text.transform.x * W) * scale,
      cy: (H / 2 + text.transform.y * H) * scale,
      width: (parts.width + pad * 2) * text.transform.scale * scale,
      height: (parts.height + pad * 2) * text.transform.scale * scale,
      rotation: text.transform.rotation,
    };
  }
  if (found.kind === 'main' || found.kind === 'overlay') {
    const clip = found.item as MainClip | OverlayClip;
    const asset = project.assets[clip.assetId];
    if (!asset || asset.kind === 'audio') return null;
    const disp = rotatedSize(asset.width, asset.height, asset.rotation);
    const box = clipBox(W, H, disp.width * clip.crop.w, disp.height * clip.crop.h, clip.transform);
    return { cx: box.cx * scale, cy: box.cy * scale, width: box.width * scale, height: box.height * scale, rotation: box.rotation };
  }
  return null;
}

/** Texto sob o dedo (de cima para baixo na ordem de desenho). */
function hitText(project: Project, plan: RenderPlan, res: DrawResources | null, t: number, x: number, y: number, scale: number): string | null {
  const texts = [...plan.texts].reverse();
  for (const text of texts) {
    if (t < text.start || t >= text.end) continue;
    const box = selectionBox(project, plan, res, text.id, scale);
    if (!box) continue;
    const a = (-box.rotation * Math.PI) / 180;
    const dx = x - box.cx;
    const dy = y - box.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= box.width / 2 + 12 && Math.abs(ly) <= box.height / 2 + 12) return text.id;
  }
  return null;
}

export interface PreviewProps {
  project: Project;
  plan: RenderPlan;
  resources: DrawResources | null;
  player: PreviewPlayer;
  onSize: (size: { width: number; height: number }) => void;
  size: { width: number; height: number };
}

const SNAP = 0.015;

/** Estado do gesto de transformação em andamento (só um por vez). */
const live = { dx: 0, dy: 0, scale: 1, rotation: 0, snapped: false, centerX: false, centerY: false, active: 0 };

function liveBegin() {
  if (live.active === 0) {
    Object.assign(live, { dx: 0, dy: 0, scale: 1, rotation: 0, snapped: false, centerX: false, centerY: false });
  }
  live.active += 1;
}

/** Devolve true quando o último dos gestos simultâneos terminou. */
function liveFinish(): boolean {
  live.active = Math.max(0, live.active - 1);
  return live.active === 0;
}

function liveSet(patch: Partial<Pick<typeof live, 'dx' | 'dy' | 'scale' | 'rotation'>>) {
  Object.assign(live, patch);
}

/** Avisa (vibração) só na hora em que encaixa e guarda em que eixo está no centro. */
function liveSnap(centerX: boolean, centerY: boolean) {
  const snapped = centerX || centerY;
  if (snapped && !live.snapped) Haptics.selectionAsync().catch(() => {});
  Object.assign(live, { snapped, centerX, centerY });
}

interface Guides {
  vertical: boolean;
  horizontal: boolean;
}

export function Preview({ project, plan, resources, player, onSize, size }: PreviewProps) {
  const selection = useEditor((s) => s.selection);
  const busy = useEditor((s) => s.busy);
  const applyGesture = useEditor((s) => s.applyGesture);
  const select = useEditor((s) => s.select);
  const endGesture = useEditor((s) => s.endGesture);
  const [area, setArea] = useState({ width: 0, height: 0 });
  // Linhas de centro enquanto o item arrastado está encaixado no meio.
  const [guides, setGuides] = useState<Guides | null>(null);

  const aspect = plan.width / plan.height;
  const fit = area.width > 0 ? fitInside(aspect, area) : { width: 0, height: 0 };
  const scale = fit.width / plan.width;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea({ width, height });
    const next = fitInside(aspect, { width, height });
    if (Math.abs(next.width - size.width) > 1 || Math.abs(next.height - size.height) > 1) onSize(next);
  };

  const selectedId = selection && (selection.kind === 'text' || selection.kind === 'overlay' || selection.kind === 'main') ? selection.id : null;
  const box = useMemo(
    () => (selectedId ? selectionBox(project, plan, resources, selectedId, scale) : null),
    [project, plan, resources, selectedId, scale],
  );

  // Arrastar, pinça e girar podem acontecer juntos: cada um atualiza a sua parte
  // e o total é aplicado sobre o transform do começo do gesto.
  const pushTransform = () => {
    if (!selectedId) return;
    const id = selectedId;
    applyGesture(`transform:${id}`, (base) => {
      const found = findItem(base, id);
      if (!found) return base;
      const t0 = (found.item as TextItem | MainClip | OverlayClip).transform;
      const next: Transform = {
        x: t0.x + live.dx,
        y: t0.y + live.dy,
        scale: Math.min(8, Math.max(0.05, t0.scale * live.scale)),
        rotation: t0.rotation + live.rotation,
      };
      // Ímã no centro, com uma vibração leve ao encaixar.
      if (Math.abs(next.x) < SNAP) next.x = 0;
      if (Math.abs(next.y) < SNAP) next.y = 0;
      liveSnap(next.x === 0, next.y === 0);
      return updateTransform(base, id, next);
    });
    const vertical = live.centerX;
    const horizontal = live.centerY;
    setGuides((g) =>
      !vertical && !horizontal ? null : g && g.vertical === vertical && g.horizontal === horizontal ? g : { vertical, horizontal },
    );
  };
  const begin = liveBegin;
  const finish = () => {
    if (liveFinish()) {
      setGuides(null);
      endGesture();
    }
  };

  const pan = Gesture.Pan()
    .runOnJS(true)
    .enabled(!!selectedId)
    .minDistance(4)
    .onStart(begin)
    .onUpdate((e) => {
      liveSet({ dx: e.translationX / Math.max(1, fit.width), dy: e.translationY / Math.max(1, fit.height) });
      pushTransform();
    })
    .onEnd(finish);
  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .enabled(!!selectedId)
    .onStart(begin)
    .onUpdate((e) => {
      liveSet({ scale: e.scale });
      pushTransform();
    })
    .onEnd(finish);
  const rotate = Gesture.Rotation()
    .runOnJS(true)
    .enabled(!!selectedId)
    .onStart(begin)
    .onUpdate((e) => {
      liveSet({ rotation: (e.rotation * 180) / Math.PI });
      pushTransform();
    })
    .onEnd(finish);
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => {
      const t = Math.round(player.time.get() * 1_000_000);
      const hit = hitText(project, plan, resources, t, e.x - (area.width - fit.width) / 2, e.y - (area.height - fit.height) / 2, scale);
      if (hit) {
        player.pause();
        select({ kind: 'text', id: hit });
      } else if (selectedId) {
        select(null);
      } else {
        player.toggle();
      }
    });

  const gesture = Gesture.Race(Gesture.Simultaneous(pan, pinch, rotate), tap);

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.area} onLayout={onLayout} accessibilityLabel="Prévia do vídeo. Toque para tocar ou pausar.">
        {fit.width > 0 ? (
          <View style={{ width: fit.width, height: fit.height }}>
            <Canvas style={{ width: fit.width, height: fit.height }}>
              <Image image={player.frame} x={0} y={0} width={fit.width} height={fit.height} fit="fill" />
            </Canvas>
            {guides?.vertical ? <View pointerEvents="none" style={[styles.guideV, { left: fit.width / 2 - 0.5 }]} /> : null}
            {guides?.horizontal ? <View pointerEvents="none" style={[styles.guideH, { top: fit.height / 2 - 0.5 }]} /> : null}
            {box ? (
              <View
                pointerEvents="none"
                style={[
                  styles.box,
                  {
                    left: box.cx - box.width / 2,
                    top: box.cy - box.height / 2,
                    width: box.width,
                    height: box.height,
                    transform: [{ rotate: `${box.rotation}deg` }],
                  },
                ]}
              />
            ) : null}
          </View>
        ) : null}
        {busy ? <BusyBanner label={busy.label} fraction={busy.fraction} /> : null}
        {player.busy && !busy ? <View style={styles.loading} pointerEvents="none" /> : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  area: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  box: { position: 'absolute', borderWidth: 1.5, borderColor: colors.accent, borderRadius: 2 },
  guideV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.accent, opacity: 0.8 },
  guideH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: colors.accent, opacity: 0.8 },
  loading: { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
});
