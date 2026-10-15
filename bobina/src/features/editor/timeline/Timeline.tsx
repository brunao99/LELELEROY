/**
 * Timeline: o tempo rola sob a agulha fixa no centro. Arrastar = mover no tempo;
 * pinça = zoom; tocar = selecionar; alças = cortar; segurar e arrastar = mover
 * (reordenar na faixa principal, trocar de tempo e camada nas outras).
 */
import * as Haptics from 'expo-haptics';
import { AlertTriangle, Plus, Volume2, VolumeX } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, ScrollView as GHScrollView } from 'react-native-gesture-handler';
import Animated, {
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { MIN_CLIP, formatSeconds, formatSpeed } from '@/core/time';
import {
  clipDuration,
  itemDuration,
  layerCount,
  layoutMain,
  projectDuration,
  type MainSlot,
} from '@/core/timeline';
import { findItem, moveItem, moveMainClip, setMuteMain, trimItem, type Edge } from '@/core/ops';
import type { AudioClip, Caption, ItemRef, Keyframe, Micros, OverlayClip, Project, TextItem } from '@/core/types';
import type { PreviewPlayer } from '@/engine/player';
import { useEditor } from '@/state/editor';
import { Txt } from '@/ui/Text';
import { colors, layout, radius, space } from '@/ui/theme';

import { Filmstrip, Waveform } from './Filmstrip';

const AnimatedScrollView = Animated.createAnimatedComponent(GHScrollView);
const SNAP_PX = 10;
const RULER_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

export interface TimelineProps {
  project: Project;
  player: PreviewPlayer;
  onAddMedia: () => void;
  onOpenTransition: (clipId: string) => void;
}

/** Converte µs → px e px → µs. */
const toPx = (us: Micros, pps: number) => (us / 1_000_000) * pps;
const toUs = (px: number, pps: number) => Math.round((px / pps) * 1_000_000);

export function Timeline({ project, player, onAddMedia, onOpenTransition }: TimelineProps) {
  const { width: screenW } = useWindowDimensions();
  const pad = screenW / 2;
  const [pps, setPps] = useState<number>(layout.pxPerSecondDefault);
  const ppsSV = useSharedValue<number>(layout.pxPerSecondDefault);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const apply = useEditor((s) => s.apply);
  const applyGesture = useEditor((s) => s.applyGesture);
  const endGesture = useEditor((s) => s.endGesture);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const unavailableIds = useEditor((s) => s.unavailable);
  const unavailable = useMemo(() => new Set(unavailableIds), [unavailableIds]);

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const userScroll = useSharedValue(false);
  const total = projectDuration(project);
  const contentW = pad * 2 + toPx(total, pps);

  // Tocando (ou buscando por outro lugar): a timeline acompanha o tempo.
  useAnimatedReaction(
    () => player.time.get(),
    (t, prev) => {
      if (userScroll.get() || t === prev) return;
      scrollTo(scrollRef, t * ppsSV.get(), 0, false);
    },
  );

  const seekFromScroll = useCallback((seconds: number) => player.seek(seconds), [player]);
  const settle = useCallback(() => setPlayhead(Math.round(player.time.get() * 1_000_000)), [player, setPlayhead]);

  const onScroll = useAnimatedScrollHandler({
    onBeginDrag: () => {
      userScroll.set(true);
      if (player.playing.get()) scheduleOnRN(player.pause);
    },
    onScroll: (e) => {
      if (!userScroll.get()) return;
      scheduleOnRN(seekFromScroll, e.contentOffset.x / ppsSV.get());
    },
    onEndDrag: (e) => {
      if (Math.abs(e.velocity?.x ?? 0) < 0.05) {
        userScroll.set(false);
        scheduleOnRN(settle);
      }
    },
    onMomentumEnd: () => {
      userScroll.set(false);
      scheduleOnRN(settle);
    },
  });

  // Zoom com pinça mantendo o instante da agulha no centro.
  const pinchStart = useSharedValue<number>(layout.pxPerSecondDefault);
  const pinch = Gesture.Pinch()
    .onStart(() => {
      pinchStart.set(ppsSV.get());
    })
    .onUpdate((e) => {
      const next = Math.min(layout.pxPerSecondMax, Math.max(layout.pxPerSecondMin, pinchStart.get() * e.scale));
      ppsSV.set(next);
      scheduleOnRN(setPps, next);
    });

  useEffect(() => {
    const t = player.time.get();
    requestAnimationFrame(() => {
      (scrollRef.current as unknown as { scrollTo?: (o: { x: number; animated: boolean }) => void } | null)?.scrollTo?.({
        x: t * pps,
        animated: false,
      });
    });
  }, [pps, player.time, scrollRef]);

  const slots = useMemo(() => layoutMain(project), [project]);
  const overlayLayers = layerCount(project.overlays);
  const textLayers = layerCount(project.texts);
  const audioLayers = layerCount(project.audios);
  const hasCaptions = project.captions.items.length > 0;

  const playheadUs = () => Math.round(player.time.get() * 1_000_000);

  const ctx: RowContext = {
    project,
    pps,
    pad,
    selection,
    select: (ref) => {
      player.pause();
      select(ref);
    },
    applyGesture,
    endGesture,
    playheadUs,
    unavailable,
  };

  return (
    <View style={styles.root}>
      <GestureDetector gesture={pinch}>
        <View style={{ flex: 1 }}>
          <GHScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: space[2] }} showsVerticalScrollIndicator={false}>
            <AnimatedScrollView
              ref={scrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              onScroll={onScroll}
              scrollEventThrottle={16}
              decelerationRate="fast"
              contentContainerStyle={{ width: contentW }}
            >
              <View style={{ width: contentW }}>
                <Ruler pad={pad} pps={pps} total={total} />
                <MainRow
                  ctx={ctx}
                  slots={slots}
                  onAddMedia={onAddMedia}
                  onOpenTransition={onOpenTransition}
                  onToggleMute={() => apply((p) => setMuteMain(p, !p.muteMain))}
                />
                {Array.from({ length: overlayLayers }, (_, layer) => (
                  <ItemRow key={`o${layer}`} ctx={ctx} kind="overlay" items={project.overlays.filter((o) => o.layer === layer)} />
                ))}
                {Array.from({ length: textLayers }, (_, layer) => (
                  <ItemRow key={`t${layer}`} ctx={ctx} kind="text" items={project.texts.filter((o) => o.layer === layer)} />
                ))}
                {hasCaptions ? <ItemRow ctx={ctx} kind="caption" items={project.captions.items} /> : null}
                {Array.from({ length: audioLayers }, (_, layer) => (
                  <ItemRow key={`a${layer}`} ctx={ctx} kind="audio" items={project.audios.filter((o) => o.layer === layer)} />
                ))}
              </View>
            </AnimatedScrollView>
          </GHScrollView>
          <View pointerEvents="none" style={[styles.playhead, { left: pad - layout.playheadWidth / 2 }]} />
        </View>
      </GestureDetector>
    </View>
  );
}

