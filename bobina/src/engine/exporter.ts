/**
 * Exportação: decodifica janela por janela (limite de decodificadores), desenha
 * cada quadro com `drawProject` e codifica H.264 + AAC num único arquivo.
 *
 * O laço segue `exportVideoComposition` da @azzapp/react-native-skia-video (MIT),
 * com as janelas e o desenho do Bobina.
 */
import { __RNSkiaVideoPrivateAPI as SkiaVideo } from '@azzapp/react-native-skia-video';
import { BlendMode, Skia, type SkSurface } from '@shopify/react-native-skia';
import { Platform } from 'react-native';
import {
  createSynchronizable,
  createWorkletRuntime,
  runOnRuntime,
  runOnRuntimeAsync,
  scheduleOnRN,
  type WorkletRuntime,
} from 'react-native-worklets';

import { compositionForWindow, planWindows, type Composition } from '@/core/composition';
import type { RenderPlan } from '@/core/renderPlan';

import { drawProject, type DrawResources } from './draw';
import { installMasks } from './maskStore';
import type { LoadedMasks } from './resources';

let runtime: WorkletRuntime | null = null;
function exportRuntime(): WorkletRuntime {
  if (!runtime) runtime = createWorkletRuntime({ name: 'BobinaExport' });
  return runtime;
}

export interface RenderJob {
  /** Caminho absoluto puro do arquivo de saída (.mp4). */
  outPath: string;
  width: number;
  height: number;
  fps: number;
  bitRate: number;
  composition: Composition;
  plan: RenderPlan;
  resources: DrawResources;
  /** Máscaras dos recortes, por arquivo (ver engine/resources.ts). */
  masks?: Record<string, LoadedMasks>;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export class ExportCancelled extends Error {
  constructor() {
    super('Exportação cancelada.');
    this.name = 'AbortError';
  }
}

/** No Android, ajusta resolução/fps/bitrate ao que o codificador do aparelho aceita. */
export function encoderConfig(width: number, height: number, fps: number, bitRate: number) {
  if (Platform.OS !== 'android') return { width, height, fps, bitRate, encoderName: null as string | null };
  try {
    const configs = SkiaVideo.getValidEncoderConfigurations(width, height, fps, bitRate);
    const best = configs?.find((c) => c.hardwareAccelerated) ?? configs?.[0];
    if (best) {
      return { width: best.width, height: best.height, fps: best.frameRate, bitRate: best.bitRate, encoderName: best.encoderName };
    }
  } catch {
    // sem informação do aparelho: tenta com os valores pedidos
  }
  return { width, height, fps, bitRate, encoderName: null as string | null };
}

export async function renderVideo(job: RenderJob): Promise<void> {
  // As máscaras dos recortes vão uma vez para o runtime da exportação.
  for (const [key, m] of Object.entries(job.masks ?? {})) {
    await runOnRuntimeAsync(exportRuntime(), installMasks, key, m.data, m.offsets, m.size);
  }
  return renderFrames(job);
}

function renderFrames(job: RenderJob): Promise<void> {
  const { outPath, composition, plan, resources, onProgress, signal } = job;
  const config = encoderConfig(job.width, job.height, job.fps, job.bitRate);
  const windows = planWindows(composition);
  const windowed = windows.map((w) => ({ end: w.end, composition: compositionForWindow(composition, w) }));
  const duration = composition.duration;

  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ExportCancelled());
      return;
    }
    const cancelled = createSynchronizable(false);
    const onAbort = () => {
      cancelled.setBlocking(true);
      reject(new ExportCancelled());
    };
    signal?.addEventListener('abort', onAbort);
    const settle = (error: unknown) => {
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else resolve();
    };
    const progress = onProgress ?? (() => {});

    runOnRuntime(exportRuntime(), () => {
      'worklet';
      const { width, height, fps, bitRate, encoderName } = config;
      let encoder: ReturnType<typeof SkiaVideo.createVideoEncoder> | null = null;
      try {
        // Uma superfície por tamanho, reaproveitada entre exportações (liberar a
        // superfície não libera a textura até o GC do runtime rodar).
        const cache = globalThis as unknown as { __bobinaSurface?: SkSurface | null; __bobinaW?: number; __bobinaH?: number };
        let surface = cache.__bobinaSurface ?? null;
        if (!surface || cache.__bobinaW !== width || cache.__bobinaH !== height) {
          surface?.dispose();
          surface = Skia.Surface.MakeOffscreen(width, height);
          if (!surface) throw new Error('Não foi possível criar a superfície de desenho.');
          cache.__bobinaSurface = surface;
          cache.__bobinaW = width;
          cache.__bobinaH = height;
        }
        encoder = SkiaVideo.createVideoEncoder(
          {
            outPath,
            width,
            height,
            frameRate: fps,
            bitRate,
            encoderName,
            audioBitRate: 192_000,
            audioSampleRate: 44_100,
            audioChannelCount: 2,
          },
          composition,
        );
        encoder.prepare();
        const canvas = surface.getCanvas();
        const clear = Skia.Color('#00000000');
        const pooled = SkiaVideo.runWithAutoreleasePool ?? ((fn: () => void) => fn());
        const total = Math.max(1, Math.ceil(duration * fps));
        let index = 0;
        for (let w = 0; w < windowed.length; w++) {
          const isLast = w === windowed.length - 1;
          const last = isLast ? total : Math.min(total, Math.ceil(windowed[w]!.end * fps - 1e-9));
          const extractor = SkiaVideo.createVideoCompositionFramesExtractorSync(windowed[w]!.composition);
          extractor.start();
          try {
            for (; index < last; index++) {
              if (cancelled.getDirty()) return;
              const t = index / fps;
              const target = surface;
              const enc = encoder;
              pooled(() => {
                const frames = extractor.decodeCompositionFrames(t);
                canvas.drawColor(clear, BlendMode.Clear);
                drawProject(canvas, plan, resources, Math.round(t * 1_000_000), frames, width, height);
                // Espera a GPU terminar: o codificador lê a textura em outra fila.
                target.flush(true);
                enc.encodeFrame(target.getNativeTextureUnstable(), t);
              });
              if (index % 5 === 0 || index === total - 1) scheduleOnRN(progress, index + 1, total);
            }
          } finally {
            extractor.dispose();
          }
        }
        encoder.finishWriting();
        scheduleOnRN(settle, null);
      } catch (e) {
        scheduleOnRN(settle, String(e));
      } finally {
        encoder?.dispose();
      }
    })();
  });
}
