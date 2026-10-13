import { useFocusEffect, useRouter } from 'expo-router';
import { Clapperboard, Plus, Settings } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createProject, defaultProjectName } from '@/core/defaults';
import { newId } from '@/core/ids';
import { ProjectCard } from '@/features/home/ProjectCard';
import { importAll, pickVisualMedia } from '@/features/media/pick';
import {
  deleteProject,
  duplicateProject,
  listProjects,
  loadProject,
  renameProjectOnDisk,
  saveProject,
  type ProjectSummary,
} from '@/storage/projects';
import { IconButton } from '@/ui/Button';
import { PromptDialog, ProgressDialog } from '@/ui/Dialogs';
import { Toast, type ToastMessage } from '@/ui/Feedback';
import { PressableScale } from '@/ui/PressableScale';
import { colors, space } from '@/ui/theme';

let toastSeq = 0;

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const say = (message: string, kind: ToastMessage['kind'] = 'info') => setToast({ id: ++toastSeq, message, kind });

  const refresh = useCallback(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  useFocusEffect(refresh);

  const create = async () => {
    const picked = await pickVisualMedia();
    if (picked.length === 0) return;
    const id = newId('p');
    setImporting({ done: 0, total: picked.length });
    try {
      const { assets, failed } = await importAll(id, picked, (done, total) => setImporting({ done, total }));
      if (assets.length === 0) {
        deleteProject(id);
        say('Não foi possível abrir nenhuma das mídias escolhidas.', 'error');
        return;
      }
      const now = Date.now();
      saveProject(createProject({ id, name: defaultProjectName(now), now, assets }));
      if (failed.length) say(`${failed.length} mídia(s) não abriram e ficaram de fora.`, 'error');
      router.push({ pathname: '/editor/[id]', params: { id } });
    } catch (e) {
      deleteProject(id);
      say(`Erro ao importar: ${String(e)}`, 'error');
    } finally {
      setImporting(null);
    }
  };

  const menu = (summary: ProjectSummary) => {
    Alert.alert(summary.name, undefined, [
      { text: 'Renomear', onPress: () => setRenaming(summary) },
      {
        text: 'Duplicar',
        onPress: async () => {
          try {
            await duplicateProject(summary.id, Date.now());
            refresh();
          } catch (e) {
            say(`Não foi possível duplicar: ${String(e)}`, 'error');
          }
        },
      },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Excluir projeto?', `"${summary.name}" e as mídias copiadas para ele serão apagados. Isso não tem volta.`, [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Excluir',
              style: 'destructive',
              onPress: () => {
                deleteProject(summary.id);
                refresh();
              },
            },
          ]),
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  const rename = async (name: string) => {
    const target = renaming;
    setRenaming(null);
    if (!target) return;
    try {
      renameProjectOnDisk(await loadProject(target.id), name, Date.now());
      refresh();
    } catch (e) {
      say(`Não foi possível renomear: ${String(e)}`, 'error');
    }
  };

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.set(e.contentOffset.y);
  });
  // O título grande sobe com a lista; quando some, o título pequeno aparece na barra.
  const barTitle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.get(), [28, 48], [0, 1], Extrapolation.CLAMP),
  }));
  const barEdge = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.get(), [40, 64], [0, 1], Extrapolation.CLAMP),
  }));

  const footer = insets.bottom + space[4];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Animated.Text style={[styles.barTitle, barTitle]} accessibilityElementsHidden importantForAccessibility="no">
          Projetos
        </Animated.Text>
        <View style={styles.barRight}>
          <IconButton icon={Settings} label="Configurações" onPress={() => router.push('/settings')} />
        </View>
        <Animated.View style={[styles.barEdge, barEdge]} />
      </View>

      {projects === null ? null : (
        <Animated.FlatList
          data={projects}
          keyExtractor={(p) => p.id}
          numColumns={2}
          onScroll={onScroll}
          scrollEventThrottle={16}
          columnWrapperStyle={{ gap: space[3] }}
          contentContainerStyle={[styles.list, { paddingBottom: footer + 52 + space[6] }, projects.length === 0 && { flexGrow: 1 }]}
          ListHeaderComponent={
            <View style={styles.hero}>
              <Text style={styles.eyebrow}>{"LEDIT'S"}</Text>
              <Text style={styles.largeTitle} accessibilityRole="header">
                Projetos
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Clapperboard size={28} color={colors.accent} strokeWidth={1.75} />
              </View>
              <Text style={styles.emptyTitle}>Seu primeiro vídeo começa aqui</Text>
              <Text style={styles.emptyText}>
                Toque em Novo projeto e escolha os vídeos e fotos na ordem em que devem aparecer.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={{ flex: 0.5 }}>
              <ProjectCard
                summary={item}
                onOpen={() => router.push({ pathname: '/editor/[id]', params: { id: item.id } })}
                onMenu={() => menu(item)}
              />
            </View>
          )}
        />
      )}

      <View style={[styles.fabWrap, { bottom: footer }]} pointerEvents="box-none">
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Novo projeto"
          accessibilityHint="Escolha vídeos e fotos para começar"
          onPress={create}
          style={styles.fab}
        >
          <Plus size={20} color={colors.onAccent} strokeWidth={2.5} />
          <Text style={styles.fabLabel}>Novo projeto</Text>
        </PressableScale>
      </View>

      <ProgressDialog
        visible={importing !== null}
        title="Importando mídias"
        detail={importing ? `${importing.done} de ${importing.total}` : undefined}
        fraction={importing ? importing.done / Math.max(1, importing.total) : null}
      />
      <PromptDialog
        visible={renaming !== null}
        title="Renomear projeto"
        initial={renaming?.name ?? ''}
        onCancel={() => setRenaming(null)}
        onConfirm={rename}
      />
      <Toast toast={toast} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  bar: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  barTitle: { color: colors.text, fontSize: 17, fontWeight: '600', letterSpacing: -0.4 },
  barRight: { position: 'absolute', right: space[2], top: 0, bottom: 0, justifyContent: 'center' },
  barEdge: { position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  list: { paddingHorizontal: space[4], gap: space[5] },
  hero: { paddingTop: space[1], paddingBottom: space[2], gap: 2 },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: '700', letterSpacing: 1.6 },
  largeTitle: { color: colors.text, fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: -0.6 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[6], gap: space[3], paddingBottom: space[8] },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space[2],
  },
  emptyTitle: { color: colors.text, fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.4, textAlign: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 300 },
  fabWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    height: 52,
    paddingHorizontal: space[6],
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: colors.accent,
  },
  fabLabel: { color: colors.onAccent, fontSize: 17, fontWeight: '600', letterSpacing: -0.2 },
});
