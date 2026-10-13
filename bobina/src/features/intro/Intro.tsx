/**
 * Abertura do Ledit's (só ao abrir o app do zero, ~2,3 s): continua da tela de
 * abertura nativa com a mesma marca no mesmo lugar, então o corte não aparece.
 * Tudo é desenhado no Skia e animado na thread de UI a partir de um único
 * relógio (ver timeline.ts). Um toque pula para o final; com "reduzir
 * movimento", o logotipo aparece parado e some num esmaecer curto.
 */
import {
  BlurMask,
  Canvas,
  Circle,
  FillType,
  Group,
  Image,
  LinearGradient,
  Path,
  Rect,
  Skia,
  useImage,
  vec,
  type SkImage,
} from "@shopify/react-native-skia";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions } from "react-native";
import {
  Easing,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { colors } from "@/ui/theme";

import {
  ORBS,
  T,
  WORDMARK_SEGMENTS,
  bloomOpacity,
  easeInOut,
  easeOut,
  introLayout,
  letterState,
  mixRect,
  orbState,
  phase,
  type IntroLayout,
} from "./timeline";

// A tela de abertura nativa fica até a abertura ter as imagens e desenhar o 1º quadro.
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 0, fade: false });

/** Só uma vez por processo: voltar do editor não repete a abertura. */
let played = false;

export function Intro() {
  const [done, setDone] = useState(played);
  if (done) return null;
  return (
    <IntroOverlay
      onDone={() => {
        played = true;
        setDone(true);
      }}
    />
  );
}

function IntroOverlay({ onDone }: { onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const layout = useMemo(() => introLayout(width, height), [width, height]);
  const mark = useImage(require("../../../assets/brand/mark.png"));
  const wordmark = useImage(require("../../../assets/brand/wordmark.png"));
  const reduced = useReducedMotion();
  const clock = useSharedValue(0);
  const ready = !!mark && !!wordmark;

  useEffect(() => {
    if (!ready) return;
    SplashScreen.hideAsync().catch(() => {});
    const finish = (finished?: boolean) => {
      "worklet";
      if (finished) scheduleOnRN(onDone);
    };
    if (reduced) {
      // Sem movimento: logotipo pronto, depois um esmaecer.
      clock.set(T.exitStart);
      clock.set(
        withTiming(
          T.end,
          { duration: T.end - T.exitStart + 300, easing: Easing.linear },
          finish,
        ),
      );
    } else {
      clock.set(
        withTiming(T.end, { duration: T.end, easing: Easing.linear }, finish),
      );
    }
  }, [ready, reduced, clock, onDone]);

  // Se as imagens não carregarem, não prende o usuário na abertura.
  useEffect(() => {
    const timer = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
      onDone();
    }, 4000);
    return () => clearTimeout(timer);
  }, [onDone]);

  const skip = () => {
    if (clock.get() >= T.exitStart) return;
    clock.set(T.exitStart);
    clock.set(
      withTiming(
        T.end,
        { duration: T.end - T.exitStart, easing: Easing.linear },
        (finished) => {
          "worklet";
          if (finished) scheduleOnRN(onDone);
        },
      ),
    );
  };

  return (
    <Pressable
      style={StyleSheet.absoluteFill}
      onPress={skip}
      accessibilityLabel="Abertura do Ledit's. Toque para pular."
      accessibilityRole="button"
    >
      <Canvas style={StyleSheet.absoluteFill}>
        {ready ? (
          <Scene
            clock={clock}
            layout={layout}
            mark={mark}
            wordmark={wordmark}
            reduced={reduced}
            width={width}
            height={height}
          />
        ) : (
          <Rect x={0} y={0} width={width} height={height} color={colors.bg} />
        )}
      </Canvas>
    </Pressable>
  );
}

interface SceneProps {
  clock: SharedValue<number>;
  layout: IntroLayout;
  mark: SkImage;
  wordmark: SkImage;
  reduced: boolean;
  width: number;
  height: number;
}