// ---------------------------------------------------------------- régua

const Ruler = memo(function Ruler({ pad, pps, total }: { pad: number; pps: number; total: Micros }) {
  const step = RULER_STEPS.find((s) => s * pps >= 64) ?? 300;
  const seconds = total / 1_000_000;
  const ticks: number[] = [];
  for (let s = 0; s <= seconds + step; s += step) ticks.push(s);
  const label = (s: number) => {
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return `${String(m).padStart(2, '0')}:${String(Math.floor(r)).padStart(2, '0')}${step < 1 ? `.${Math.round((r % 1) * 10)}` : ''}`;
  };
  return (
    <View style={{ height: layout.ruler }} pointerEvents="none">
      {ticks.map((s) => (
        <View key={s} style={[styles.tick, { left: pad + s * pps }]}>
          <View style={styles.tickLine} />
          <Txt variant="xs" tone="faint" tabular style={{ fontSize: 10 }}>
            {label(s)}
          </Txt>
        </View>
      ))}
    </View>
  );
});

// ---------------------------------------------------------------- linhas

interface RowContext {
  project: Project;
  pps: number;
  pad: number;
  selection: ItemRef | null;
  select: (ref: ItemRef | null) => void;
  applyGesture: ReturnType<typeof useEditor.getState>['applyGesture'];
  endGesture: () => void;
  playheadUs: () => Micros;
  /** Mídias que faltam no disco: os clipes delas aparecem marcados. */
  unavailable: ReadonlySet<string>;
}

