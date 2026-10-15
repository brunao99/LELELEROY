/**
 * Exportar (S17): escolher resolução e fps, gerar o MP4, salvar na galeria e
 * compartilhar. A tela fica ligada durante a exportação.
 */
import { useFonts } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { ArrowLeft, Share2 } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { buildComposition } from '@/core/composition';
import { countUnavailable } from '@/core/files';
import { exportBitRate, exportSize, sourceShortSide } from '@/core/geometry';
import { setExportSettings } from '@/core/ops';
import { buildRenderPlan } from '@/core/renderPlan';
import { formatTime } from '@/core/time';
import type { ExportFps, ExportResolution, Project } from '@/core/types';
import { runAudioRender, runBake } from '@/engine/bake';
import { ExportCancelled, encoderConfig, renderVideo } from '@/engine/exporter';
import { FONT_SOURCES } from '@/engine/fonts';
import { buildAllText, imageAssetIds, loadImages } from '@/engine/resources';
import { gradeEffect } from '@/engine/shaders';
import { absolutePath, ensureDir, exportsDir, toPlainPath } from '@/storage/paths';
import { pauseBackgroundWork, useEditor } from '@/state/editor';
import { checkProjectFiles, loadProject, saveProject } from '@/storage/projects';
import { Button, IconButton } from '@/ui/Button';
import { ChoiceRow } from '@/ui/Chip';
import { BrandBurst } from '@/ui/BrandBurst';
import { BrandProgress } from '@/ui/BrandProgress';
import { SectionLabel } from '@/ui/Panel';
import { Txt } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

type Stage =
  | { kind: 'setup' }
  | { kind: 'preparing'; label: string; fraction: number | null }
  | { kind: 'rendering'; fraction: number }
  | { kind: 'saving' }
  | { kind: 'done'; uri: string; savedToGallery: boolean }
  | { kind: 'error'; message: string };

/** Os textos do "vídeo pronto" sobem logo depois do salto da marca. */
const DONE_TEXT = FadeInDown.duration(320).delay(160);
const DONE_ACTIONS = FadeInDown.duration(320).delay(260);

const RESOLUTIONS: { value: ExportResolution; label: string }[] = [
  { value: 720, label: '720p' },
  { value: 1080, label: '1080p' },
  { value: 1440, label: '2K' },
  { value: 2160, label: '4K' },
];
const FPS: ExportFps[] = [24, 25, 30, 50, 60];

