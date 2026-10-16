/**
 * Ações do editor de colagem que passam pelo seletor de fotos, pelo disco ou
 * pelo laço. As edições simples (espelhar, apagar, frente/trás) ficam nos
 * botões; estas precisam de importação e progresso.
 */
import { useCallback } from 'react';

import {
  MAX_COLLAGE_PHOTOS,
  addPhotos,
  addSticker,
  hasLightBackground,
  makeTextLayer,
  setSlot,
  type CollagePhoto,
} from '@/core/collage';
import { DEFAULT_TEXT_STYLE } from '@/core/defaults';
import { newId } from '@/core/ids';
import { useCutoutEditor } from '@/features/editor/cutout/store';
import { pickVisualMedia } from '@/features/media/pick';
import { useCollage } from '@/state/collage';
import { collageUri, importCollagePhoto } from '@/storage/collages';

/** Importa as fotos com progresso; devolve as que abriram. */
async function importPhotos(collageId: string, multiple: boolean, limit: number): Promise<CollagePhoto[]> {
  const { setBusy, showToast } = useCollage.getState();
  const picked = await pickVisualMedia({ imagesOnly: true, multiple, limit });
  if (picked.length === 0) return [];
  const photos: CollagePhoto[] = [];
  let failed = 0;
  setBusy({ label: 'Importando', fraction: 0 });
  try {
    for (let i = 0; i < picked.length; i++) {
      try {
        photos.push(await importCollagePhoto(collageId, picked[i]!));
      } catch {
        failed++;
      }
      setBusy({ label: 'Importando', fraction: (i + 1) / picked.length });
    }
  } finally {
    setBusy(null);
  }
  if (failed > 0) showToast(`${failed} foto(s) não abriram.`, 'error');
  return photos;
}

export const TEXT_PLACEHOLDER = 'Seu texto';

export function useCollageActions(collageId: string) {
  const addMorePhotos = useCallback(async () => {
    const c = useCollage.getState().history?.present;
    if (!c) return;
    const room = MAX_COLLAGE_PHOTOS - Object.keys(c.photos).length;
    if (room <= 0) {
      useCollage.getState().showToast(`A colagem já tem ${MAX_COLLAGE_PHOTOS} fotos.`, 'error');
      return;
    }
    const photos = await importPhotos(collageId, true, room);
    if (photos.length) useCollage.getState().apply((p) => addPhotos(p, photos, () => newId('l')));
  }, [collageId]);

  /** Põe uma foto nova numa célula (vazia ou trocando a que estava). */
  const fillCell = useCallback(
    async (index: number) => {
      const [photo] = await importPhotos(collageId, false, 1);
      if (!photo) return;
      useCollage.getState().apply((p) => setSlot({ ...p, photos: { ...p.photos, [photo.id]: photo } }, index, photo.id));
      useCollage.getState().select({ kind: 'cell', index });
    },
    [collageId],
  );

  const addText = useCallback(() => {
    const id = newId('t');
    useCollage.getState().apply((p) => {
      const light = hasLightBackground(p);
      const style = { ...DEFAULT_TEXT_STYLE, size: 0.08, color: light ? '#111111' : '#ffffff', shadow: light ? null : DEFAULT_TEXT_STYLE.shadow };
      return { ...p, layers: [...p.layers, makeTextLayer(id, TEXT_PLACEHOLDER, style)] };
    });
    useCollage.getState().select({ kind: 'layer', id });
    useCollage.getState().openPanel('text');
  }, []);

  /** Abre o laço numa foto da colagem. */
  const lassoPhoto = useCallback(
    (photoId: string) => {
      const c = useCollage.getState().history?.present;
      const photo = c?.photos[photoId];
      if (!c || !photo) return;
      useCollage.getState().openPanel(null);
      useCutoutEditor.getState().startPhoto(`collage:${photoId}`, collageUri(collageId, photo.file));
    },
    [collageId],
  );

  /** Laço numa foto que ainda não está na colagem (ela entra só como origem da figurinha). */
  const lassoNewPhoto = useCallback(async () => {
    const [photo] = await importPhotos(collageId, false, 1);
    if (!photo) return;
    useCollage.getState().apply((p) => ({ ...p, photos: { ...p.photos, [photo.id]: photo } }));
    useCollage.getState().openPanel(null);
    useCutoutEditor.getState().startPhoto(`collage:${photo.id}`, collageUri(collageId, photo.file));
  }, [collageId]);

  /** Fecha o laço gravando a figurinha e a põe no meio da colagem, selecionada. */
  const finishSticker = useCallback(async () => {
    const sticker = await useCutoutEditor.getState().makeSticker(collageId);
    if (!sticker) return;
    const layerId = newId('l');
    useCollage.getState().apply((p) => addSticker(p, sticker, layerId));
    useCollage.getState().select({ kind: 'layer', id: layerId });
    useCollage.getState().showToast('Figurinha criada. Arraste para posicionar.');
  }, [collageId]);

  return { addMorePhotos, fillCell, addText, lassoPhoto, lassoNewPhoto, finishSticker };
}
