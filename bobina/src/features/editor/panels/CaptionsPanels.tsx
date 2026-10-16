import { AlertTriangle, Combine, Scissors, Trash2 } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { CAPTION_LANGUAGES, WHISPER_MODELS } from '@/core/captions';
import {
  dismissCaptionsWarning,
  mergeCaptionWithNext,
  removeItem,
  setCaptionHighlight,
  setCaptionPosition,
  setCaptionStyle,
  setCaptions,
  splitCaptionAtChar,
  updateCaptionText,
} from '@/core/ops';
import { formatTime } from '@/core/time';
import type { Caption, CaptionSource, Project } from '@/core/types';
import { NoSpeechError, downloadModel, isModelReady, transcribeProject } from '@/engine/captions';
import { useEditor } from '@/state/editor';
import { Button, IconButton, Row } from '@/ui/Button';
import { ChoiceRow } from '@/ui/Chip';
import { ColorRow } from '@/ui/ColorRow';
import { EmptyState, ProgressBar } from '@/ui/Feedback';
import { Panel, SectionLabel } from '@/ui/Panel';
import { Slider } from '@/ui/Slider';
import { Txt } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

import { useEditorRuntime } from '../EditorContext';
import { Note, usePanelActions } from './common';
import { TextStyleEditor } from './TextPanel';

type Status =
  | { stage: 'idle' }
  | { stage: 'downloading' | 'audio' | 'transcribing'; fraction: number | null }
  | { stage: 'done'; count: number }
  | { stage: 'error'; message: string };

const STAGE_LABEL = {
  downloading: 'Baixando o modelo de reconhecimento de fala',
  audio: 'Lendo o áudio',
  transcribing: 'Reconhecendo a fala',
} as const;

function confirm(title: string, message: string, ok: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
      { text: ok, onPress: () => resolve(true) },
    ]),
  );
}

