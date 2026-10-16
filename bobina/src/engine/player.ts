/**
 * Player do preview. Usa a API de baixo nível da skia-video para decodificar só
 * uma janela da timeline por vez (o Android tem limite de decodificadores) e
 * desenha cada quadro com `drawProject`, o mesmo desenho da exportação.
 *
 * Baseado em `useVideoCompositionPlayer` da @azzapp/react-native-skia-video (MIT).
 */
import {
  __RNSkiaVideoPrivateAPI as SkiaVideo,
  type VideoCompositionFramesExtractor,
} from '@azzapp/react-native-skia-video';
import { Skia, type SkImage, type SkSurface } from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio } from 'react-native';
import { useAnimatedReaction, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { runOnUI, scheduleOnRN } from 'react-native-worklets';

import {
  compositionForWindow,
  compositionSignature,
  planWindows,
  windowAt,
  type Composition,
  type TimeWindow,
} from '@/core/composition';
import type { RenderPlan } from '@/core/renderPlan';

import { drawProject, type DrawResources } from './draw';

export interface PreviewPlayer {
  /** Quadro desenhado, para `<Image image={frame} />` dentro de um `<Canvas>`. */
  frame: SharedValue<SkImage | null>;
  /** Tempo atual em segundos (atualizado a cada quadro na thread de UI). */
  time: SharedValue<number>;
  playing: SharedValue<boolean>;
  /** Mudança de janela ou motor preparando. */
  busy: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Vai para `seconds`. Fora da janela atual, troca de janela. */
  seek: (seconds: number) => void;
  error: string | null;
}

interface Options {
  composition: Composition | null;
  /** Duração do projeto em segundos (vale também sem composição, só com fotos e textos). */
  duration: number;
  plan: SharedValue<RenderPlan | null>;
  resources: SharedValue<DrawResources | null>;
  /** Tamanho do preview em pontos. */
  width: number;
  height: number;
  onEnd?: () => void;
}

const END_EPSILON = 0.03;
/** Quadros redesenhados depois de uma mudança com o vídeo parado (o motor ainda pode estar decodificando). */
const IDLE_REDRAW_FRAMES = 30;

export function usePreviewPlayer({ composition, duration, plan, resources, width, height, onEnd }: Options): PreviewPlayer {
  const frame = useSharedValue<SkImage | null>(null);
  const time = useSharedValue(0);
  const playing = useSharedValue(false);
  const surface = useSharedValue<SkSurface | null>(null);
  const switching = useSharedValue(false);
  // O motor fica num valor compartilhado e só é trocado e liberado na thread de UI,
  // na mesma fila do desenho: o quadro nunca usa um motor já liberado.
  const active = useSharedValue<VideoCompositionFramesExtractor | null>(null);
  // Parado, só redesenha por um tempo depois de alguma mudança (economiza bateria).
  const dirtyFrames = useSharedValue(IDLE_REDRAW_FRAMES);
  const lastTime = useSharedValue(-1);

  const signature = compositionSignature(composition);
  const windows = useMemo<TimeWindow[]>(
    () => (composition ? planWindows(composition) : [{ start: 0, end: duration }]),
    // A composição só muda de verdade quando a assinatura muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature, duration],
  );
  const [windowIndex, setWindowIndex] = useState(0);
  const safeIndex = Math.min(windowIndex, windows.length - 1);
  const currentWindow = windows[safeIndex]!;
  const windowEnd = useSharedValue(currentWindow.end);
  const durationSV = useSharedValue(duration);
  useEffect(() => {
    windowEnd.set(currentWindow.end);
    durationSV.set(duration);
  }, [currentWindow, duration, windowEnd, durationSV]);

  const created = useMemo<{ extractor: VideoCompositionFramesExtractor | null; error: string | null }>(() => {
    if (!composition) return { extractor: null, error: null };
    const windowed = compositionForWindow(composition, currentWindow);
    if (windowed.items.length === 0) return { extractor: null, error: null };
    try {
      return { extractor: SkiaVideo.createVideoCompositionFramesExtractor(windowed), error: null };
    } catch (e) {
      return { extractor: null, error: String(e) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, safeIndex, windows]);
  const extractor = created.extractor;

  // "Carregando" até o motor avisar que está pronto (ou 1,5 s, em aparelhos sem o aviso).
  const [readyFor, setReadyFor] = useState<VideoCompositionFramesExtractor | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const busy = extractor !== null && readyFor !== extractor;

  // Prepara o motor e retoma do ponto e do estado (tocando ou não) de antes.
  const resumePlaying = useRef(false);
  useEffect(() => {
    if (!extractor) return;
    const unsubscribeReady = extractor.on('ready', () => setReadyFor(extractor));
    const unsubscribeError = extractor.on('error', (e: unknown) => setRuntimeError(String(e)));
    const start = time.get();
    const resume = resumePlaying.current;
    runOnUI(() => {
      'worklet';
      // No Android, preparar exige um contexto OpenGL ativo nesta thread; uma
      // superfície do Skia garante que ele exista antes do primeiro desenho.
      const ui = globalThis as unknown as { __bobinaGL?: SkSurface | null };
      if (!ui.__bobinaGL) ui.__bobinaGL = Skia.Surface.MakeOffscreen(16, 16);
      try {
        extractor.prepare();
        extractor.seekTo(start);
        if (resume) extractor.play();
      } catch (e) {
        // Um erro aqui fecharia o app; vira aviso no preview.
        scheduleOnRN(setRuntimeError, String(e));
        return;
      }
      active.set(extractor);
      switching.set(false);
      dirtyFrames.set(IDLE_REDRAW_FRAMES);
    })();
    const fallback = setTimeout(() => setReadyFor(extractor), 1500);
    return () => {
      clearTimeout(fallback);
      unsubscribeReady();
      unsubscribeError();
      runOnUI(() => {
        'worklet';
        if (active.get() === extractor) active.set(null);
        try {
          extractor.pause();
          extractor.dispose();
        } catch {
          // já liberado
        }
      })();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractor]);

  // Janela sem vídeo (só fotos e textos): libera a troca de janela na hora.
  useEffect(() => {
    if (!extractor) switching.set(false);
  }, [extractor, switching]);

  // Troca de janela pedida pela thread de UI (fim da janela durante a reprodução).
  const goToWindow = useCallback((index: number, keepPlaying: boolean) => {
    resumePlaying.current = keepPlaying;
    setWindowIndex(index);
  }, []);

  const pixelRatio = PixelRatio.get();
  const pxW = Math.max(2, Math.round(width * pixelRatio));
  const pxH = Math.max(2, Math.round(height * pixelRatio));

  useEffect(() => {
    surface.set(null);
    dirtyFrames.set(IDLE_REDRAW_FRAMES);
  }, [pxW, pxH, surface, dirtyFrames]);

  // Projeto editado (texto, filtro, posição...): redesenha mesmo parado.
  useAnimatedReaction(
    () => [plan.get(), resources.get()] as const,
    () => {
      dirtyFrames.set(IDLE_REDRAW_FRAMES);
    },
  );

  const hasEngine = extractor !== null;
  useFrameCallback((info) => {
    'worklet';
    let t = time.get();
    let frames = {};
    const engine = active.get();
    if (engine) {
      t = engine.currentTime;
      frames = engine.decodeCompositionFrames();
    } else if (playing.get() && !hasEngine) {
      // Sem vídeo nesta janela (só fotos e textos): relógio próprio.
      t = t + (info.timeSincePreviousFrame ?? 16) / 1000;
    }
    if (playing.get() && !switching.get()) {
      const total = durationSV.get();
      const end = windowEnd.get();
      if (t >= total - END_EPSILON) {
        t = total;
        playing.set(false);
        engine?.pause();
        if (onEnd) scheduleOnRN(onEnd);
      } else if (t >= end - END_EPSILON && end < total) {
        switching.set(true);
        time.set(end);
        scheduleOnRN(goToWindow, safeIndex + 1, true);
        return;
      }
    }
    time.set(t);

    // Parado e sem mudanças: não redesenha.
    if (!playing.get()) {
      if (t !== lastTime.get()) dirtyFrames.set(IDLE_REDRAW_FRAMES);
      const left = dirtyFrames.get();
      if (left <= 0) return;
      dirtyFrames.set(left - 1);
    }
    lastTime.set(t);

    const currentPlan = plan.get();
    const res = resources.get();
    if (!currentPlan || !res) return;
    let target = surface.get();
    if (!target) {
      target = Skia.Surface.MakeOffscreen(pxW, pxH);
      surface.set(target);
    }
    if (!target) return;
    const canvas = target.getCanvas();
    canvas.clear(Skia.Color('#000000'));
    drawProject(canvas, currentPlan, res, Math.round(t * 1_000_000), frames, pxW, pxH);
    target.flush();
    const previous = frame.get();
    try {
      const next = Skia.Image.MakeImageFromNativeTextureUnstable(
        target.getNativeTextureUnstable(),
        pxW,
        pxH,
        false,
        previous ?? undefined,
      );
      if (next === previous) frame.modify(undefined, true);
      else frame.set(next);
    } catch {
      // superfície recriada no meio do quadro
    }
  }, true);

  const seek = useCallback(
    (seconds: number) => {
      const t = Math.max(0, Math.min(duration, seconds));
      time.set(t);
      dirtyFrames.set(IDLE_REDRAW_FRAMES);
      const target = windowAt(windows, t);
      const index = windows.indexOf(target);
      if (index !== safeIndex) {
        resumePlaying.current = playing.get();
        setWindowIndex(index);
        return;
      }
      extractor?.seekTo(t);
    },
    [duration, windows, safeIndex, extractor, time, playing, dirtyFrames],
  );

  const play = useCallback(() => {
    if (time.get() >= duration - END_EPSILON) seek(0);
    playing.set(true);
    resumePlaying.current = true;
    extractor?.play();
  }, [duration, extractor, playing, seek, time]);

  const pause = useCallback(() => {
    playing.set(false);
    resumePlaying.current = false;
    extractor?.pause();
  }, [extractor, playing]);

  const toggle = useCallback(() => {
    if (playing.get()) pause();
    else play();
  }, [pause, play, playing]);

  return { frame, time, playing, busy, play, pause, toggle, seek, error: created.error ?? runtimeError };
}
