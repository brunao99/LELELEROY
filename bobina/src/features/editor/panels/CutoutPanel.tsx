/**
 * Recorte com laço: baixar o modelo, desenhar o laço (o palco fica sobre o
 * preview), ajustar com toques, aplicar no clipe e, depois, inverter ou suavizar
 * a borda.
 */
import { Lasso, MinusCircle, PlusCircle, Undo2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { itemStartTime, updateVisual } from '@/core/ops';
import { clipDuration, sourceTimeAt } from '@/core/timeline';
import type { MainClip, Micros, OverlayClip, Project } from '@/core/types';
import { CUTOUT_MODEL, downloadCutoutModel, isCutoutModelReady } from '@/engine/cutout';
import { useEditorRuntime } from '@/features/editor/EditorContext';
import { useCutoutEditor, type CutoutTool } from '@/features/editor/cutout/store';
import { Button, Row } from '@/ui/Button';
import { ChoiceRow } from '@/ui/Chip';
import { BrandProgressDialog } from '@/ui/Dialogs';
import { ProgressBar } from '@/ui/Feedback';
import { Panel, SectionLabel } from '@/ui/Panel';
import { Slider } from '@/ui/Slider';
import { Txt } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

import { Note, ToggleRow, usePanelActions, useSelected } from './common';

function etaText(msLeft: number): string {
  const s = Math.round(msLeft / 1000);
  if (s < 50) return 'menos de 1 min';
  const m = Math.round(s / 60);
  return m <= 1 ? 'cerca de 1 min' : `cerca de ${m} min`;
}

export function CutoutPanel({ project }: { project: Project }) {
  const selected = useSelected<MainClip | OverlayClip>(project, ['main', 'overlay']);
  const { apply, endGesture, close, showToast } = usePanelActions();
  const runtime = useEditorRuntime();
  const editing = useCutoutEditor((s) => s.clipId);
  const phase = useCutoutEditor((s) => s.phase);
  const tool = useCutoutEditor((s) => s.tool);
  const progress = useCutoutEditor((s) => s.progress);
  const hasResult = useCutoutEditor((s) => !!s.mask);
  const clicks = useCutoutEditor((s) => s.clicks.length);
  const lassoDrawn = useCutoutEditor((s) => s.lasso.length > 0);
  const { start, setTool, undo, cancelTracking } = useCutoutEditor.getState();
  const [ready, setReady] = useState(isCutoutModelReady);
  const [download, setDownload] = useState<{ fraction: number } | { error: string } | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Fechou o painel (ou trocou de clipe): fecha o laço e solta a memória.
  useEffect(() => () => useCutoutEditor.getState().close(), []);
  const selectedId = selected?.id;
  useEffect(() => {
    const open = useCutoutEditor.getState().clipId;
    if (open && open !== selectedId) useCutoutEditor.getState().close();
  }, [selectedId]);

  if (!selected) return null;
  const { id, item } = selected;
  const asset = project.assets[item.assetId];
  const isVideo = asset?.kind === 'video';
  const cutout = item.cutout ?? null;

  const getModel = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setDownload({ fraction: 0 });
    try {
      await downloadCutoutModel((fraction) => setDownload({ fraction }), controller.signal);
      setDownload(null);
      setReady(isCutoutModelReady());
    } catch (e) {
      setDownload(controller.signal.aborted ? null : { error: `O download não terminou: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      abort.current = null;
    }
  };

  const beginLasso = () => {
    if (!asset || !isVideo) return;
    runtime.player?.pause();
    // O laço vai no quadro da agulha, se ela estiver no clipe; senão, no começo dele.
    const startAt = itemStartTime(project, id) ?? 0;
    const local = runtime.now() - startAt;
    const inside = local >= 0 && local < clipDuration(item);
    if (!inside) runtime.seek(startAt);
    const time: Micros = inside ? sourceTimeAt(item, local) : item.reverse ? item.sourceOut : item.sourceIn;
    start(id, { projectId: project.id, asset, from: item.sourceIn, to: item.sourceOut }, time);
  };

  const applyToClip = async () => {
    const result = await useCutoutEditor.getState().apply();
    if (!result) return;
    apply((p) => updateVisual(p, id, { cutout: result }));
    showToast('Recorte aplicado no clipe.');
  };

  const removeCutout = () =>
    Alert.alert('Tirar o recorte?', 'O clipe volta a aparecer inteiro.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Tirar', style: 'destructive', onPress: () => apply((p) => updateVisual(p, id, { cutout: null })) },
    ]);

  const set = (patch: Partial<NonNullable<typeof cutout>>, key?: string) =>
    cutout && apply((p) => updateVisual(p, id, { cutout: { ...cutout, ...patch } }), key ? { key } : undefined);

  const tracking = phase === 'tracking' && progress;
  const fraction = tracking ? progress.done / Math.max(1, progress.total) : null;
  const left = tracking && progress.msPerFrame > 0 ? (progress.total - progress.done) * progress.msPerFrame : null;

  // ---------------------------------------------------------------- laço aberto
  if (editing === id) {
    const busy = phase === 'opening' || phase === 'thinking';
    return (
      <Panel title="Recorte com laço" onDone={hasResult ? applyToClip : () => useCutoutEditor.getState().close()}>
        <SectionLabel>Ferramenta</SectionLabel>
        <ChoiceRow<CutoutTool>
          options={[
            { value: 'lasso', label: 'Laço' },
            { value: 'include', label: 'Incluir' },
            { value: 'exclude', label: 'Excluir' },
          ]}
          value={tool}
          onChange={(t) => (t === 'lasso' || hasResult) && setTool(t)}
        />
        <View style={styles.tips}>
          <Tip icon={Lasso} text="Contorne o objeto. Não precisa ser exato: a IA acha a borda." />
          <Tip icon={PlusCircle} color={colors.success} text="Incluir: toque numa parte que ficou de fora." />
          <Tip icon={MinusCircle} color={colors.danger} text="Excluir: toque numa parte que entrou sem querer." />
        </View>
        <Row style={{ paddingHorizontal: space[4] }}>
          <Button
            label="Aplicar no clipe"
            onPress={applyToClip}
            disabled={!hasResult || busy}
            loading={busy}
            accessibilityHint="Segue o objeto pelo clipe inteiro e recorta todos os quadros"
          />
          <Button label="Desfazer" icon={Undo2} variant="secondary" onPress={undo} disabled={busy || (!lassoDrawn && clicks === 0)} />
          <Button label="Cancelar" variant="ghost" onPress={() => useCutoutEditor.getState().close()} />
        </Row>
        <Note>
          Depois de aplicar, o Ledit&apos;s segue o objeto quadro a quadro no clipe todo. Leva alguns minutos em clipes longos;
          tudo acontece no seu celular.
        </Note>
        <BrandProgressDialog
          visible={!!tracking}
          title="Recortando o clipe"
          fraction={fraction}
          detail={
            tracking
              ? `${Math.round((fraction ?? 0) * 100)}%${left !== null && progress.done > 2 ? ` · falta ${etaText(left)}` : ''}`
              : undefined
          }
          onCancel={cancelTracking}
        />
      </Panel>
    );
  }

  // ---------------------------------------------------------------- painel normal
  return (
    <Panel title="Recorte com IA" onDone={close}>
      {!isVideo ? (
        <Note>O recorte com laço funciona em clipes de vídeo.</Note>
      ) : !ready ? (
        <View style={styles.card}>
          <Txt variant="base" weight="600">
            Recorte de objetos com laço
          </Txt>
          <Txt variant="sm" tone="muted">
            Contorne uma pessoa, um animal ou um objeto e o Ledit&apos;s tira o fundo em volta, seguindo o objeto pelo vídeo. Usa
            o EdgeTAM, um modelo da Meta que roda no próprio celular. Baixe uma vez ({CUTOUT_MODEL.megabytes} MB); depois funciona
            sem internet.
          </Txt>
          {download && 'fraction' in download ? (
            <View style={{ gap: space[2] }}>
              <ProgressBar fraction={download.fraction} />
              <Button label="Cancelar" variant="ghost" size="sm" onPress={() => abort.current?.abort()} />
            </View>
          ) : (
            <Button label={`Baixar o modelo (${CUTOUT_MODEL.megabytes} MB)`} onPress={getModel} />
          )}
          {download && 'error' in download ? (
            <Txt variant="sm" tone="danger">
              {download.error}
            </Txt>
          ) : null}
        </View>
      ) : cutout ? (
        <>
          <ToggleRow
            label="Inverter"
            hint="Tira o objeto e deixa o resto do vídeo."
            value={cutout.invert}
            onChange={(invert) => set({ invert })}
          />
          <Slider
            label="Borda"
            value={Math.round(cutout.feather * 100)}
            min={0}
            max={100}
            defaultValue={0}
            step={1}
            format={(v) => (v < 1 ? 'Afiada' : `${Math.round(v)}% suave`)}
            onChange={(v) => set({ feather: v / 100 }, `cutout:feather:${id}`)}
            onCommit={endGesture}
          />
          <Row style={{ paddingHorizontal: space[4] }}>
            <Button label="Refazer o laço" icon={Lasso} variant="secondary" onPress={beginLasso} />
            <Button label="Tirar o recorte" variant="ghost" onPress={removeCutout} />
          </Row>
          <Note>A borda afiada segue o contorno da imagem; a suave ajuda em cabelo e movimento rápido.</Note>
        </>
      ) : (
        <>
          <Txt variant="sm" tone="muted" style={{ paddingHorizontal: space[4] }}>
            Contorne o objeto no quadro e a IA tira o fundo em volta dele no clipe inteiro. Funciona junto com o chroma key e os
            efeitos.
          </Txt>
          <Row style={{ paddingHorizontal: space[4] }}>
            <Button label="Desenhar o laço" icon={Lasso} onPress={beginLasso} />
          </Row>
        </>
      )}
    </Panel>
  );
}

function Tip({ icon: Icon, text, color = colors.accent }: { icon: typeof Lasso; text: string; color?: string }) {
  return (
    <View style={styles.tip}>
      <Icon size={16} color={color} />
      <Txt variant="xs" tone="muted" style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: space[4],
    padding: space[4],
    gap: space[3],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  tips: { paddingHorizontal: space[4], gap: space[2] },
  tip: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
});