export function CaptionsPanel({ project }: { project: Project }) {
  const { apply, close } = usePanelActions();
  const openPanel = useEditor((s) => s.openPanel);
  const [source, setSource] = useState<CaptionSource>(project.captions.source);
  const [language, setLanguage] = useState(project.captions.language ?? 'pt');
  // O preciso é o recomendado; o rápido fica como padrão só se for o único já baixado.
  const [modelId, setModelId] = useState(() => {
    const precise = WHISPER_MODELS.find((m) => m.id === 'small')!;
    const fast = WHISPER_MODELS.find((m) => m.id === 'base')!;
    return !isModelReady(precise) && isModelReady(fast) ? fast.id : precise.id;
  });
  const [status, setStatus] = useState<Status>({ stage: 'idle' });
  const abort = useRef<AbortController | null>(null);
  const model = WHISPER_MODELS.find((m) => m.id === modelId)!;
  const running = status.stage === 'downloading' || status.stage === 'audio' || status.stage === 'transcribing';
  const existing = project.captions.items.length;

  const generate = async () => {
    if (existing > 0 && !(await confirm('Substituir legendas?', `As ${existing} legendas atuais serão trocadas pelas novas.`, 'Substituir'))) return;
    if (!isModelReady(model)) {
      const ok = await confirm(
        'Baixar o modelo?',
        `O reconhecimento de fala roda no seu celular. Ele precisa baixar uma vez o modelo "${model.name}" (${model.megabytes} MB). Depois funciona sem internet.`,
        'Baixar',
      );
      if (!ok) return;
    }
    const controller = new AbortController();
    abort.current = controller;
    try {
      if (!isModelReady(model)) {
        setStatus({ stage: 'downloading', fraction: 0 });
        await downloadModel(model, (fraction) => setStatus({ stage: 'downloading', fraction }), controller.signal);
      }
      setStatus({ stage: 'audio', fraction: 0 });
      const captions = await transcribeProject(
        project,
        { source, language, model },
        (p) => setStatus({ stage: p.stage, fraction: p.fraction }),
        controller.signal,
      );
      apply((p) => setCaptions(p, captions, language, source));
      setStatus({ stage: 'done', count: captions.length });
    } catch (e) {
      if (controller.signal.aborted) setStatus({ stage: 'idle' });
      else if (e instanceof NoSpeechError) setStatus({ stage: 'error', message: e.message });
      else setStatus({ stage: 'error', message: `Não deu certo: ${String(e)}` });
    } finally {
      abort.current = null;
    }
  };

  return (
    <Panel title="Legendas automáticas" onDone={close}>
      {project.captions.maybeOutOfSync && existing > 0 ? (
        <View style={styles.warning}>
          <AlertTriangle size={18} color={colors.accent} />
          <Txt variant="sm" style={{ flex: 1 }}>
            Você mudou cortes ou velocidades depois de gerar as legendas. Elas podem estar fora de tempo.
          </Txt>
          <Button label="Ok" size="sm" variant="ghost" onPress={() => apply((p) => dismissCaptionsWarning(p))} />
        </View>
      ) : null}
      <SectionLabel>De onde vem a fala</SectionLabel>
      <ChoiceRow
        options={[
          { value: 'video' as const, label: 'Som dos vídeos' },
          { value: 'voiceover' as const, label: 'Narração' },
          { value: 'both' as const, label: 'Os dois' },
        ]}
        value={source}
        onChange={setSource}
      />
      <SectionLabel>Idioma</SectionLabel>
      <ChoiceRow options={CAPTION_LANGUAGES.map((l) => ({ value: l.code, label: l.name }))} value={language} onChange={setLanguage} />
      <SectionLabel>Precisão</SectionLabel>
      <ChoiceRow
        options={WHISPER_MODELS.map((m) => ({ value: m.id, label: `${m.name}${isModelReady(m) ? '' : ` · ${m.megabytes} MB`}` }))}
        value={modelId}
        onChange={setModelId}
      />
      <Note>
        {modelId === 'small'
          ? 'Reconhece melhor sotaques, nomes e fala rápida. Demora mais para gerar.'
          : 'Gera mais rápido, mas erra mais palavras. Bom para fala clara e sem barulho.'}
      </Note>
      {running ? (
        <View style={styles.status}>
          <Txt variant="sm">{STAGE_LABEL[status.stage as keyof typeof STAGE_LABEL]}</Txt>
          <ProgressBar fraction={'fraction' in status ? status.fraction : null} />
          <Button label="Cancelar" variant="ghost" size="sm" onPress={() => abort.current?.abort()} />
        </View>
      ) : (
        <Row style={{ paddingHorizontal: space[4] }}>
          <Button label={existing ? 'Gerar de novo' : 'Gerar legendas'} onPress={generate} />
          {existing ? <Button label="Editar legendas" variant="secondary" onPress={() => openPanel('captionsBatch')} /> : null}
        </Row>
      )}
      {status.stage === 'done' ? <Note>{status.count} legendas criadas. Toque numa legenda na timeline para editar ou mudar o estilo.</Note> : null}
      {status.stage === 'error' ? (
        <Txt variant="sm" tone="danger" style={{ paddingHorizontal: space[4] }}>
          {status.message}
        </Txt>
      ) : null}
      <Note>Tudo acontece no seu celular: o áudio não é enviado para nenhum servidor.</Note>
    </Panel>
  );
}

