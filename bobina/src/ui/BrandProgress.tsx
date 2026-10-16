/**
 * Progresso com a marca do Ledit's: a silhueta apagada vai enchendo de dourado
 * de baixo para cima, com uma linha de luz na superfície e um brilho diagonal
 * que passa de tempos em tempos. Em volta, bolhas âmbar desfocadas giram
 * devagar (o mesmo estilo da abertura). Sem número (progress null), a marca
 * inteira "respira". Com "reduzir movimento", só enche: sem brilho, sem
 * respiração e com as bolhas paradas.
 *
 * As bolhas passam um pouco da caixa da marca; a margem negativa mantém o
 * mesmo espaço no layout que a marca sozinha ocupa.
 */
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Image,
  LinearGradient,
  Rect,
  rect,
  useImage,
  vec,
} from "@shopify/react-native-skia";
import { useEffect } from "react";
import {
  Easing,
  cancelAnimation,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

/** Corpo da marca dentro de assets/brand/mark.png (418 px), para o nível de enchimento. */
const BODY_TOP = 27 / 418;
const BODY_BOTTOM = 398 / 418;
/** Caixa desenhada em volta da marca, em múltiplos do tamanho dela. */
const BOX = 1.9;
/** Bolhas: ângulo inicial, distância e raio (em fração do tamanho), voltas por ciclo, cor, opacidade. */
const BUBBLES = [
  { angle: -2.3, dist: 0.62, r: 0.2, turns: 1, color: "#ff8a3d", alpha: 0.42 },
  { angle: -0.6, dist: 0.7, r: 0.13, turns: -1, color: "#ffd9a0", alpha: 0.34 },
  { angle: 0.9, dist: 0.6, r: 0.24, turns: 1, color: "#ff6a2b", alpha: 0.36 },
  { angle: 2.4, dist: 0.68, r: 0.15, turns: -2, color: "#ffb547", alpha: 0.4 },
] as const;
/** Duração de um ciclo das bolhas (ms). */
const ORBIT_MS = 9000;

export function BrandProgress({
  progress,
  size,
}: {
  progress: number | null;
  size: number;
}) {
  const mark = useImage(require("../../assets/brand/mark.png"));
  const reduced = useReducedMotion();
  const level = useSharedValue(progress ?? 1);
  const shine = useSharedValue(0);
  const breath = useSharedValue(1);
  const orbit = useSharedValue(0);
  const indeterminate = progress === null;

  useEffect(() => {
    if (reduced) return;
    orbit.set(
      withRepeat(
        withTiming(1, { duration: ORBIT_MS, easing: Easing.linear }),
        -1,
      ),
    );
    return () => cancelAnimation(orbit);
  }, [reduced, orbit]);

  useEffect(() => {
    const target = progress ?? 1;
    level.set(
      reduced
        ? target
        : withTiming(target, {
            duration: 300,
            easing: Easing.out(Easing.cubic),
          }),
    );
  }, [progress, reduced, level]);

  useEffect(() => {
    if (reduced) return;
    shine.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.cubic) }),
          withTiming(1, { duration: 500 }),
          withTiming(0, { duration: 0 }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(shine);
  }, [reduced, shine]);

  useEffect(() => {
    if (reduced || !indeterminate) {
      breath.set(1);
      return;
    }
    breath.set(
      withRepeat(
        withSequence(
          withTiming(0.55, { duration: 650 }),
          withTiming(1, { duration: 650 }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(breath);
  }, [reduced, indeterminate, breath]);

  const box = size * BOX;
  const pad = (box - size) / 2;
  const top = size * BODY_TOP;
  const body = size * (BODY_BOTTOM - BODY_TOP);
  const fillY = useDerivedValue(() => top + body * (1 - level.get()));
  // O recorte precisa ser um valor animado inteiro, não um objeto com valores animados dentro.
  const fillClip = useDerivedValue(() =>
    rect(0, fillY.get(), size, size - fillY.get()),
  );
  const surfaceY = useDerivedValue(() => fillY.get() - 1);
  const surfaceOpacity = useDerivedValue(() =>
    level.get() > 0.01 && level.get() < 0.99 ? 0.9 : 0,
  );
  const shineStart = useDerivedValue(() =>
    vec(-size * 0.9 + shine.get() * size * 2.2, size),
  );
  const shineEnd = useDerivedValue(() =>
    vec(-size * 0.9 + shine.get() * size * 2.2 + size * 0.45, size * 0.55),
  );

  const canvasStyle = { width: box, height: box, margin: -pad };
  if (!mark) return <Canvas style={canvasStyle} />;
  return (
    <Canvas
      style={canvasStyle}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {BUBBLES.map((b, i) => (
        <Bubble
          key={i}
          bubble={b}
          index={i}
          orbit={orbit}
          center={box / 2}
          size={size}
        />
      ))}
      <Group transform={[{ translateX: pad }, { translateY: pad }]}>
        {/* silhueta vazia */}
        <Image
          image={mark}
          x={0}
          y={0}
          width={size}
          height={size}
          fit="contain"
          opacity={0.14}
        />
        {/* parte cheia: a marca recortada do nível para baixo, com a luz por cima */}
        <Group clip={fillClip} opacity={breath} layer>
          <Image
            image={mark}
            x={0}
            y={0}
            width={size}
            height={size}
            fit="contain"
          />
          <Rect x={0} y={0} width={size} height={size} blendMode="srcATop">
            <LinearGradient
              start={shineStart}
              end={shineEnd}
              colors={["#ffffff00", "#fff3d6a0", "#ffffff00"]}
            />
          </Rect>
          <Rect
            x={0}
            y={surfaceY}
            width={size}
            height={2}
            color="#fff1cf"
            blendMode="srcATop"
            opacity={surfaceOpacity}
          />
        </Group>
      </Group>
    </Canvas>
  );
}

function Bubble({
  bubble,
  index,
  orbit,
  center,
  size,
}: {
  bubble: (typeof BUBBLES)[number];
  index: number;
  orbit: SharedValue<number>;
  center: number;
  size: number;
}) {
  const angle = useDerivedValue(
    () => bubble.angle + Math.PI * 2 * bubble.turns * orbit.get(),
  );
  // Cada bolha chega mais perto e se afasta um pouco ao girar, fora de fase com as outras.
  const dist = useDerivedValue(
    () =>
      size *
      bubble.dist *
      (1 +
        0.08 *
          Math.sin(Math.PI * 2 * (orbit.get() * 3 + index / BUBBLES.length))),
  );
  const cx = useDerivedValue(() => center + Math.cos(angle.get()) * dist.get());
  const cy = useDerivedValue(() => center + Math.sin(angle.get()) * dist.get());
  const r = size * bubble.r;
  return (
    <Circle cx={cx} cy={cy} r={r} color={bubble.color} opacity={bubble.alpha}>
      <BlurMask blur={r * 0.6} style="normal" />
    </Circle>
  );
}
