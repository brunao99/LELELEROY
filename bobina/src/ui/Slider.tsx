/**
 * Barra deslizante. O gesto roda na thread de UI e foi feito para dedo:
 * - arrasto relativo: pegar a bolinha não dá salto; tocar na barra leva o valor até ali;
 * - começa a responder com 3 pt de movimento na horizontal e cede para a rolagem do
 *   painel se o dedo for mais na vertical (não muda valor sem querer);
 * - precisão fina: com o dedo afastado da barra, o valor anda mais devagar;
 * - ímã com vibração leve no valor padrão; toque duplo volta a ele;
 * - o valor vai para o projeto no máximo ~30 vezes por segundo (o preview não engasga)
 *   e uma última vez ao soltar.
 */
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Txt } from './Text';
import { colors, space } from './theme';

export type SliderScale = 'linear' | 'log';

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Valor do toque duplo (e o centro do preenchimento nos sliders centrados). */
  defaultValue?: number;
  step?: number;
  scale?: SliderScale;
  /** Preenche a partir do valor padrão (ajustes −100..100). */
  centered?: boolean;
  format?: (value: number) => string;
  /** Chamado durante o arrasto (com limite de frequência). */
  onChange: (value: number) => void;
  /** Chamado ao soltar. */
  onCommit?: (value: number) => void;
  disabled?: boolean;
}

const THUMB = 24;
const TRACK_HEIGHT = 44;
/** Intervalo mínimo entre envios do valor durante o arrasto (ms). */
const EMIT_INTERVAL = 33;
/** Largura do ímã do valor padrão, em fração da barra. */
const MAGNET = 0.015;

export function toFraction(value: number, min: number, max: number, scale: SliderScale): number {
  'worklet';
  if (max === min) return 0;
  if (scale === 'log') return (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min));
  return (value - min) / (max - min);
}

export function fromFraction(f: number, min: number, max: number, scale: SliderScale, step: number): number {
  'worklet';
  const k = Math.min(1, Math.max(0, f));
  const raw = scale === 'log' ? Math.exp(Math.log(min) + k * (Math.log(max) - Math.log(min))) : min + k * (max - min);
  if (step <= 0) return raw;
  return Math.min(max, Math.max(min, Math.round(raw / step) * step));
}

/**
 * Quanto do movimento do dedo vira movimento do valor: perto da barra, 1:1;
 * afastando o dedo na vertical, cada vez mais fino (ajuste de precisão).
 */
export function precisionFactor(distanceFromTrack: number): number {
  'worklet';
  if (distanceFromTrack < 48) return 1;
  if (distanceFromTrack < 110) return 0.4;
  return 0.15;
}

/** Aplica o ímã: perto do valor padrão, fica nele. */
export function magnetize(f: number, center: number | null): number {
  'worklet';
  if (center === null) return f;
  return Math.abs(f - center) < MAGNET ? center : f;
}

/** Relógio para o limite de envios (roda no gesto, na thread de UI). */
function clock(): number {
  'worklet';
  return Date.now();
}

function tick() {
  Haptics.selectionAsync().catch(() => {});
}