function CaptionRow({ caption, isLast, onSeek }: { caption: Caption; isLast: boolean; onSeek: (t: number) => void }) {
  const apply = useEditor((s) => s.apply);
  const endGesture = useEditor((s) => s.endGesture);
  const showToast = useEditor((s) => s.showToast);
  const [text, setText] = useState(caption.text);
  const cursor = useRef(0);
  return (
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Ir para ${formatTime(caption.start)}`} onPress={() => onSeek(caption.start)}>
        <Txt variant="xs" tone="accent" tabular>
          {formatTime(caption.start)}
        </Txt>
      </Pressable>
      <TextInput
        value={text}
        multiline
        onChangeText={(t) => {
          setText(t);
          apply((p) => updateCaptionText(p, caption.id, t), { key: `caption:${caption.id}` });
        }}
        onSelectionChange={(e) => {
          cursor.current = e.nativeEvent.selection.start;
        }}
        onBlur={endGesture}
        style={styles.captionInput}
        accessibilityLabel={`Legenda em ${formatTime(caption.start)}`}
      />
      <View style={styles.rowActions}>
        <IconButton
          icon={Scissors}
          label="Dividir no cursor"
          size={18}
          onPress={() => {
            const at = cursor.current;
            let ok = false;
            apply((p) => {
              const r = splitCaptionAtChar(p, caption.id, at);
              ok = !!r;
              return r ? r.project : p;
            });
            if (!ok) showToast('Ponha o cursor no meio do texto para dividir.');
          }}
        />
        <IconButton icon={Combine} label="Juntar com a próxima" size={18} disabled={isLast} onPress={() => apply((p) => mergeCaptionWithNext(p, caption.id))} />
        <IconButton icon={Trash2} label="Excluir legenda" size={18} color={colors.danger} onPress={() => apply((p) => removeItem(p, caption.id))} />
      </View>
    </View>
  );
}

export function CaptionsBatchPanel({ project }: { project: Project }) {
  const { close } = usePanelActions();
  const { seek } = useEditorRuntime();
  const items = project.captions.items;
  return (
    <Panel title={`Legendas (${items.length})`} onDone={close} scroll={false}>
      {items.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="Sem legendas" text="Gere as legendas automáticas primeiro." />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: space[2], paddingBottom: space[6] }}
          renderItem={({ item, index }) => <CaptionRow caption={item} isLast={index === items.length - 1} onSeek={seek} />}
        />
      )}
    </Panel>
  );
}

const HIGHLIGHTS = [
  { value: 'none' as const, label: 'Nenhum' },
  { value: 'color' as const, label: 'Cor da palavra' },
  { value: 'box' as const, label: 'Fundo na palavra' },
];

export function CaptionStylePanel({ project }: { project: Project }) {
  const { apply, endGesture, close } = usePanelActions();
  const highlight = project.captions.highlight ?? null;
  const timed = project.captions.items.some((c) => c.words && c.words.length > 0);
  return (
    <Panel title="Estilo das legendas" onDone={close}>
      <Note>Vale para todas as legendas.</Note>
      <SectionLabel>Destaque da palavra falada</SectionLabel>
      <ChoiceRow
        options={HIGHLIGHTS}
        value={highlight?.mode ?? 'none'}
        onChange={(v) =>
          apply((p) => setCaptionHighlight(p, v === 'none' ? null : { mode: v, color: highlight?.color ?? (v === 'box' ? '#ffb547' : '#ffd84d') }))
        }
      />
      {highlight ? (
        <ColorRow label="Cor do destaque" value={highlight.color} onChange={(c) => apply((p) => setCaptionHighlight(p, { ...highlight, color: c }))} />
      ) : null}
      {highlight && !timed ? (
        <Note>Precisa do tempo de cada palavra: gere as legendas de novo pelo reconhecimento automático.</Note>
      ) : null}
      <SectionLabel>Texto</SectionLabel>
      <TextStyleEditor
        style={project.captions.style}
        keyPrefix="captions"
        onChange={(patch, key) => apply((p) => setCaptionStyle(p, patch), key ? { key } : undefined)}
        onCommit={endGesture}
      />
      <Slider
        label="Altura na tela"
        value={Math.round(project.captions.position.y * 100)}
        min={-45}
        max={45}
        defaultValue={30}
        step={1}
        centered
        format={(v) => (v > 20 ? 'Embaixo' : v < -20 ? 'Em cima' : 'Meio')}
        onChange={(v) => apply((p) => setCaptionPosition(p, { x: 0, y: v / 100 }), { key: 'captions:position' })}
        onCommit={endGesture}
      />
    </Panel>
  );
}

const styles = StyleSheet.create({
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginHorizontal: space[4],
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  status: { paddingHorizontal: space[4], gap: space[2] },
  row: {
    marginHorizontal: space[3],
    padding: space[2],
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    gap: space[1],
  },
  captionInput: { color: colors.text, fontSize: 15, paddingVertical: 4 },
  rowActions: { flexDirection: 'row', justifyContent: 'flex-end' },
});