/** Ímã: aproxima `t` do alvo mais perto se estiver a menos de SNAP_PX. */
function snap(t: Micros, targets: Micros[], pps: number): { t: Micros; snapped: boolean } {
  let best = t;
  let bestPx = SNAP_PX;
  for (const target of targets) {
    const px = Math.abs(toPx(target - t, pps));
    if (px < bestPx) {
      best = target;
      bestPx = px;
    }
  }
  return { t: best, snapped: best !== t };
}

/** Pontos de encaixe: agulha, começo, cortes da faixa principal e pontas dos outros itens. */
function snapTargets(project: Project, playhead: Micros, ignoreId: string): Micros[] {
  const targets: Micros[] = [0, playhead];
  for (const slot of layoutMain(project)) targets.push(slot.start, slot.end);
  for (const list of [project.overlays, project.texts, project.audios] as (OverlayClip | TextItem | AudioClip)[][]) {
    for (const it of list) {
      if (it.id === ignoreId) continue;
      targets.push(it.start, it.start + itemDuration(it));
    }
  }
  return targets;
}

/** Começo e fim de um item no projeto (para medir o gesto a partir do estado inicial). */
function rangeOf(project: Project, id: string): { start: Micros; end: Micros; layer: number } | null {
  const found = findItem(project, id);
  if (!found) return null;
  if (found.kind === 'main') {
    const slot = layoutMain(project).find((s) => s.clip.id === id);
    return slot ? { start: slot.start, end: slot.end, layer: 0 } : null;
  }
  if (found.kind === 'caption') {
    const c = found.item as Caption;
    return { start: c.start, end: c.end, layer: 0 };
  }
  const it = found.item as OverlayClip | TextItem | AudioClip;
  return { start: it.start, end: it.start + itemDuration(it), layer: it.layer };
}

/** Vibra ao encaixar (uma vez por encaixe). Só existe um arrasto por vez. */
let lastSnapped = false;
function snapHaptic(snapped: boolean) {
  if (snapped && !lastSnapped) Haptics.selectionAsync().catch(() => {});
  lastSnapped = snapped;
}

/** Alça de corte numa das pontas do item selecionado. */
function TrimHandle({ ctx, id, edge, height }: { ctx: RowContext; id: string; edge: Edge; height: number }) {
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(1)
    .hitSlop({ horizontal: 10, vertical: 6 })
    .onUpdate((e) => {
      ctx.applyGesture(`trim:${id}:${edge}`, (base) => {
        // A ponta como estava no começo do gesto: o deslocamento é medido a partir dela.
        const range = rangeOf(base, id);
        if (!range) return base;
        const from = edge === 'start' ? range.start : range.end;
        const wanted = from + toUs(e.translationX, ctx.pps);
        const targets = snapTargets(base, ctx.playheadUs(), id).filter((t) => t !== from);
        const snapped = snap(wanted, targets, ctx.pps);
        snapHaptic(snapped.snapped);
        return trimItem(base, id, edge, snapped.t - from);
      });
    })
    .onEnd(() => ctx.endGesture());
  return (
    <GestureDetector gesture={pan}>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={edge === 'start' ? 'Cortar o começo' : 'Cortar o fim'}
        style={[
          styles.handle,
          { height, [edge === 'start' ? 'left' : 'right']: -layout.handleWidth, borderTopLeftRadius: edge === 'start' ? radius.sm : 0, borderBottomLeftRadius: edge === 'start' ? radius.sm : 0, borderTopRightRadius: edge === 'end' ? radius.sm : 0, borderBottomRightRadius: edge === 'end' ? radius.sm : 0 },
        ]}
      >
        <View style={styles.handleGrip} />
      </View>
    </GestureDetector>
  );
}

// ---------------------------------------------------------------- faixa principal