export default function ExportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const provider = useFonts(FONT_SOURCES);
  const [project, setProject] = useState<Project | null>(null);
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(() => new Set());
  const [stage, setStage] = useState<Stage>({ kind: 'setup' });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    loadProject(id)
      .then((loaded) => {
        // Sem apagar nada: o editor aberto por baixo ainda pode usar esses arquivos.
        const checked = checkProjectFiles(loaded, { prune: false });
        setUnavailable(new Set(checked.missingAssets));
        setProject(checked.project);
      })
      .catch((e) => setStage({ kind: 'error', message: String(e) }));
  }, [id]);

  useEffect(() => () => abort.current?.abort(), []);

  const settings = project?.exportSettings;
  const size = useMemo(() => (project ? exportSize(project) : null), [project]);
  const duration = useMemo(() => (project ? buildRenderPlan(project).duration : 0), [project]);
  const megabytes = size && settings ? ((exportBitRate(size, settings.fps) + 192_000) * (duration / 1_000_000)) / 8 / 1_000_000 : 0;
  const missingCount = project ? countUnavailable(project, unavailable) : 0;
  // O que o codificador do aparelho aceita de verdade (no Android pode ser menos que o pedido).
  const device = useMemo(
    () => (size && settings ? encoderConfig(size.width, size.height, settings.fps, exportBitRate(size, settings.fps)) : null),
    [size, settings],
  );
  const capped = !!device && !!size && !!settings && (device.width * device.height < size.width * size.height || device.fps < settings.fps);
  const sourceShort = useMemo(() => (project ? sourceShortSide(project) : 0), [project]);
  const upscaled = !!settings && sourceShort > 0 && settings.resolution > sourceShort;

  const update = (patch: Partial<Project['exportSettings']>) => {
    if (!project) return;
    const next = setExportSettings(project, patch);
    setProject(next);
    saveProject(next);
    // O editor continua aberto por baixo e salva por cima: guarda a escolha lá também.
    useEditor.getState().patchSilently((p) => (p.id === next.id ? setExportSettings(p, patch) : p));
  };

  const start = async () => {
    if (!project || !provider || !settings || !size) return;
    const controller = new AbortController();
    abort.current = controller;
    await activateKeepAwakeAsync('export').catch(() => {});
    setStage({ kind: 'preparing', label: 'Preparando', fraction: null });
    const resume = await pauseBackgroundWork();
    try {
      // 1. Velocidades e fades que ainda não foram processados (aproveitando o
      // que o editor terminou depois de abrir esta tela).
      const live = useEditor.getState().history?.present;
      let current =
        live && live.id === project.id
          ? {
              ...project,
              bakes: { ...project.bakes, ...live.bakes },
              audioRenders: { ...project.audioRenders, ...live.audioRenders },
            }
          : project;
      const resolve = (r: string) => absolutePath(current.id, r);
      let pending = buildComposition(current, { resolve, unavailable });
      for (let i = 0; i < pending.missing.length; i++) {
        setStage({ kind: 'preparing', label: 'Aplicando velocidade', fraction: 0 });
        const bake = await runBake(current, pending.missing[i]!, (f) => setStage({ kind: 'preparing', label: pending.missing[i]!.reverse ? 'Invertendo o vídeo' : 'Aplicando velocidade', fraction: f }), controller.signal);
        current = { ...current, bakes: { ...current.bakes, [bake.key]: bake } };
      }
      for (const request of pending.missingAudio) {
        setStage({ kind: 'preparing', label: 'Preparando o áudio', fraction: null });
        const render = await runAudioRender(current, request);
        current = { ...current, audioRenders: { ...current.audioRenders, [render.key]: render } };
      }
      if (current !== project) {
        saveProject(current);
        const done = current;
        useEditor.getState().patchSilently((p) =>
          p.id === done.id
            ? { ...p, bakes: { ...p.bakes, ...done.bakes }, audioRenders: { ...p.audioRenders, ...done.audioRenders } }
            : p,
        );
      }
      pending = buildComposition(current, { resolve, unavailable });
      if (controller.signal.aborted) throw new ExportCancelled();

      // 2. O que desenhar.
      setStage({ kind: 'preparing', label: 'Preparando', fraction: null });
      const plan = buildRenderPlan(current);
      const images = await loadImages(current, imageAssetIds(current));
      const { texts, captions } = buildAllText(plan, provider);
      const composition = pending.composition ?? { duration: plan.duration / 1_000_000, items: [] };

      // 3. Exportar.
      ensureDir(exportsDir());
      const out = new File(exportsDir(), `${current.name.replace(/[^\p{L}\p{N}_ -]/gu, '').trim() || 'video'}-${Date.now()}.mp4`);
      setStage({ kind: 'rendering', fraction: 0 });
      await renderVideo({
        outPath: toPlainPath(out.uri),
        width: size.width,
        height: size.height,
        fps: settings.fps,
        bitRate: exportBitRate(size, settings.fps),
        composition,
        plan,
        resources: { images, texts, captions, grade: gradeEffect() },
        onProgress: (done, total) => setStage({ kind: 'rendering', fraction: done / total }),
        signal: controller.signal,
      });

      // 4. Galeria.
      setStage({ kind: 'saving' });
      let saved = false;
      try {
        const permission = await requestPermissionsAsync(true, ['video']);
        if (permission.granted) {
          await Asset.create(out.uri);
          saved = true;
        }
      } catch {
        saved = false;
      }
      setStage({ kind: 'done', uri: out.uri, savedToGallery: saved });
    } catch (e) {
      if (e instanceof ExportCancelled || controller.signal.aborted) setStage({ kind: 'setup' });
      else setStage({ kind: 'error', message: String(e instanceof Error ? e.message : e) });
    } finally {
      resume();
      abort.current = null;
      deactivateKeepAwake('export').catch(() => {});
    }
  };

  const share = async () => {
    if (stage.kind !== 'done') return;
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(stage.uri, { mimeType: 'video/mp4', dialogTitle: 'Compartilhar vídeo' });
  };

  const busy = stage.kind === 'preparing' || stage.kind === 'rendering' || stage.kind === 'saving';

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + space[4] }]}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} label="Voltar ao editor" onPress={() => router.back()} disabled={busy} />
        <Txt variant="lg" accessibilityRole="header">
          Exportar
        </Txt>
      </View>

      {stage.kind === 'done' ? (
        <View style={styles.center}>
          <BrandBurst size={96} />
          <Animated.View entering={DONE_TEXT} style={styles.doneText}>
            <Txt variant="xl" align="center">
              Vídeo pronto
            </Txt>
            <Txt variant="sm" tone="muted" align="center">
              {stage.savedToGallery
                ? 'Salvo na galeria do aparelho.'
                : 'Não deu para salvar na galeria (permissão negada). Você ainda pode compartilhar o arquivo.'}
            </Txt>
          </Animated.View>
          <Animated.View entering={DONE_ACTIONS} style={styles.doneActions}>
            <Button label="Compartilhar" icon={Share2} size="lg" onPress={share} style={{ alignSelf: 'stretch' }} />
            <Button label="Voltar ao editor" variant="secondary" onPress={() => router.back()} style={{ alignSelf: 'stretch' }} />
            <Button label="Ir para o início" variant="ghost" onPress={() => router.dismissTo('/')} />
          </Animated.View>
        </View>
      ) : busy ? (
        <View style={styles.center}>
          <BrandProgress size={128} progress={stage.kind === 'rendering' ? stage.fraction : stage.kind === 'preparing' ? stage.fraction : null} />
          {stage.kind === 'rendering' ? (
            <Txt variant="display" align="center" tabular accessibilityLabel={`Exportando ${Math.round(stage.fraction * 100)} por cento`}>
              {Math.round(stage.fraction * 100)}%
            </Txt>
          ) : null}
          <Txt variant="lg" align="center">
            {stage.kind === 'rendering' ? 'Exportando' : stage.kind === 'saving' ? 'Salvando na galeria' : stage.label}
          </Txt>
          <Txt variant="sm" tone="muted" align="center">
            {"Mantenha o Ledit's aberto até terminar. Sair do app interrompe a exportação."}
          </Txt>
          {stage.kind !== 'saving' ? <Button label="Cancelar" variant="secondary" onPress={() => abort.current?.abort()} /> : null}
        </View>
      ) : (
        <View style={styles.body}>
          {project && settings && size ? (
            <>
              <View style={styles.summary}>
                <Txt variant="sm" tone="muted">
                  {project.name}
                </Txt>
                <Txt variant="xl" tabular>
                  {formatTime(duration, false)} · {capped && device ? device.width : size.width}×{capped && device ? device.height : size.height}
                </Txt>
                <Txt variant="sm" tone="muted">
                  MP4 (H.264 + AAC) · cerca de {megabytes < 1 ? '<1' : Math.round(megabytes)} MB
                </Txt>
              </View>
              <SectionLabel>Resolução</SectionLabel>
              <ChoiceRow options={RESOLUTIONS} value={settings.resolution} onChange={(v) => update({ resolution: v })} />
              <SectionLabel>Quadros por segundo</SectionLabel>
              <ChoiceRow options={FPS.map((f) => ({ value: f, label: `${f} fps` }))} value={settings.fps} onChange={(v) => update({ fps: v })} />
              {capped && device ? (
                <Txt variant="sm" tone="muted" style={{ paddingHorizontal: space[4] }}>
                  Seu celular exporta no máximo {device.width}×{device.height} a {device.fps} qps. O vídeo vai sair nesse tamanho.
                </Txt>
              ) : null}
              {upscaled ? (
                <Txt variant="sm" tone="muted" style={{ paddingHorizontal: space[4] }}>
                  Seus vídeos têm {sourceShort}p. Exportar acima disso deixa o arquivo maior, sem mais detalhe.
                </Txt>
              ) : null}
              {missingCount > 0 ? (
                <Txt variant="sm" tone="danger" style={{ paddingHorizontal: space[4] }}>
                  {missingCount === 1 ? '1 item está sem a mídia original' : `${missingCount} itens estão sem a mídia original`} e vai
                  sair em preto e sem som. Volte ao editor para substituir.
                </Txt>
              ) : null}
              {settings.resolution >= 1440 && !capped ? (
                <Txt variant="xs" tone="muted" style={{ paddingHorizontal: space[4] }}>
                  2K e 4K dependem do aparelho. Se falhar, tente 1080p.
                </Txt>
              ) : null}
              {stage.kind === 'error' ? (
                <Txt variant="sm" tone="danger" style={{ paddingHorizontal: space[4] }}>
                  A exportação falhou: {stage.message}. Tente de novo ou use uma resolução menor.
                </Txt>
              ) : null}
              <View style={{ flex: 1 }} />
              <Button label="Exportar vídeo" size="lg" onPress={start} disabled={!provider || duration <= 0} style={{ marginHorizontal: space[4] }} />
            </>
          ) : stage.kind === 'error' ? (
            <Txt variant="sm" tone="danger" style={{ padding: space[4] }}>
              {stage.message}
            </Txt>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', gap: space[2], paddingLeft: space[1] },
  body: { flex: 1, gap: space[4], paddingTop: space[2] },
  summary: {
    marginHorizontal: space[4],
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: space[1],
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[4], paddingHorizontal: space[6] },
  doneText: { alignItems: 'center', gap: space[2], marginTop: -space[6] },
  doneActions: { alignSelf: 'stretch', alignItems: 'center', gap: space[3], marginTop: space[2] },
});
