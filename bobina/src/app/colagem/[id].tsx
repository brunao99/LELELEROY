/**
 * Editor de colagem: a colagem no meio (com os gestos), a faixa de modelos e a
 * barra de ferramentas embaixo, painéis no lugar delas. O laço da figurinha
 * cobre a colagem quando está aberto.
 */
import { useFonts } from '@shopify/react-native-skia';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AlertTriangle, Redo2, Undo2, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  applyGesture,
  collageDesignSize,
  pruneCollage,
  renameCollage,
  swapSlots,
  type Collage,
  type CollageGesture,
} from '@/core/collage';
import { makeCollageCover } from '@/engine/collageExport';
import { FONT_SOURCES } from '@/engine/fonts';
import { useCollageActions } from '@/features/collage/actions';
import { CollageCanvas } from '@/features/collage/CollageCanvas';
import { CollagePanels } from '@/features/collage/CollagePanels';
import { CollageStrip } from '@/features/collage/CollageStrip';
import { CollageToolbar } from '@/features/collage/CollageToolbar';
import { StickerLassoPanel } from '@/features/collage/StickerLassoPanel';
import { useCollageResources } from '@/features/collage/useCollageResources';
import { CutoutStage } from '@/features/editor/cutout/CutoutStage';
import { useCutoutEditor } from '@/features/editor/cutout/store';
import { flushCollageSave, useCollage, useCollageDoc, type CollageSelection } from '@/state/collage';
import { loadCollage, pruneCollageFiles, saveCollage } from '@/storage/collages';
import { Button, IconButton } from '@/ui/Button';
import { PromptDialog } from '@/ui/Dialogs';
import { BusyBanner, EmptyState, Toast } from '@/ui/Feedback';
import { Txt } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

export default function CollageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const open = useCollage((s) => s.open);
  const collage = useCollageDoc();
  const [error, setError] = useState<string | null>(null);
  const provider = useFonts(FONT_SOURCES);
  const providerRef = useRef(provider);
  useEffect(() => {
    providerRef.current = provider;
  }, [provider]);

  useEffect(() => {
    let cancelled = false;
    loadCollage(id)
      .then((loaded) => {
        if (cancelled) return;
        // Fotos e figurinhas que nada usa saem (ainda não há desfazer que precise delas).
        const pruned = pruneCollage(loaded);
        if (pruned !== loaded) {
          try {
            saveCollage(pruned);
          } catch {
            // O salvamento automático tenta de novo na próxima edição.
          }
        }
        pruneCollageFiles(pruned);
        open(pruned);
      })
      .catch((e) => !cancelled && setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
      if (useCutoutEditor.getState().clipId?.startsWith('collage:')) useCutoutEditor.getState().close();
      const current = useCollage.getState().history?.present;
      useCollage.getState().close();
      if (current) makeCollageCover(current, providerRef.current).catch(() => {});
    };
  }, [id, open]);

  if (error) {
    return (
      <View style={[styles.root, { justifyContent: 'center' }]}>
        <EmptyState icon={AlertTriangle} title="Não foi possível abrir a colagem" text={error} action={{ label: 'Voltar', onPress: () => router.back() }} />
      </View>
    );
  }
  if (!collage || collage.id !== id) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  return <CollageEditor collage={collage} />;
}

