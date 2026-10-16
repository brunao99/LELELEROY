/**
 * "Baixar MP3" de um clipe: converte com progresso (e cancelar) e, no fim,
 * pergunta se salva numa pasta do aparelho ou compartilha.
 */
import { useRef, useState } from 'react';
import { Alert } from 'react-native';

import { findItem } from '@/core/ops';
import type { AudioClip, MainClip, OverlayClip, Project } from '@/core/types';
import { exportClipMp3, saveMp3ToFolder, shareMp3, type Mp3Result } from '@/engine/mp3Export';
import { useEditor } from '@/state/editor';
import { BrandProgressDialog } from '@/ui/Dialogs';

function offerSave(result: Mp3Result, toast: (message: string, kind?: 'info' | 'error') => void) {
  Alert.alert('MP3 pronto', `${result.name}\nO que fazer com ele?`, [
    { text: 'Fechar', style: 'cancel' },
    { text: 'Compartilhar', onPress: () => shareMp3(result).catch((e) => toast(`Não foi possível compartilhar: ${String(e)}`, 'error')) },
    {
      text: 'Salvar numa pasta',
      onPress: () =>
        saveMp3ToFolder(result)
          .then((saved) => saved && toast('MP3 salvo na pasta escolhida.'))
          .catch((e) => toast(`Não foi possível salvar: ${String(e)}`, 'error')),
    },
  ]);
}

export function useMp3Download(project: Project) {
  const showToast = useEditor((s) => s.showToast);
  const [progress, setProgress] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  const download = async (id: string) => {
    const found = findItem(project, id);
    if (!found || (found.kind !== 'main' && found.kind !== 'overlay' && found.kind !== 'audio')) return;
    const clip = found.item as MainClip | OverlayClip | AudioClip;
    const asset = project.assets[clip.assetId];
    if (!asset || (asset.kind !== 'audio' && !asset.hasAudio)) {
      showToast('Este clipe não tem som.');
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setProgress(0);
    try {
      const result = await exportClipMp3(project, clip, setProgress, controller.signal);
      setProgress(null);
      offerSave(result, showToast);
    } catch (e) {
      setProgress(null);
      if (!controller.signal.aborted) showToast(`Não foi possível gerar o MP3: ${String(e)}`, 'error');
    } finally {
      abort.current = null;
    }
  };

  const dialog = (
    <BrandProgressDialog
      visible={progress !== null}
      title="Gerando o MP3"
      fraction={progress}
      detail={progress !== null ? `${Math.round(progress * 100)}%` : undefined}
      onCancel={() => abort.current?.abort()}
    />
  );
  return { download, dialog };
}