export function Slider({
  label,
  value,
  min,
  max,
  defaultValue,
  step = 0,
  scale = 'linear',
  centered,
  format = (v) => String(Math.round(v)),
  onChange,
  onCommit,
  disabled,
}: SliderProps) {
  const width = useSharedValue(0);
  const fraction = useSharedValue(toFraction(value, min, max, scale));
  // Posição "crua" do dedo (sem ímã nem limites), para o ímã não prender o arrasto.
  const raw = useSharedValue(0);
  const dragging = useSharedValue(false);
  const pressed = useSharedValue(0);
  const lastEmit = useSharedValue(0);
  const snapped = useSharedValue(false);
  // Durante o arrasto mostra o valor do dedo; parado, o valor que veio de fora.
  const [dragValue, setDragValue] = useState<number | null>(null);
  const shown = dragValue ?? value;

  useEffect(() => {
    if (!dragging.get()) fraction.set(toFraction(value, min, max, scale));
  }, [value, min, max, scale, fraction, dragging]);

  const emit = useCallback(
    (v: number, done: boolean) => {
      setDragValue(done ? null : v);
      onChange(v);
      if (done) onCommit?.(v);
    },
    [onChange, onCommit],
  );

  const hasDefault = defaultValue !== undefined;
  const center = toFraction(defaultValue ?? min, min, max, scale);
  const magnetCenter = hasDefault ? center : null;

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .activeOffsetX([-3, 3])
    .failOffsetY([-12, 12])
    .onStart(() => {
      dragging.set(true);
      raw.set(fraction.get());
      snapped.set(magnetCenter !== null && fraction.get() === magnetCenter);
      lastEmit.set(0);
      pressed.set(withTiming(1, { duration: 90 }));
    })
    .onChange((e) => {
      const usable = width.get() - THUMB;
      if (usable <= 0) return;
      const factor = precisionFactor(Math.abs(e.y - TRACK_HEIGHT / 2));
      const before = raw.get();
      const next = before + (e.changeX * factor) / usable;
      raw.set(Math.min(1.05, Math.max(-0.05, next)));
      const clamped = Math.min(1, Math.max(0, raw.get()));
      const f = magnetize(clamped, magnetCenter);
      // Vibração leve ao encaixar no padrão e ao chegar nas pontas.
      const atCenter = magnetCenter !== null && f === magnetCenter;
      if (atCenter && !snapped.get()) scheduleOnRN(tick);
      snapped.set(atCenter);
      if ((before > 0 && next <= 0) || (before < 1 && next >= 1)) scheduleOnRN(tick);
      fraction.set(f);
      const now = clock();
      if (now - lastEmit.get() >= EMIT_INTERVAL) {
        lastEmit.set(now);
        scheduleOnRN(emit, fromFraction(f, min, max, scale, step), false);
      }
    })
    .onFinalize(() => {
      pressed.set(withTiming(0, { duration: 140 }));
      if (!dragging.get()) return;
      dragging.set(false);
      scheduleOnRN(emit, fromFraction(fraction.get(), min, max, scale, step), true);
    });

  // Toque simples: leva o valor até o ponto tocado.
  const tap = Gesture.Tap()
    .enabled(!disabled)
    .maxDuration(300)
    .onEnd((e) => {
      const usable = width.get() - THUMB;
      if (usable <= 0) return;
      const f = magnetize(Math.min(1, Math.max(0, (e.x - THUMB / 2) / usable)), magnetCenter);
      fraction.set(withTiming(f, { duration: 140, easing: Easing.out(Easing.cubic) }));
      scheduleOnRN(emit, fromFraction(f, min, max, scale, step), true);
    });

  // Toque duplo: volta ao padrão.
  const reset = Gesture.Tap()
    .enabled(!disabled && hasDefault)
    .numberOfTaps(2)
    .onEnd(() => {
      fraction.set(withTiming(center, { duration: 160, easing: Easing.out(Easing.cubic) }));
      scheduleOnRN(tick);
      scheduleOnRN(emit, defaultValue ?? min, true);
    });

  // O arrasto não espera o toque duplo: ganha assim que o dedo anda.
  const gesture = Gesture.Race(pan, hasDefault ? Gesture.Exclusive(reset, tap) : tap);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: fraction.get() * Math.max(0, width.get() - THUMB) },
      { scale: 1 + 0.18 * pressed.get() },
    ],
  }));
  const fillStyle = useAnimatedStyle(() => {
    const usable = Math.max(0, width.get() - THUMB);
    const from = centered ? center : 0;
    const a = Math.min(from, fraction.get());
    const b = Math.max(from, fraction.get());
    return { left: THUMB / 2 + a * usable, width: (b - a) * usable };
  });
  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.22 * pressed.get(),
    transform: [{ translateX: fraction.get() * Math.max(0, width.get() - THUMB) - 8 }, { scale: 0.6 + 0.4 * pressed.get() }],
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    width.set(e.nativeEvent.layout.width);
  };

  return (
    <View style={[styles.root, disabled ? { opacity: 0.4 } : null]}>
      <View style={styles.header}>
        <Txt variant="sm" tone="muted">
          {label}
        </Txt>
        <Txt variant="sm" weight="600" tabular>
          {format(shown)}
        </Txt>
      </View>
      <GestureDetector gesture={gesture}>
        <View
          style={styles.track}
          onLayout={onLayout}
          hitSlop={{ top: 6, bottom: 6 }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ text: format(shown) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => {
            const f = toFraction(value, min, max, scale) + (e.nativeEvent.actionName === 'increment' ? 0.05 : -0.05);
            const v = fromFraction(f, min, max, scale, step);
            emit(v, true);
          }}
        >
          <View style={styles.rail} />
          <Animated.View style={[styles.fill, fillStyle]} />
          <Animated.View style={[styles.halo, haloStyle]} pointerEvents="none" />
          <Animated.View style={[styles.thumb, thumbStyle]} />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: space[4], gap: space[1] },
  header: { flexDirection: 'row', justifyContent: 'space-between' },
  track: { height: TRACK_HEIGHT, justifyContent: 'center' },
  rail: {
    position: 'absolute',
    left: THUMB / 2,
    right: THUMB / 2,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  fill: { position: 'absolute', height: 4, borderRadius: 2, backgroundColor: colors.accent },
  halo: {
    position: 'absolute',
    left: 0,
    width: THUMB + 16,
    height: THUMB + 16,
    borderRadius: (THUMB + 16) / 2,
    backgroundColor: colors.accent,
  },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.text,
  },
});
