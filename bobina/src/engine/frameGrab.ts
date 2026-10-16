/**
 * Congelar quadro: lê um quadro exato do vídeo com o mesmo decodificador do
 * motor e grava como foto (JPEG) dentro do projeto.
 */
import { __RNSkiaVideoPrivateAPI as SkiaVideo } from '@azzapp/react-native-skia-video';
import { ImageFormat, Skia, type SkSurface } from '@shopify/react-native-skia';
import { Directory } from 'expo-file-system';
import { createWorkletRuntime, runOnRuntime, scheduleOnRN, type WorkletRuntime } from 'react-native-worklets';

import { displaySize } from '@/core/geometry';
import { newId } from '@/core/ids';
import type { MediaAsset, Micros } from '@/core/types';
import { absolutePath, ensureDir, projectDir, projectFile } from '@/storage/paths';

import { drawUpright } from './bake';

/** Lado maior da foto congelada (como as fotos importadas). */
const MAX_SIDE = 4096;

let runtime: WorkletRuntime | null = null;

/** Grava o quadro de `asset` no instante `time` (tempo da mídia) e devolve a nova foto. */
export function grabFrame(projectId: string, asset: MediaAsset, time: Micros): Promise<MediaAsset> {
  if (asset.kind !== 'video') return Promise.reject(new Error('Só dá para congelar quadros de vídeo.'));
  if (!runtime) runtime = createWorkletRuntime({ name: 'BobinaFrameGrab' });
  const size = displaySize(asset);
  const k = Math.min(1, MAX_SIDE / Math.max(size.width, size.height));
  const width = Math.max(2, Math.round(size.width * k));
  const height = Math.max(2, Math.round(size.height * k));
  const path = absolutePath(projectId, asset.file);
  // Um pouco antes do fim, para o decodificador sempre ter um quadro.
  const start = Math.max(0, Math.min(time, asset.duration - 50_000)) / 1_000_000;
  const work = runtime;
  return new Promise<Uint8Array>((resolve, reject) => {
    const done = (bytes: Uint8Array | null, error: string | null) => {
      if (bytes) resolve(bytes);
      else reject(new Error(error ?? 'Não foi possível ler o quadro.'));
    };
    runOnRuntime(work, () => {
      'worklet';
      let extractor: ReturnType<typeof SkiaVideo.createVideoCompositionFramesExtractorSync> | null = null;
      let surface: SkSurface | null = null;
      try {
        // A superfície também dá ao extrator o contexto OpenGL de que ele precisa no Android.
        surface = Skia.Surface.MakeOffscreen(width, height);
        if (!surface) throw new Error('Não foi possível criar a superfície.');
        extractor = SkiaVideo.createVideoCompositionFramesExtractorSync({
          duration: 0.5,
          items: [{ id: 'f', path, compositionStartTime: 0, startTime: start, duration: 0.5 }],
        });
        extractor.start();
        const frame = extractor.decodeCompositionFrames(0.001).f;
        if (!frame || !frame.texture) throw new Error('Quadro vazio.');
        drawUpright(surface.getCanvas(), frame, width, height);
        surface.flush(true);
        const image = surface.makeImageSnapshot();
        const bytes = image.encodeToBytes(ImageFormat.JPEG, 92);
        image.dispose();
        scheduleOnRN(done, bytes, null);
      } catch (e) {
        scheduleOnRN(done, null, String(e));
      } finally {
        extractor?.dispose();
        surface?.dispose();
      }
    })();
  }).then((bytes) => {
    ensureDir(new Directory(projectDir(projectId), 'media'));
    const id = newId('m');
    const relative = `media/${id}.jpg`;
    const file = projectFile(projectId, relative);
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);
    return {
      id,
      kind: 'image',
      file: relative,
      duration: 0,
      width,
      height,
      rotation: 0,
      hasAudio: false,
      originalName: `${asset.originalName} (quadro)`,
    } satisfies MediaAsset;
  });
}
