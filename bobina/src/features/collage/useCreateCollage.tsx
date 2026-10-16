/**
 * Criar uma colagem: escolher as fotos, importar com progresso e abrir o
 * editor. Até 9 fotos começa numa grade; mais que isso, solta (como um mural).
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { MAX_COLLAGE_PHOTOS, createCollage, defaultCollageName, type CollagePhoto, type CollageRatio } from '@/core/collage';
import { newId } from '@/core/ids';
import { pickVisualMedia } from '@/features/media/pick';
import { deleteCollage, importCollagePhoto, saveCollage } from '@/storage/collages';
import { BrandProgressDialog } from '@/ui/Dialogs';

export function useCreateCollage(onError: (message: string) => void) {
  const router = useRouter();
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);

  const create = async (ratio: CollageRatio = '9:16') => {
    const picked = await pickVisualMedia({ imagesOnly: true, limit: MAX_COLLAGE_PHOTOS });
    if (picked.length === 0) return;
    const id = newId('c');
    const chosen = picked.slice(0, MAX_COLLAGE_PHOTOS);
    setImporting({ done: 0, total: chosen.length });
    try {
      const photos: CollagePhoto[] = [];
      for (let i = 0; i < chosen.length; i++) {
        try {
          photos.push(await importCollagePhoto(id, chosen[i]!));
        } catch {
          // Fica de fora; avisa no fim.
        }
        setImporting({ done: i + 1, total: chosen.length });
      }
      if (photos.length === 0) {
        deleteCollage(id);
        onError('Não foi possível abrir nenhuma das fotos escolhidas.');
        return;
      }
      const now = Date.now();
      saveCollage(createCollage({ id, name: defaultCollageName(now), now, ratio, photos, newId: () => newId('l') }));
      if (photos.length < chosen.length) onError(`${chosen.length - photos.length} foto(s) não abriram e ficaram de fora.`);
      router.push({ pathname: '/colagem/[id]', params: { id } });
    } catch (e) {
      deleteCollage(id);
      onError(`Erro ao importar: ${String(e)}`);
    } finally {
      setImporting(null);
    }
  };

  const dialog = (
    <BrandProgressDialog
      visible={importing !== null}
      title="Importando suas fotos"
      detail={importing ? `${importing.done} de ${importing.total}` : undefined}
      fraction={importing && importing.total > 1 ? importing.done / importing.total : null}
    />
  );

  return { create, dialog, busy: importing !== null };
}