const MainRow = memo(function MainRow({
  ctx,
  slots,
  onAddMedia,
  onOpenTransition,
  onToggleMute,
}: {
  ctx: RowContext;
  slots: MainSlot[];
  onAddMedia: () => void;
  onOpenTransition: (clipId: string) => void;
  onToggleMute: () => void;
}) {
  const { project, pps, pad } = ctx;
  const height = layout.trackMain;
  const end = slots.length ? slots[slots.length - 1]!.end : 0;
  return (
    <View style={{ height, marginBottom: layout.trackGap }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={project.muteMain ? 'Ativar o som dos clipes' : 'Silenciar o som dos clipes'}
        onPress={onToggleMute}
        style={[styles.mute, { left: pad - 64 - space[3] }]}
      >
        {project.muteMain ? <VolumeX size={18} color={colors.textMuted} /> : <Volume2 size={18} color={colors.textMuted} />}
        <Txt variant="xs" tone="muted">
          {project.muteMain ? 'Mudo' : 'Som'}
        </Txt>
      </Pressable>
      {slots.map((slot) => (
        <MainClipView key={slot.clip.id} ctx={ctx} slot={slot} slots={slots} />
      ))}
      {slots.slice(0, -1).map((slot) => (
        <Pressable
          key={`tr-${slot.clip.id}`}
          accessibilityRole="button"
          accessibilityLabel={slot.transitionOut ? `Transição: ${slot.transitionOut.kind}` : 'Adicionar transição'}
          onPress={() => onOpenTransition(slot.clip.id)}
          hitSlop={10}
          style={[
            styles.transition,
            { left: pad + toPx(slot.coreEnd, pps) - 11, top: height / 2 - 11 },
            slot.transitionOut ? { backgroundColor: colors.accent } : null,
          ]}
        >
          <View style={[styles.transitionMark, { backgroundColor: slot.transitionOut ? colors.onAccent : colors.onTrack }]} />
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Adicionar vídeos ou fotos"
        onPress={onAddMedia}
        style={[styles.add, { left: pad + toPx(end, pps) + space[3], height: height - 8, top: 4 }]}
      >
        <Plus size={22} color={colors.onAccent} />
      </Pressable>
    </View>
  );
});

function MainClipView({ ctx, slot, slots }: { ctx: RowContext; slot: MainSlot; slots: MainSlot[] }) {
  const { project, pps, pad, selection } = ctx;
  const clip = slot.clip;
  const asset = project.assets[clip.assetId];
  const selected = selection?.kind === 'main' && selection.id === clip.id;
  const lost = ctx.unavailable.has(clip.assetId);
  const visibleEnd = slot.index === slots.length - 1 ? slot.end : slot.coreEnd;
  const left = pad + toPx(slot.start, pps);
  const width = Math.max(4, toPx(visibleEnd - slot.start, pps) - 2);
  const height = layout.trackMain;
  const [dragging, setDragging] = useState(false);

  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd(() => ctx.select(selected ? null : { kind: 'main', id: clip.id }));
  const drag = Gesture.Pan()
    .runOnJS(true)
    .activateAfterLongPress(300)
    .onStart(() => {
      setDragging(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    })
    .onUpdate((e) => {
      ctx.applyGesture(`reorder:${clip.id}`, (base) => {
        const baseSlots = layoutMain(base);
        const me = baseSlots.find((s) => s.clip.id === clip.id);
        if (!me) return base;
        const center = toPx((me.start + me.end) / 2, pps) + e.translationX;
        let target = me.index;
        let bestDist = Number.POSITIVE_INFINITY;
        for (const s of baseSlots) {
          const d = Math.abs(toPx((s.start + s.end) / 2, pps) - center);
          if (d < bestDist) {
            bestDist = d;
            target = s.index;
          }
        }
        return moveMainClip(base, clip.id, target);
      });
    })
    .onFinalize(() => {
      setDragging(false);
      ctx.endGesture();
    });

  return (
    <GestureDetector gesture={Gesture.Exclusive(drag, tap)}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`Clipe ${slot.index + 1}, ${formatSeconds(slot.duration)}${clip.speed !== 1 ? `, velocidade ${formatSpeed(clip.speed)}` : ''}${clip.reverse ? ', de trás para frente' : ''}${lost ? ', mídia ausente' : ''}`}
        accessibilityState={{ selected }}
        style={[
          styles.clip,
          { left, width, height, zIndex: selected || dragging ? 2 : 1 },
          selected ? styles.clipSelected : null,
          dragging ? { opacity: 0.8, transform: [{ scale: 1.04 }] } : null,
        ]}
      >
        {asset && !lost ? (
          <Filmstrip
            projectId={project.id}
            asset={asset}
            sourceIn={clip.sourceIn}
            sourceOut={clip.sourceOut}
            speed={clip.speed}
            reverse={!!clip.reverse}
            width={width}
            height={height}
            pps={pps}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.lost]}>
            <AlertTriangle size={18} color={colors.danger} />
          </View>
        )}
        {clip.speed !== 1 || clip.reverse ? (
          <View style={styles.badge}>
            <Txt variant="xs" weight="700" style={{ color: colors.onAccent, fontSize: 10 }}>
              {[clip.reverse ? '◀' : '', clip.speed !== 1 ? formatSpeed(clip.speed) : ''].filter(Boolean).join(' ')}
            </Txt>
          </View>
        ) : null}
        {clip.keyframes ? <KeyframeMarks keyframes={clip.keyframes} pps={pps} height={height} /> : null}
        {selected ? (
          <>
            <TrimHandle ctx={ctx} id={clip.id} edge="start" height={height} />
            <TrimHandle ctx={ctx} id={clip.id} edge="end" height={height} />
          </>
        ) : null}
      </View>
    </GestureDetector>
  );
}

/** Losangos nos instantes dos keyframes de um item. */
function KeyframeMarks({ keyframes, pps, height }: { keyframes: Keyframe[]; pps: number; height: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {keyframes.map((k) => (
        <View key={k.at} style={[styles.keyframe, { left: toPx(k.at, pps) - 5, top: height / 2 - 5 }]} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- faixas soltas

type RowKind = 'overlay' | 'text' | 'caption' | 'audio';
type RowItem = OverlayClip | TextItem | Caption | AudioClip;

const ROW_COLOR: Record<RowKind, string> = {
  overlay: colors.trackOverlay,
  text: colors.trackText,
  caption: colors.trackCaption,
  audio: colors.trackAudio,
};

function itemRange(kind: RowKind, item: RowItem): { start: Micros; end: Micros } {
  if (kind === 'caption') {
    const c = item as Caption;
    return { start: c.start, end: c.end };
  }
  const it = item as OverlayClip | TextItem | AudioClip;
  return { start: it.start, end: it.start + (it.kind === 'text' ? it.duration : clipDuration(it)) };
}

function itemLabel(kind: RowKind, item: RowItem, project: Project): string {
  if (kind === 'text') return (item as TextItem).text || 'Texto';
  if (kind === 'caption') return (item as Caption).text;
  if (kind === 'audio') return (item as AudioClip).name;
  const asset = project.assets[(item as OverlayClip).assetId];
  return asset?.kind === 'image' ? 'Foto' : 'Vídeo';
}

const ItemRow = memo(function ItemRow({ ctx, kind, items }: { ctx: RowContext; kind: RowKind; items: RowItem[] }) {
  return (
    <View style={{ height: layout.trackSecondary, marginBottom: layout.trackGap }}>
      {items.map((item) => (
        <ItemView key={item.id} ctx={ctx} kind={kind} item={item} />
      ))}
    </View>
  );
});

function ItemView({ ctx, kind, item }: { ctx: RowContext; kind: RowKind; item: RowItem }) {
  const { project, pps, pad, selection } = ctx;
  const { start, end } = itemRange(kind, item);
  const selected = selection?.kind === kind && selection.id === item.id;
  const left = pad + toPx(start, pps);
  const width = Math.max(4, toPx(end - start, pps) - 1);
  const height = layout.trackSecondary;
  const color = ROW_COLOR[kind];
  const [dragging, setDragging] = useState(false);
  const rowStep = layout.trackSecondary + layout.trackGap;

  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd(() => ctx.select(selected ? null : { kind, id: item.id }));
  const drag = Gesture.Pan()
    .runOnJS(true)
    .activateAfterLongPress(300)
    .onStart(() => {
      setDragging(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    })
    .onUpdate((e) => {
      ctx.applyGesture(`move:${item.id}`, (base) => {
        const origin = rangeOf(base, item.id);
        if (!origin) return base;
        const wanted = origin.start + toUs(e.translationX, pps);
        const duration = origin.end - origin.start;
        const targets = snapTargets(base, ctx.playheadUs(), item.id);
        const a = snap(wanted, targets, pps);
        const b = snap(wanted + duration, targets, pps);
        const newStart = a.snapped ? a.t : b.snapped ? b.t - duration : wanted;
        snapHaptic(a.snapped || b.snapped);
        const layer = kind === 'caption' ? undefined : Math.max(0, origin.layer + Math.round(e.translationY / rowStep));
        return moveItem(base, item.id, Math.max(0, newStart), layer);
      });
    })
    .onFinalize(() => {
      setDragging(false);
      ctx.endGesture();
    });

  const audio = kind === 'audio' ? (item as AudioClip) : null;
  const audioAsset = audio ? project.assets[audio.assetId] : undefined;
  const lost = (kind === 'audio' || kind === 'overlay') && ctx.unavailable.has((item as AudioClip | OverlayClip).assetId);

  return (
    <GestureDetector gesture={Gesture.Exclusive(drag, tap)}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${kind === 'text' ? 'Texto' : kind === 'caption' ? 'Legenda' : kind === 'audio' ? 'Áudio' : 'Sobreposição'}: ${itemLabel(kind, item, project)}, ${formatSeconds(end - start)}${lost ? ', mídia ausente' : ''}`}
        accessibilityState={{ selected }}
        style={[
          styles.item,
          { left, width, height, backgroundColor: kind === 'audio' ? `${color}55` : color, zIndex: selected || dragging ? 2 : 1 },
          lost ? styles.lost : null,
          selected ? styles.clipSelected : null,
          dragging ? { opacity: 0.85 } : null,
        ]}
      >
        {audio && audioAsset && !lost ? (
          <Waveform projectId={project.id} asset={audioAsset} sourceIn={audio.sourceIn} sourceOut={audio.sourceOut} width={width} height={height} color={color} />
        ) : null}
        <Txt variant="xs" weight="600" numberOfLines={1} style={{ color: kind === 'audio' || lost ? colors.text : colors.onTrack, paddingHorizontal: 6 }}>
          {lost ? 'Mídia ausente' : itemLabel(kind, item, project)}
        </Txt>
        {(kind === 'overlay' || kind === 'text') && (item as OverlayClip | TextItem).keyframes ? (
          <KeyframeMarks keyframes={(item as OverlayClip | TextItem).keyframes!} pps={pps} height={height} />
        ) : null}
        {selected ? (
          <>
            <TrimHandle ctx={ctx} id={item.id} edge="start" height={height} />
            <TrimHandle ctx={ctx} id={item.id} edge="end" height={height} />
          </>
        ) : null}
      </View>
    </GestureDetector>
  );
}

export const TIMELINE_MIN_CLIP = MIN_CLIP;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  keyframe: {
    position: 'absolute',
    width: 10,
    height: 10,
    backgroundColor: colors.text,
    borderWidth: 1.5,
    borderColor: colors.onTrack,
    transform: [{ rotate: '45deg' }],
  },
  playhead: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: layout.playheadWidth,
    backgroundColor: colors.playhead,
    borderRadius: 1,
  },
  tick: { position: 'absolute', top: 0, alignItems: 'flex-start' },
  tickLine: { width: 1, height: 6, backgroundColor: colors.textFaint, marginBottom: 1 },
  clip: {
    position: 'absolute',
    top: 0,
    borderRadius: radius.sm,
    overflow: 'visible',
    backgroundColor: colors.surfaceRaised,
  },
  clipSelected: { borderWidth: 2, borderColor: colors.accent },
  lost: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.danger,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  item: {
    position: 'absolute',
    top: 0,
    borderRadius: radius.sm,
    justifyContent: 'center',
    overflow: 'visible',
  },
  handle: {
    position: 'absolute',
    top: 0,
    width: layout.handleWidth,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleGrip: { width: 3, height: 14, borderRadius: 2, backgroundColor: colors.onAccent },
  badge: {
    position: 'absolute',
    left: 4,
    top: 4,
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 4,
  },
  transition: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 4,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  transitionMark: { width: 10, height: 2, borderRadius: 1 },
  add: {
    position: 'absolute',
    width: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mute: {
    position: 'absolute',
    top: 4,
    width: 64,
    height: layout.trackMain - 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
});
