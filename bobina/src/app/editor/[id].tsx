import { useFonts } from '@shopify/react-native-skia';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { AlertTriangle, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { buildComposition } from '@/core/composition';
import { makeMainClip } from '@/core/defaults';
import { countUnavailable } from '@/core/files';
import { addAssets, insertMainClips } from '@/core/ops';
import { buildRenderPlan, type RenderPlan } from '@/core/renderPlan';
import { insertIndexAt } from '@/core/timeline';
import type { Micros, Project } from '@/core/types';
import type { DrawResources } from '@/engine/draw';
import { FONT_SOURCES } from '@/engine/fonts';
import { forgetProjectCache } from '@/engine/mediaCache';
import { usePreviewPlayer } from '@/engine/player';
import { useDrawResources } from '@/engine/resources';
import { EditorContext, type EditorRuntime } from '@/features/editor/EditorContext';
import { PanelSwitch } from '@/features/editor/PanelSwitch';
import { PlaybackBar } from '@/features/editor/PlaybackBar';
import { Preview } from '@/features/editor/Preview';
import { Toolbar } from '@/features/editor/Toolbar';
import { makeCover } from '@/features/editor/cover';
import { Timeline } from '@/features/editor/timeline/Timeline';
import { importAll, pickVisualMedia } from '@/features/media/pick';
import { flushSave, useEditor, useProject } from '@/state/editor';
import { absolutePath } from '@/storage/paths';
import { checkProjectFiles, loadProject, saveProject } from '@/storage/projects';
import { Button, IconButton } from '@/ui/Button';
import { EmptyState, Toast } from '@/ui/Feedback';
import { Txt } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

/**
 * Reduz os vídeos do preview só no iOS. No Android o motor entrega o quadro já em
 * pé e espera a redução nas medidas do arquivo, que o app não guarda lá.
 */
const PREVIEW_MAX_SIDE = Platform.OS === 'ios' ? 1280 : undefined;

export default function EditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const open = useEditor((s) => s.open);
  const project = useProject();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadProject(id)
      .then((loaded) => {
        if (cancelled) return;
        // Caches apagados são refeitos; mídias que sumiram ficam marcadas.
        const { project: p, missingAssets } = checkProjectFiles(loaded, { prune: true });
        if (p !== loaded) saveProject(p);
        open(p, missingAssets);
      })
      .catch((e) => !cancelled && setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
      const current = useEditor.getState().history?.present;
      useEditor.getState().close();
      if (current) makeCover(current).catch(() => {});
      forgetProjectCache(id);
    };
  }, [id, open]);

  if (error) {
    return (
      <View style={[styles.root, { justifyContent: 'center' }]}>
        <EmptyState icon={AlertTriangle} title="Não foi possível abrir o projeto" text={error} action={{ label: 'Voltar', onPress: () => router.back() }} />
      </View>
    );
  }
  if (!project || project.id !== id) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  return <EditorBody project={project} />;
}

