/**
 * "Vídeo pronto": a marca salta para o lugar (mola com um pouco de sobra, é um
 * momento raro e de comemoração), solta uma bolha de luz que se expande e
 * bolhas âmbar desfocadas que se espalham e somem, e o aparelho vibra de
 * sucesso no mesmo quadro. Com "reduzir movimento", a marca só aparece, sem
 * salto nem bolhas (a vibração continua).
 */
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Image,
  useImage,
} from "@shopify/react-native-skia";
import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import {
  Easing,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { colors } from "./theme";

const BUBBLES = 9;
const COLORS = ["#ff8a3d", "#ffb547", "#ffd9a0", "#ff6a2b"] as const;

export function BrandBurst({ size }: { size: number }) {
  const mark = useImage(require("../../assets/brand/mark.png"));
  const reduced = useReducedMotion();
  const t = useSharedValue(0);
  const scale = useSharedValue(reduced ? 1 : 0.82);
  const box = size * 2.2;
  const c = box / 2;
  const ready = !!mark;

  useEffect(() => {
    if (!ready) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );
    if (reduced) return;
    scale.set(withSpring(1, { duration: 500, dampingRatio: 0.55 }));
    t.set(withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [ready, reduced, scale, t]);

  const markTransform = useDerivedValue(() => [
    { translateX: c },
    { translateY: c },
    { scale: scale.get() },
    { translateX: -c },
    { translateY: -c },
  ]);
  const ringR = useDerivedValue(() => size * 0.42 + size * 0.6 * t.get());
  const ringOpacity = useDerivedValue(() =>
    t.get() > 0 && t.get() < 1 ? (1 - t.get()) * 0.8 : 0,
  );
  const glowR = useDerivedValue(() => size * (0.3 + 0.35 * t.get()));
  const glowOpacity = useDerivedValue(() =>
    t.get() > 0 ? 0.55 * (1 - t.get()) : 0,
  );

  return (
    <Canvas
      style={{ width: box, height: box }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {reduced ? null : (
        <>
          <Circle cx={c} cy={c} r={glowR} color="#ff9a3d" opacity={glowOpacity}>
            <BlurMask blur={size * 0.3} style="normal" />
          </Circle>
          <Circle
            cx={c}
            cy={c}
            r={ringR}
            color={colors.accent}
            style="stroke"
            strokeWidth={5}
            opacity={ringOpacity}
          >
            <BlurMask blur={5} style="normal" />
          </Circle>
          {Array.from({ length: BUBBLES }, (_, i) => (
            <Bubble key={i} index={i} t={t} center={c} size={size} />
          ))}
        </>
      )}
      {mark ? (
        <Group transform={markTransform}>
          <Image
            image={mark}
            x={c - size / 2}
            y={c - size / 2}
            width={size}
            height={size}
            fit="contain"
          />
        </Group>
      ) : null}
    </Canvas>
  );
}

function Bubble({
  index,
  t,
  center,
  size,
}: {
  index: number;
  t: SharedValue<number>;
  center: number;
  size: number;
}) {
  // Ângulos espalhados por igual, com um desvio fixo para não parecer um relógio;
  // tamanhos variados, as grandes vão menos longe.
  const angle = (index / BUBBLES) * Math.PI * 2 + ((index * 37) % 11) / 18;
  const radius = size * (0.06 + ((index * 53) % 5) * 0.025);
  const reach = size * (0.85 - ((index * 53) % 5) * 0.08);
  const cx = useDerivedValue(
    () => center + Math.cos(angle) * (size * 0.3 + reach * t.get()),
  );
  const cy = useDerivedValue(
    () => center + Math.sin(angle) * (size * 0.3 + reach * t.get()),
  );
  const r = useDerivedValue(() => radius * (0.6 + 0.4 * t.get()));
  const opacity = useDerivedValue(() =>
    t.get() > 0 ? 0.75 * (1 - t.get()) : 0,
  );
  return (
    <Circle
      cx={cx}
      cy={cy}
      r={r}
      color={COLORS[index % COLORS.length]}
      opacity={opacity}
    >
      <BlurMask blur={radius * 0.5} style="normal" />
    </Circle>
  );
}
