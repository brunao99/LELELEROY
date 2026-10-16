/**
 * Colagens no disco, separadas dos projetos de vídeo: uma pasta por colagem com
 * `collage.json`, `summary.json` (para a lista), `cover.jpg`, as fotos em
 * `media/` (inteira + cópia menor para a tela) e as figurinhas em `stickers/`.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { COLLAGE_SCHEMA, collageFiles, type Collage, type CollagePhoto, type CollageRatio } from '@/core/collage';
import { newId } from '@/core/ids';

import type { PickedMedia } from './media';
import { ensureDir } from './paths';
import { ProjectFormatError, writeAtomic } from './projects';

/** Lado maior da foto guardada e da cópia da tela. */
const MAX_SIDE = 4096;
const PREVIEW_SIDE = 1600;

export function collagesRoot(): Directory {
  return new Directory(Paths.document, 'collages');
}

export function collageDir(id: string): Directory {
  return new Directory(Paths.document, 'collages', id);
}

/** Arquivo da colagem a partir do caminho relativo (`media/abc.jpg`). */
export function collageFile(id: string, relative: string): File {
  return new File(collageDir(id), ...relative.split('/'));
}

export function collageUri(id: string, relative: string): string {
  return collageFile(id, relative).uri;
}

export interface CollageSummary {
  id: string;
  name: string;
  updatedAt: number;
  ratio: CollageRatio;
  /** `cover.jpg` ou null. */
  cover: string | null;
  photoCount: number;
}

function summaryOf(c: Collage, hasCover: boolean): CollageSummary {
  return {
    id: c.id,
    name: c.name,
    updatedAt: c.updatedAt,
    ratio: c.ratio,
    cover: hasCover ? 'cover.jpg' : null,
    photoCount: Object.keys(c.photos).length,
  };
}

export function saveCollage(c: Collage): void {
  const dir = ensureDir(collageDir(c.id));
  writeAtomic(dir, 'collage.json', JSON.stringify(c));
  writeAtomic(dir, 'summary.json', JSON.stringify(summaryOf(c, new File(dir, 'cover.jpg').exists)));
}

/** Só o resumo (depois de gerar a capa). */
export function saveCollageSummary(c: Collage): void {
  const dir = ensureDir(collageDir(c.id));
  writeAtomic(dir, 'summary.json', JSON.stringify(summaryOf(c, new File(dir, 'cover.jpg').exists)));
}

export async function loadCollage(id: string): Promise<Collage> {
  const file = new File(collageDir(id), 'collage.json');
  if (!file.exists) throw new ProjectFormatError('A colagem não foi encontrada.');
  const data = JSON.parse(await file.text()) as Partial<Collage>;
  if (data.kind !== 'collage' || data.schemaVersion !== COLLAGE_SCHEMA) {
    throw new ProjectFormatError(`Versão de colagem desconhecida: ${String(data.schemaVersion)}.`);
  }
  return data as Collage;
}

export async function listCollages(): Promise<CollageSummary[]> {
  const root = collagesRoot();
  if (!root.exists) return [];
  const out: CollageSummary[] = [];
  for (const entry of root.list()) {
    if (!(entry instanceof Directory)) continue;
    const summary = new File(entry, 'summary.json');
    if (!summary.exists) continue;
    try {
      out.push(JSON.parse(await summary.text()) as CollageSummary);
    } catch {
      // Resumo corrompido: volta quando a colagem for salva de novo.
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteCollage(id: string): void {
  const dir = collageDir(id);
  if (dir.exists) dir.delete();
}

export async function duplicateCollage(id: string, now: number): Promise<void> {
  const source = await loadCollage(id);
  const copyId = newId('c');
  collageDir(id).copySync(collageDir(copyId));
  saveCollage({ ...source, id: copyId, name: `${source.name} (cópia)`, createdAt: now, updatedAt: now });
}

export async function renameCollageOnDisk(id: string, name: string, now: number): Promise<void> {
  const c = await loadCollage(id);
  const trimmed = name.trim();
  if (!trimmed) return;
  saveCollage({ ...c, name: trimmed, updatedAt: now });
}

/**
 * Copia a foto para a colagem: inteira (até 4096 px, JPEG, com a orientação
 * já aplicada) e uma cópia de até 1600 px para a tela.
 */
export async function importCollagePhoto(collageId: string, picked: PickedMedia): Promise<CollagePhoto> {
  ensureDir(new Directory(collageDir(collageId), 'media'));
  const id = newId('f');
  const context = ImageManipulator.manipulate(picked.uri);
  const w = picked.width ?? 0;
  const h = picked.height ?? 0;
  if (Math.max(w, h) > MAX_SIDE) context.resize(w >= h ? { width: MAX_SIDE } : { height: MAX_SIDE });
  const full = await (await context.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
  const file = `media/${id}.jpg`;
  new File(full.uri).moveSync(collageFile(collageId, file), { overwrite: true });

  const preview = `media/${id}-s.jpg`;
  if (Math.max(full.width, full.height) > PREVIEW_SIDE) {
    const small = ImageManipulator.manipulate(collageUri(collageId, file));
    small.resize(full.width >= full.height ? { width: PREVIEW_SIDE } : { height: PREVIEW_SIDE });
    const saved = await (await small.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.88 });
    new File(saved.uri).moveSync(collageFile(collageId, preview), { overwrite: true });
  } else {
    collageFile(collageId, file).copySync(collageFile(collageId, preview), { overwrite: true });
  }
  return { id, file, preview, width: full.width, height: full.height };
}

/**
 * Apaga fotos e figurinhas que a colagem não usa mais (só ao abrir, quando
 * ainda não há desfazer que precise delas).
 */
export function pruneCollageFiles(c: Collage): void {
  const keep = collageFiles(c);
  for (const folder of ['media', 'stickers']) {
    const dir = new Directory(collageDir(c.id), folder);
    if (!dir.exists) continue;
    for (const entry of dir.list()) {
      if (entry instanceof Directory || keep.has(`${folder}/${entry.name}`)) continue;
      try {
        entry.delete();
      } catch {
        // Fica para a próxima vez.
      }
    }
  }
}
