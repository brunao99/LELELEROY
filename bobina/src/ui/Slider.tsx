import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
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
  /** Chamado durante o arrasto. */
  onChange: (value: number) => void;
  /** Chamado ao soltar. */
  onCommit?: (value: number) => void;
  disabled?: boolean;
}

const THUMB = 22;

function toFraction(value: number, min: number, max: number, scale: SliderScale): number {
  'worklet';
  if (scale === 'log') return (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min));
  return (value - min) / (max - min);
}

function fromFraction(f: number, min: number, max: number, scale: SliderScale, step: number): number {
  'worklet';
  const k = Math.min(1, Math.max(0, f));
  const raw = scale === 'log' ? Math.exp(Math.log(min) + k * (Math.log(max) - Math.log(min))) : min + k * (max - min);
  if (step <= 0) return raw;
  return Math.min(max, Math.max(min, Math.round(raw / step) * step));
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
  const dragging = useSharedValue(false);
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

  const center = toFraction(defaultValue ?? min, min, max, scale);

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .minDistance(0)
    .onBegin((e) => {
      dragging.set(true);
      const w = width.get();
      if (w > 0) {
        const f = Math.min(1, Math.max(0, (e.x - THUMB / 2) / (w - THUMB)));
        fraction.set(f);
        scheduleOnRN(emit, fromFraction(f, min, max, scale, step), false);
      }
    })
    .onUpdate((e) => {
      const w = width.get();
      if (w <= 0) return;
      const f = Math.min(1, Math.max(0, (e.x - THUMB / 2) / (w - THUMB)));
      fraction.set(f);
      scheduleOnRN(emit, fromFraction(f, min, max, scale, step), false);
    })
    .onFinalize(() => {
      dragging.set(false);
      scheduleOnRN(emit, fromFraction(fraction.get(), min, max, scale, step), true);
    });

  const reset = Gesture.Tap()
    .enabled(!disabled && defaultValue !== undefined)
    .numberOfTaps(2)
    .onEnd(() => {
      fraction.set(center);
      scheduleOnRN(emit, defaultValue ?? min, true);
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: fraction.get() * Math.max(0, width.get() - THUMB) }],
  }));
  const fillStyle = useAnimatedStyle(() => {
    const usable = Math.max(0, width.get() - THUMB);
    const from = centered ? center : 0;
    const a = Math.min(from, fraction.get());
    const b = Math.max(from, fraction.get());
    return { left: THUMB / 2 + a * usable, width: (b - a) * usable };
  });

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
      <GestureDetector gesture={Gesture.Exclusive(reset, pan)}>
        <View
          style={styles.track}
          onLayout={onLayout}
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
          <Animated.View style={[styles.thumb, thumbStyle]} />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: space[4], gap: space[1] },
  header: { flexDirection: 'row', justifyContent: 'space-between' },
  track: { height: 36, justifyContent: 'center' },
  rail: {
    position: 'absolute',
    left: THUMB / 2,
    right: THUMB / 2,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  fill: { position: 'absolute', height: 3, borderRadius: 2, backgroundColor: colors.accent },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.text,
  },
});
