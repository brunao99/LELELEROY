import { ImagePlus } from 'lucide-react-native';
import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { RATIOS } from '@/core/geometry';
import { TRANSITIONS } from '@/core/motion';
import { addAssets, setBackground, setCoverTime, setRatio, setTransition, setTransitionAll } from '@/core/ops';
import { DEFAULT_TRANSITION, formatTime, sec } from '@/core/time';
import { layoutMain } from '@/core/timeline';
import type { Project, Ratio, TransitionKind } from '@/core/types';
import { importAll, pickVisualMedia } from '@/features/media/pick';
import { useEditor } from '@/state/editor';
import { Button, Row } from '@/ui/Button';
import { ChoiceRow } from '@/ui/Chip';
import { ColorRow } from '@/ui/ColorRow';
import { Panel } from '@/ui/Panel';
import { Slider } from '@/ui/Slider';
import { Tabs } from '@/ui/Tabs';
import { Txt } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

import { coverUri, makeCover } from '../cover';
import { useEditorRuntime } from '../EditorContext';
import { Note, usePanelActions } from './common';

/** Capa do projeto em Meus projetos: o quadro da agulha ou o começo do vídeo. */
export function CoverPanel({ project }: { project: Project }) {
  const { apply, close } = usePanelActions();
  const { now, player } = useEditorRuntime();
  const [uri, setUri] = useState(() => coverUri(project.id));
  const [version, setVersion] = useState(0);
  const [working, setWorking] = useState(false);

  /** Muda o instante da capa e gera a imagem de novo. */
  const choose = async (t: number | null) => {
    apply((p) => setCoverTime(p, t));
    const current = useEditor.getState().history?.present;
    if (!current) return;
    setWorking(true);
    try {
      await makeCover(current);
      setUri(coverUri(project.id));
      setVersion((v) => v + 1);
    } finally {
      setWorking(false);
    }
  };

  return (
    <Panel title="Capa" onDone={close}>
      <View style={styles.coverRow}>
        <View style={styles.coverThumb}>
          {uri ? <Image key={version} source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel="Capa atual" /> : null}
        </View>
        <View style={{ flex: 1, gap: space[1] }}>
          <Txt variant="sm" weight="600">
            {project.coverTime === null ? 'Começo do vídeo' : `Quadro em ${formatTime(project.coverTime, false)}`}
          </Txt>
          <Txt variant="xs" tone="muted">
            {working ? 'Atualizando…' : 'Aparece em Meus projetos.'}
          </Txt>
        </View>
      </View>
      <Row style={{ paddingHorizontal: space[4] }}>
        <Button
          label="Usar o quadro da agulha"
          disabled={working}
          onPress={() => {
            player?.pause();
            choose(now()).catch(() => {});
          }}
        />
        {project.coverTime !== null ? (
          <Button label="Voltar ao começo" variant="ghost" disabled={working} onPress={() => choose(null).catch(() => {})} />
        ) : null}
      </Row>
      <Note>Mova a agulha até o quadro que quer como capa e toque em “Usar o quadro da agulha”.</Note>
    </Panel>
  );
}