function CollageEditor({ collage }: { collage: Collage }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const provider = useFonts(FONT_SOURCES);
  const loaded = useCollageResources(collage, provider);
  const selection = useCollage((s) => s.selection);
  const panel = useCollage((s) => s.panel);
  const toast = useCollage((s) => s.toast);
  const busy = useCollage((s) => s.busy);
  const canUndo = useCollage((s) => (s.history?.past.length ?? 0) > 0);
  const canRedo = useCollage((s) => (s.history?.future.length ?? 0) > 0);
  const { apply, endGesture, select, openPanel, undo, redo } = useCollage.getState();
  const actions = useCollageActions(collage.id);
  const lassoOpen = useCutoutEditor((s) => s.clipId?.startsWith('collage:') ?? false);
  const [renaming, setRenaming] = useState(false);
  const { width: W, height: H } = collageDesignSize(collage);

  const present = () => useCollage.getState().history!.present;
  const onCommit = useCallback(
    (g: CollageGesture) => {
      apply((c) => applyGesture(c, g, W, H));
      endGesture();
      return present();
    },
    [apply, endGesture, W, H],
  );
  const onSwap = useCallback(
    (from: number, to: number) => {
      apply((c) => swapSlots(c, from, to));
      select({ kind: 'cell', index: to });
      return present();
    },
    [apply, select],
  );
  const onSelect = useCallback((s: CollageSelection) => select(s), [select]);
  const onEditText = useCallback(
    (id: string) => {
      select({ kind: 'layer', id });
      openPanel('text');
    },
    [select, openPanel],
  );

  const exit = useCallback(() => {
    flushCollageSave();
    router.back();
  }, [router]);

  // Voltar do Android: fecha o laço, o painel, a seleção e por fim o editor.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (useCutoutEditor.getState().clipId?.startsWith('collage:')) {
        useCutoutEditor.getState().close();
        return true;
      }
      const state = useCollage.getState();
      if (state.panel) {
        state.openPanel(null);
        return true;
      }
      if (state.selection) {
        state.select(null);
        return true;
      }
      exit();
      return true;
    });
    return () => sub.remove();
  }, [exit]);

  const panelHeight = Math.max(300, Math.round(screenH * 0.4));

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.topBar}>
          <IconButton icon={X} label="Fechar a colagem" onPress={exit} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${collage.name}. Toque para renomear`}
            onPress={() => setRenaming(true)}
            style={styles.title}
          >
            <Txt variant="sm" weight="600" numberOfLines={1} align="center">
              {collage.name}
            </Txt>
          </Pressable>
          <IconButton icon={Undo2} label="Desfazer" onPress={undo} disabled={!canUndo || lassoOpen} />
          <IconButton icon={Redo2} label="Refazer" onPress={redo} disabled={!canRedo || lassoOpen} />
          <Button label="Salvar" size="sm" onPress={() => openPanel('save')} disabled={lassoOpen} style={{ marginLeft: space[1], marginRight: space[2] }} />
        </View>

        <View style={styles.stage}>
          <CollageCanvas
            collage={collage}
            loaded={loaded}
            selection={selection}
            onSelect={onSelect}
            onCommit={onCommit}
            onSwap={onSwap}
            onEmptyCell={actions.fillCell}
            onEditText={onEditText}
          />
          {lassoOpen ? <CutoutStage kind="photo" /> : null}
          {busy ? <BusyBanner label={busy.label} fraction={busy.fraction} /> : null}
        </View>

        {lassoOpen ? (
          <View style={{ height: panelHeight + insets.bottom, paddingBottom: insets.bottom }}>
            <StickerLassoPanel onCreate={actions.finishSticker} />
          </View>
        ) : panel ? (
          <View style={{ height: panelHeight + insets.bottom, paddingBottom: insets.bottom }}>
            <CollagePanels collage={collage} actions={actions} panel={panel} />
          </View>
        ) : (
          <View style={{ paddingBottom: insets.bottom, backgroundColor: colors.bg }}>
            <CollageStrip collage={collage} />
            <CollageToolbar collage={collage} actions={actions} />
          </View>
        )}

        <PromptDialog
          visible={renaming}
          title="Renomear colagem"
          initial={collage.name}
          onCancel={() => setRenaming(false)}
          onConfirm={(name) => {
            setRenaming(false);
            apply((c) => renameCollage(c, name));
          }}
        />
        <Toast toast={toast} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: { height: 48, flexDirection: 'row', alignItems: 'center', paddingLeft: space[1] },
  title: { flex: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: space[2] },
  stage: { flex: 1 },
});
