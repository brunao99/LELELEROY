import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { FileAudio, Mic, Square, Video } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { addAudio } from '@/core/ops';
import { formatTime } from '@/core/time';
import type { Project } from '@/core/types';
import { importAll, pickAudioFile, pickVisualMedia } from '@/features/media/pick';
import { useEditor } from '@/state/editor';
import { importMedia } from '@/storage/media';
import { Button } from '@/ui/Button';
import { Panel } from '@/ui/Panel';
import { Txt } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

import { useEditorRuntime } from '../EditorContext';
import { Note, ToggleRow, usePanelActions } from './common';

export function AudioPanel({ project }: { project: Project }) {
  const { close, showToast } = usePanelActions();
  const applyAdded = useEditor((s) => s.applyAdded);
  const setBusy = useEditor((s) => s.setBusy);
  const { now, player } = useEditorRuntime();
  const [recording, setRecording] = useState(false);

  const importFile = async () => {
    player?.pause();
    const at = now();
    const picked = await pickAudioFile();
    if (!picked) return;
    setBusy({ label: 'Importando áudio', fraction: null });
    try {
      const asset = await importMedia(project.id, picked);
      applyAdded((p) => addAudio(p, asset, at, 'import', picked.name.replace(/\.[^.]+$/, '')), 'audio');
      close();
    } catch {
      showToast('Não foi possível abrir este áudio. Arquivos com proteção (DRM) de apps de música não funcionam.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const extractFromVideo = async () => {
    player?.pause();
    const at = now();
    const picked = await pickVisualMedia({ multiple: false, videosOnly: true });
    if (picked.length === 0) return;
    setBusy({ label: 'Importando vídeo', fraction: null });
    try {
      const { assets } = await importAll(project.id, picked, () => {});
      const asset = assets[0];
      if (!asset) throw new Error('falhou');
      if (!asset.hasAudio) {
        showToast('Este vídeo não tem som.');
        return;
      }
      applyAdded((p) => addAudio(p, asset, at, 'extract', `Áudio de ${asset.originalName.replace(/\.[^.]+$/, '')}`), 'audio');
      close();
    } catch {
      showToast('Não foi possível abrir este vídeo.', 'error');
    } finally {
      setBusy(null);
    }
  };

  if (recording) return <VoiceoverRecorder project={project} onClose={() => setRecording(false)} />;

  return (
    <Panel title="Áudio" onDone={close}>
      <View style={styles.options}>
        <Button label="Música ou som do aparelho" icon={FileAudio} variant="secondary" onPress={importFile} />
        <Button label="Gravar narração" icon={Mic} variant="secondary" onPress={() => setRecording(true)} />
        <Button label="Usar o som de outro vídeo" icon={Video} variant="secondary" onPress={extractFromVideo} />
      </View>
      <Note>O áudio entra na posição da agulha. Para separar o som de um clipe que já está no projeto, selecione o clipe e toque em “Extrair áudio”.</Note>
    </Panel>
  );
}

function VoiceoverRecorder({ project, onClose }: { project: Project; onClose: () => void }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 200);
  const applyAdded = useEditor((s) => s.applyAdded);
  const showToast = useEditor((s) => s.showToast);
  const setBusy = useEditor((s) => s.setBusy);
  const { now, player } = useEditorRuntime();
  const [playAlong, setPlayAlong] = useState(false);
  const startAt = useRef(0);

  const start = async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Microfone bloqueado', 'Para gravar a narração, libere o microfone para o Bobina nas configurações do aparelho.', [
        { text: 'Agora não', style: 'cancel' },
        { text: 'Abrir configurações', onPress: () => Linking.openSettings() },
      ]);
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      startAt.current = now();
      await recorder.prepareToRecordAsync();
      recorder.record();
      if (playAlong) player?.play();
      else player?.pause();
    } catch (e) {
      showToast(`Não foi possível gravar: ${String(e)}`, 'error');
    }
  };

  const stop = async () => {
    player?.pause();
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      if (!uri) throw new Error('sem arquivo');
      setBusy({ label: 'Salvando narração', fraction: null });
      const asset = await importMedia(project.id, { uri, kind: 'audio', name: 'Narração.m4a' });
      applyAdded((p) => addAudio(p, asset, startAt.current, 'voiceover', 'Narração'), 'audio');
      onClose();
    } catch (e) {
      showToast(`A gravação falhou: ${String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Narração" onDone={onClose}>
      <View style={styles.recorder}>
        <Txt variant="display" tabular>
          {formatTime(state.durationMillis * 1000)}
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={state.isRecording ? 'Parar a gravação' : 'Começar a gravar'}
          onPress={state.isRecording ? stop : start}
          style={[styles.recordButton, state.isRecording ? styles.recordButtonOn : null]}
        >
          {state.isRecording ? <Square size={28} color={colors.text} fill={colors.text} /> : <Mic size={30} color={colors.onTrack} />}
        </Pressable>
        <Txt variant="sm" tone="muted">
          {state.isRecording ? 'Gravando… toque para parar' : 'Toque para gravar a partir da agulha'}
        </Txt>
      </View>
      <ToggleRow
        label="Tocar o vídeo enquanto grava"
        hint="Use fone de ouvido para o som do vídeo não entrar na gravação."
        value={playAlong}
        onChange={setPlayAlong}
      />
    </Panel>
  );
}

const styles = StyleSheet.create({
  options: { paddingHorizontal: space[4], gap: space[3] },
  recorder: { alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  recordButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButtonOn: { backgroundColor: colors.surfaceRaised, borderWidth: 3, borderColor: colors.danger },
});
