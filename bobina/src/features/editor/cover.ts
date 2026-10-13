import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';

import type { Project } from '@/core/types';
import { fileUri, projectDir } from '@/storage/paths';
import { saveSummary } from '@/storage/projects';

/** Gera `cover.jpg` (capa da tela inicial) a partir do primeiro clipe. */
export async function makeCover(project: Project): Promise<void> {
  const first = project.main[0];
  const asset = first ? project.assets[first.assetId] : undefined;
  if (!first || !asset) return;
  try {
    let source: string;
    if (asset.kind === 'video') {
      const t = project.coverTime ?? first.sourceIn;
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
