import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import type { MediaAsset } from '@/core/types';
import { importMedia, type PickedMedia } from '@/storage/media';

/** Abre o seletor do sistema (fotos e vídeos, vários, na ordem tocada). Não pede permissão de galeria. */
export async function pickVisualMedia(
  options: { multiple?: boolean; videosOnly?: boolean; imagesOnly?: boolean; limit?: number } = {},
): Promise<PickedMedia[]> {
  const multiple = options.multiple ?? true;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: options.videosOnly ? ['videos'] : options.imagesOnly ? ['images'] : ['images', 'videos'],
    allowsMultipleSelection: multiple,
    orderedSelection: multiple,
    selectionLimit: multiple ? (options.limit ?? 0) : 1,
    quality: 1,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    shouldDownloadFromNetwork: true,
  });
  if (result.canceled) return [];
  return result.assets
    .filter((a) => a.type === 'image' || a.type === 'video' || a.type === 'livePhoto')
    .map((a, i) => ({
      uri: a.uri,
      kind: a.type === 'video' ? 'video' : 'image',
      name: a.fileName ?? `midia-${i + 1}`,
      width: a.width,
      height: a.height,
      durationMs: a.duration ?? null,
    }));
}

/** Arquivo de áudio do próprio aparelho. */
export async function pickAudioFile(): Promise<PickedMedia | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, multiple: false });
  if (result.canceled || result.assets.length === 0) return null;
  const a = result.assets[0]!;
  return { uri: a.uri, kind: 'audio', name: a.name, durationMs: null };
}

export interface ImportOutcome {
  assets: MediaAsset[];
  failed: string[];
}

/** Importa em sequência (vídeos grandes em paralelo enchem a memória). */
export async function importAll(
  projectId: string,
  picked: PickedMedia[],
  onProgress: (done: number, total: number) => void,
): Promise<ImportOutcome> {
  const assets: MediaAsset[] = [];
  const failed: string[] = [];
  for (let i = 0; i < picked.length; i++) {
    const item = picked[i]!;
    try {
      assets.push(await importMedia(projectId, item));
    } catch {
      failed.push(item.name);
    }
    onProgress(i + 1, picked.length);
  }
  return { assets, failed };
}