function Scene({
  clock,
  layout,
  mark,
  wordmark,
  reduced,
  width,
  height,
}: SceneProps) {
  const { center, splash, markFinal, wordmark: wm, k, cover } = layout;

  const short = Math.min(width, height);

  // Fundo com uma bolha de borda macia que cresce do centro na saída: abre
  // rápido e desacelera, e o app aparece por trás do logotipo. O retângulo
  // passa das bordas da tela para o desfoque não clarear os cantos.
  const exit = useDerivedValue(() =>
    easeOut(phase(clock.get(), T.exitStart, T.end - T.exitStart)),
  );
  const backdrop = useDerivedValue(() => {
    const r = reduced ? 0 : exit.get() * (cover + EDGE_BLUR * 2);
    const b = Skia.PathBuilder.Make().addRect(
      Skia.XYWHRect(
        -EDGE_BLUR * 3,
        -EDGE_BLUR * 3,
        width + EDGE_BLUR * 6,
        height + EDGE_BLUR * 6,
      ),
    );
    if (r > 0.5) b.addCircle(center.x, center.y, r);
    return b.setFillType(FillType.EvenOdd).detach();
  });
  const backdropOpacity = useDerivedValue(() =>
    reduced ? 1 - phase(clock.get(), T.exitStart, T.end - T.exitStart) : 1,
  );
  // A película da bolha: um aro âmbar desfocado que acompanha a borda e some.
  const rimR = useDerivedValue(() => exit.get() * (cover + EDGE_BLUR * 2));
  const rimOpacity = useDerivedValue(() =>
    reduced || exit.get() <= 0 ? 0 : 0.7 * (1 - exit.get()),
  );

  // Brilho atrás da marca quando as bolhas se fundem nela.
  const bloomO = useDerivedValue(() =>
    reduced ? 0 : bloomOpacity(clock.get()),
  );
  const bloomR = useDerivedValue(
    () => splash.width * (0.45 + 0.25 * bloomOpacity(clock.get())),
  );

  // Logotipo inteiro: cresce um pouco e some enquanto o círculo abre.
  const brandOpacity = useDerivedValue(
    () => 1 - easeOut(phase(clock.get(), T.exitStart, 320)),
  );
  const brandTransform = useDerivedValue(() => {
    const s = 1 + 0.08 * exit.get();
    return [
      { translateX: center.x },
      { translateY: center.y },
      { scale: s },
      { translateX: -center.x },
      { translateY: -center.y },
    ];
  });

  // Marca grande: respira, encolhe e vai para o lugar dela no logotipo.
  const markRect = useDerivedValue(() => {
    const t = clock.get();
    const move = easeInOut(phase(t, T.moveStart, T.moveEnd - T.moveStart));
    const breath =
      t < T.moveStart
        ? 1 + 0.04 * Math.sin(Math.PI * phase(t, 0, T.moveStart))
        : 1;
    const r = mixRect(splash, markFinal, move);
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    return {
      x: cx - (r.width * breath) / 2,
      y: cy - (r.height * breath) / 2,
      width: r.width * breath,
      height: r.height * breath,
    };
  });
  const markX = useDerivedValue(() => markRect.get().x);
  const markY = useDerivedValue(() => markRect.get().y);
  const markW = useDerivedValue(() => markRect.get().width);
  const markH = useDerivedValue(() => markRect.get().height);
  const swap = useDerivedValue(() =>
    easeOut(phase(clock.get(), T.swapStart, T.swapEnd - T.swapStart)),
  );
  const bigMarkOpacity = useDerivedValue(() => 1 - swap.get());

  // Brilho diagonal que atravessa o dourado (só onde há marca: srcATop).
  const shine = useDerivedValue(() =>
    easeInOut(phase(clock.get(), T.shineStart, T.shineEnd - T.shineStart)),
  );
  const shineStart = useDerivedValue(() => {
    const r = markRect.get();
    const d = r.width * 1.6;
    const x = r.x - d * 0.6 + shine.get() * (r.width + d);
    return vec(x, r.y + r.height);
  });
  const shineEnd = useDerivedValue(() => {
    const s = shineStart.get();
    const r = markRect.get();
    return vec(s.x + r.width * 0.55, s.y - r.height * 0.55);
  });
  const shineOpacity = useDerivedValue(() =>
    clock.get() > T.shineStart && clock.get() < T.shineEnd ? 1 : 0,
  );

  const wmX = wm.x;
  const wmY = wm.y;
  const wmClipTop = wmY - 8;
  const baseline = wmY + wm.height;

  return (
    <>
      <Path path={backdrop} color={colors.bg} opacity={backdropOpacity}>
        {reduced ? null : <BlurMask blur={EDGE_BLUR} style="normal" />}
      </Path>
      <Circle
        cx={center.x}
        cy={center.y}
        r={rimR}
        color={colors.accent}
        style="stroke"
        strokeWidth={6}
        opacity={rimOpacity}
      >
        <BlurMask blur={8} style="normal" />
      </Circle>

      <Group
        transform={brandTransform}
        opacity={reduced ? backdropOpacity : brandOpacity}
      >
        {/* bolhas: luz âmbar fora de foco que flutua e se funde na marca */}
        {reduced
          ? null
          : ORBS.map((o, i) => (
              <Orb
                key={i}
                index={i}
                color={o.color}
                baseR={o.r}
                clock={clock}
                center={center}
                short={short}
              />
            ))}
        <Circle
          cx={center.x}
          cy={center.y}
          r={bloomR}
          color="#ff9a3d"
          opacity={bloomO}
        >
          <BlurMask blur={splash.width * 0.35} style="normal" />
        </Circle>

        {/* marca grande + brilho */}
        <Group opacity={reduced ? 0 : bigMarkOpacity} layer>
          <Image
            image={mark}
            x={markX}
            y={markY}
            width={markW}
            height={markH}
            fit="contain"
          />
          <Rect
            x={0}
            y={0}
            width={width}
            height={height}
            blendMode="srcATop"
            opacity={shineOpacity}
          >
            <LinearGradient
              start={shineStart}
              end={shineEnd}
              colors={["#ffffff00", "#fff6e0b0", "#ffffff00"]}
            />
          </Rect>
        </Group>

        {/* marca do logotipo: entra no lugar da grande no fim do movimento */}
        <Group
          clip={{
            x: wmX,
            y: wmClipTop,
            width: WORDMARK_SEGMENTS[0][1] * k + 2,
            height: baseline - wmClipTop + 2,
          }}
          opacity={reduced ? 1 : swap}
        >
          <Image
            image={wordmark}
            x={wmX}
            y={wmY}
            width={wm.width}
            height={wm.height}
            fit="fill"
          />
        </Group>

        {/* letras "edit's": cada uma sobe de trás da linha de base */}
        {WORDMARK_SEGMENTS.slice(1).map(([a, b], i) => (
          <Letter
            key={a}
            index={i}
            clock={clock}
            image={wordmark}
            reduced={reduced}
            clip={{
              x: wmX + a * k - 1,
              y: wmClipTop,
              width: (b - a) * k + 2,
              height: baseline - wmClipTop + 1,
            }}
            frame={wm}
          />
        ))}
      </Group>
    </>
  );
}

