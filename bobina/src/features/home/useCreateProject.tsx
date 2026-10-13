/**
 * Criar um projeto: escolher mídias, importar com progresso e abrir o editor.
 * Usado pela aba Criar (com ou sem formato escolhido) e pelo estado vazio de
 * Meus projetos.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { createProject, defaultProjectName } from '@/core/defaults';
import { newId } from '@/core/ids';
import { setRatio } from '@/core/ops';
import type { Ratio } from '@/core/types';
import { importAll, pickVisualMedia } from '@/features/media/pick';
import { deleteProject, saveProject } from '@/storage/projects';
import { ProgressDialog } from '@/ui/Dialogs';

export function useCreateProject(onError: (message: string) => void) {
  const router = useRouter();
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);

  const create = async (ratio: Ratio = 'original') => {
    const picked = await pickVisualMedia();
    if (picked.length === 0) return;
    const id = newId('p');
    setImporting({ done: 0, total: picked.length });
    try {
      const { assets, failed } = await importAll(id, picked, (done, total) => setImporting({ done, total }));
      if (assets.length === 0) {
        deleteProject(id);
        onError('Não foi possível abrir nenhuma das mídias escolhidas.');
        return;
      }
      const now = Date.now();
      saveProject(setRatio(createProject({ id, name: defaultProjectName(now), now, assets }), ratio));
      if (failed.length) onError(`${failed.length} mídia(s) não abriram e ficaram de fora.`);
      router.push({ pathname: '/editor/[id]', params: { id } });
    } catch (e) {
      deleteProject(id);
      onError(`Erro ao importar: ${String(e)}`);
    } finally {
      setImporting(null);
    }
  };

  const dialog = (
    <ProgressDialog
      visible={importing !== null}
      title="Importando mídias"
      detail={importing ? `${importing.done} de ${importing.total}` : undefined}
      fraction={importing ? importing.done / Math.max(1, importing.total) : null}
    />
  );

  return { create, dialog, busy: importing !== null };
}