function EditorBody({ project }: { project: Project }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const panel = useEditor((s) => s.panel);
  const selection = useEditor((s) => s.selection);
  const toast = useEditor((s) => s.toast);
  const select = useEditor((s) => s.select);
  const openPanel = useEditor((s) => s.openPanel);
  const apply = useEditor((s) => s.apply);
  const setBusy = useEditor((s) => s.setBusy);
  const showToast = useEditor((s) => s.showToast);
  const unavailableIds = useEditor((s) => s.unavailable);
  const unavailable = useMemo(() => new Set(unavailableIds), [unavailableIds]);
  const missingCount = countUnavailable(project, unavailable);
  const provider = useFonts(FONT_SOURCES);

  const plan = useMemo(() => buildRenderPlan(project), [project]);
  const composition = useMemo(
    () =>
      buildComposition(project, { resolve: (r) => absolutePath(project.id, r), previewMaxSide: PREVIEW_MAX_SIDE, unavailable })
        .composition,
    [project, unavailable],
  );
  const resources = useDrawResources(project, plan, provider);
  const planSV = useSharedValue<RenderPlan | null>(null);
  const resSV = useSharedValue<DrawResources | null>(null);
  useEffect(() => {
    planSV.value = plan;
  }, [plan, planSV]);
  useEffect(() => {
    resSV.value = resources;
  }, [resources, resSV]);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const player = usePreviewPlayer({
    // Fora de foco (tela de exportação), o preview larga os decodificadores.
    composition: focused ? composition : null,
    duration: plan.duration / 1_000_000,
    plan: planSV,
    resources: resSV,
    width: size.width,
    height: size.height,
  });

  const runtime: EditorRuntime = useMemo(
    () => ({
      player,
      resources,
      now: () => Math.round(player.time.value * 1_000_000),
      seek: (t: Micros) => player.seek(t / 1_000_000),
    }),
    [player, resources],
  );

  const addMedia = useCallback(async () => {
    player.pause();
    const at = Math.round(player.time.value * 1_000_000);
    const picked = await pickVisualMedia();
    if (picked.length === 0) return;
    setBusy({ label: 'Importando', fraction: 0 });
    try {
      const { assets, failed } = await importAll(project.id, picked, (done, total) => setBusy({ label: 'Importando', fraction: done / total }));
      if (assets.length) {
        apply((p) => insertMainClips(addAssets(p, assets), assets.map(makeMainClip), insertIndexAt(p, at)));
      }
      if (failed.length) showToast(`${failed.length} mídia(s) não abriram.`, 'error');
    } finally {
      setBusy(null);
    }
  }, [player, project.id, apply, setBusy, showToast]);

  const exit = useCallback(() => {
    player.pause();
    flushSave();
    router.back();
  }, [player, router]);

  // Voltar do Android: fecha o painel, depois a seleção, depois o editor.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const state = useEditor.getState();
      if (state.panel) {
        openPanel(null);
        return true;
      }
      if (state.selection) {
        select(null);
        return true;
      }
      exit();
      return true;
    });
    return () => sub.remove();
  }, [openPanel, select, exit]);

  const bottomHeight = Math.max(250, Math.round(screenH * 0.42));

  return (
    <EditorContext.Provider value={runtime}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.topBar}>
          <IconButton icon={X} label="Fechar o editor" onPress={exit} />
          <Txt variant="sm" weight="600" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
            {project.name}
          </Txt>
          <Button
            label="Exportar"
            size="sm"
            onPress={() => {
              player.pause();
              flushSave();
              router.push({ pathname: '/export/[id]', params: { id: project.id } });
            }}
            disabled={project.main.length === 0 && project.texts.length === 0 && project.overlays.length === 0}
            style={{ marginRight: space[2] }}
          />
        </View>

        {missingCount > 0 ? (
          <View style={styles.missing} accessibilityRole="alert">
            <AlertTriangle size={16} color={colors.danger} />
            <Txt variant="xs" style={{ flex: 1 }}>
              {missingCount === 1 ? '1 item está sem a mídia original' : `${missingCount} itens estão sem a mídia original`}. Eles
              aparecem em preto: toque no clipe marcado e use Substituir.
            </Txt>
          </View>
        ) : null}
        <Preview project={project} plan={plan} resources={resources} player={player} size={size} onSize={setSize} />
        <PlaybackBar player={player} durationUs={plan.duration} />

        <View style={{ height: bottomHeight + insets.bottom, paddingBottom: insets.bottom, backgroundColor: colors.bg }}>
          {panel ? (
            <PanelSwitch project={project} />
          ) : (
            <>
              <Timeline project={project} player={player} onAddMedia={addMedia} onOpenTransition={(clipId) => openPanel('transition', clipId)} />
              <Toolbar project={project} onAddMedia={addMedia} />
            </>
          )}
        </View>
        {!selection && !panel && project.main.length === 0 ? (
          <View style={styles.emptyHint} pointerEvents="none">
            <Txt variant="sm" tone="muted">
              Toque em + para adicionar vídeos e fotos.
            </Txt>
          </View>
        ) : null}
        <Toast toast={toast} />
      </View>
    </EditorContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: { height: 48, flexDirection: 'row', alignItems: 'center', paddingLeft: space[1] },
  emptyHint: { position: 'absolute', top: '40%', left: 0, right: 0, alignItems: 'center' },
  missing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginHorizontal: space[3],
    marginBottom: space[1],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
});