export function TransitionPanel({ project }: { project: Project }) {
  const target = useEditor((s) => s.panelTarget);
  const { apply, endGesture, close, showToast } = usePanelActions();
  const slot = layoutMain(project).find((s) => s.clip.id === target);
  if (!slot || !target) return null;
  const current = slot.clip.transitionOut;
  const kind: TransitionKind | 'none' = current?.kind ?? 'none';
  const duration = current?.duration ?? DEFAULT_TRANSITION;
  return (
    <Panel
      title="Transição"
      onDone={close}
      footer={{
        label: 'Aplicar a todos os cortes',
        onPress: () => {
          apply((p) => setTransitionAll(p, current ? { ...current } : null));
          showToast(current ? 'Transição aplicada a todos os cortes.' : 'Transições removidas.');
        },
      }}
    >
      <ChoiceRow
        options={[{ value: 'none' as const, label: 'Nenhuma' }, ...TRANSITIONS.map((t) => ({ value: t.kind, label: t.name }))]}
        value={kind}
        onChange={(v) => apply((p) => setTransition(p, target, v === 'none' ? null : { kind: v, duration }))}
      />
      <Slider
        label="Duração"
        value={duration / 1_000_000}
        min={0.1}
        max={2}
        defaultValue={0.5}
        step={0.1}
        disabled={!current}
        format={(v) => `${v.toFixed(1).replace('.', ',')}s`}
        onChange={(v) => current && apply((p) => setTransition(p, target, { kind: current.kind, duration: sec(v) }), { key: `transition:${target}` })}
        onCommit={endGesture}
      />
      {current && slot.transitionOut && slot.transitionOut.duration < current.duration ? (
        <Note>Os clipes são curtos: a transição fica com {(slot.transitionOut.duration / 1_000_000).toFixed(1).replace('.', ',')}s.</Note>
      ) : null}
    </Panel>
  );
}

const RATIO_LABEL: Record<Ratio, string> = {
  original: 'Original',
  '9:16': '9:16 Stories',
  '16:9': '16:9 YouTube',
  '1:1': '1:1 Quadrado',
  '4:3': '4:3',
  '3:4': '3:4',
  '4:5': '4:5 Feed',
};

export function FormatPanel({ project }: { project: Project }) {
  const { apply, close } = usePanelActions();
  return (
    <Panel title="Formato" onDone={close}>
      <ChoiceRow options={RATIOS.map((r) => ({ value: r, label: RATIO_LABEL[r] }))} value={project.ratio} onChange={(v) => apply((p) => setRatio(p, v))} />
      <Note>“Original” segue o primeiro clipe. O que sobrar em volta do vídeo é preenchido pelo fundo.</Note>
    </Panel>
  );
}

type BgTab = 'blur' | 'color' | 'image';

export function BackgroundPanel({ project }: { project: Project }) {
  const { apply, endGesture, close, showToast } = usePanelActions();
  const setBusy = useEditor((s) => s.setBusy);
  const bg = project.background;
  const [tab, setTab] = useState<BgTab>(bg.kind);
  const pickImage = async () => {
    const picked = await pickVisualMedia({ multiple: false });
    const image = picked.find((p) => p.kind === 'image');
    if (!image) {
      if (picked.length) showToast('Escolha uma foto.');
      return;
    }
    setBusy({ label: 'Importando', fraction: null });
    try {
      const { assets } = await importAll(project.id, [image], () => {});
      const asset = assets[0];
      if (asset) apply((p) => setBackground(addAssets(p, [asset]), { kind: 'image', assetId: asset.id }));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Panel title="Fundo" onDone={close}>
      <Tabs
        tabs={[
          { id: 'blur', label: 'Desfoque' },
          { id: 'color', label: 'Cor' },
          { id: 'image', label: 'Imagem' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'blur' ? (
        <Slider
          label="Desfoque"
          value={Math.round((bg.kind === 'blur' ? bg.amount : 0.5) * 100)}
          min={0}
          max={100}
          defaultValue={50}
          step={1}
          format={(v) => `${Math.round(v)}%`}
          onChange={(v) => apply((p) => setBackground(p, { kind: 'blur', amount: v / 100 }), { key: 'bg:blur' })}
          onCommit={endGesture}
        />
      ) : tab === 'color' ? (
        <ColorRow label="Cor do fundo" value={bg.kind === 'color' ? bg.color : null} onChange={(c) => apply((p) => setBackground(p, { kind: 'color', color: c }))} />
      ) : (
        <Row style={{ paddingHorizontal: space[4] }}>
          <Button label={bg.kind === 'image' ? 'Trocar foto' : 'Escolher foto'} icon={ImagePlus} variant="secondary" onPress={pickImage} />
        </Row>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  coverRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4] },
  coverThumb: {
    width: 72,
    height: 96,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
  },
});