/** Desfoque da borda da bolha de saída (dp). */
const EDGE_BLUR = 22;

function Orb({
  index,
  color,
  baseR,
  clock,
  center,
  short,
}: {
  index: number;
  color: string;
  baseR: number;
  clock: SharedValue<number>;
  center: { x: number; y: number };
  short: number;
}) {
  const cx = useDerivedValue(
    () => orbState(clock.get(), index, center, short).x,
  );
  const cy = useDerivedValue(
    () => orbState(clock.get(), index, center, short).y,
  );
  const r = useDerivedValue(
    () => orbState(clock.get(), index, center, short).r,
  );
  const opacity = useDerivedValue(
    () => orbState(clock.get(), index, center, short).opacity,
  );
  return (
    <Circle cx={cx} cy={cy} r={r} color={color} opacity={opacity}>
      <BlurMask blur={baseR * 0.55} style="normal" />
    </Circle>
  );
}

function Letter({
  index,
  clock,
  image,
  reduced,
  clip,
  frame,
}: {
  index: number;
  clock: SharedValue<number>;
  image: SkImage;
  reduced: boolean;
  clip: { x: number; y: number; width: number; height: number };
  frame: { x: number; y: number; width: number; height: number };
}) {
  const transform = useDerivedValue(() => {
    const rise = reduced ? 0 : letterState(clock.get(), index).rise;
    return [{ translateY: rise * frame.height * 0.75 }];
  });
  const opacity = useDerivedValue(() =>
    reduced ? 1 : letterState(clock.get(), index).opacity,
  );
  return (
    <Group clip={clip}>
      <Group transform={transform} opacity={opacity}>
        <Image
          image={image}
          x={frame.x}
          y={frame.y}
          width={frame.width}
          height={frame.height}
          fit="fill"
        />
      </Group>
    </Group>
  );
}
