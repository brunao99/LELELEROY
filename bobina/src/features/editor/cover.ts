import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';

import { layoutMain, mainSlotAt, sourceTimeAt } from '@/core/timeline';
import type { Project } from '@/core/types';
import { fileUri, projectDir } from '@/storage/paths';
import { saveSummary } from '@/storage/projects';

/**
 * Gera `cover.jpg` (capa em Meus projetos) do instante escolhido em
 * `coverTime`, ou do começo do primeiro clipe.
 */
export async function makeCover(project: Project): Promise<void> {
  const slots = layoutMain(project);
  const slot = (project.coverTime !== null ? mainSlotAt(slots, project.coverTime) : undefined) ?? slots[0];
  const asset = slot ? project.assets[slot.clip.assetId] : undefined;
  if (!slot || !asset) return;
  try {
    let source: string;
    if (asset.kind === 'video') {
      const local = project.coverTime !== null ? Math.max(0, project.coverTime - slot.start) : 0;
      const t = sourceTimeAt(slot.clip, local);
      const thumb = await VideoThumbnails.getThumbnailAsync(fileUri(project.id, asset.file), { time: Math.round(t / 1000), quality: 0.6 });
      source = thumb.uri;
    } else {
      source = fileUri(project.id, asset.file);
    }
    const image = await ImageManipulator.manipulate(source).resize({ width: 480 }).renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
    new File(saved.uri).moveSync(new File(projectDir(project.id), 'cover.jpg'), { overwrite: true });
    saveSummary(project);
  } catch {
    // Sem capa: a tela inicial mostra um ícone.
  }
}

/** Endereço da capa atual, se existir. */
export function coverUri(projectId: string): string | null {
  const file = new File(projectDir(projectId), 'cover.jpg');
  return file.exists ? file.uri : null;
}
