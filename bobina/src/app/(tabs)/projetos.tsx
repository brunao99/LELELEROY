import { useFocusEffect, useRouter } from 'expo-router';
import { Clapperboard, Settings } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProjectCard } from '@/features/home/ProjectCard';
import { useCreateProject } from '@/features/home/useCreateProject';
import {
  deleteProject,
  duplicateProject,
  listProjects,
  loadProject,
  renameProjectOnDisk,
  type ProjectSummary,
} from '@/storage/projects';
import { IconButton } from '@/ui/Button';
import { PromptDialog } from '@/ui/Dialogs';
import { Toast, type ToastMessage } from '@/ui/Feedback';
import { PressableScale } from '@/ui/PressableScale';
import { colors, space } from '@/ui/theme';

let toastSeq = 0;

export default function MyProjects() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const say = (message: string, kind: ToastMessage['kind'] = 'info') => setToast({ id: ++toastSeq, message, kind });

  const refresh = useCallback(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  useFocusEffect(refresh);

  const { create, dialog } = useCreateProject((message) => say(message, 'error'));

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


  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Animated.Text style={[styles.barTitle, barTitle]} accessibilityElementsHidden importantForAccessibility="no">
          Meus projetos
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
          contentContainerStyle={[styles.list, { paddingBottom: space[6] }, projects.length === 0 && { flexGrow: 1 }]}
          ListHeaderComponent={
            <View style={styles.hero}>
              <Text style={styles.eyebrow}>{"LEDIT'S"}</Text>
              <Text style={styles.largeTitle} accessibilityRole="header">
                Meus projetos
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Clapperboard size={28} color={colors.accent} strokeWidth={1.75} />
              </View>
              <Text style={styles.emptyTitle}>Nenhum projeto ainda</Text>
              <Text style={styles.emptyText}>Os vídeos que você começar aparecem aqui, do mais recente para o mais antigo.</Text>
              <PressableScale accessibilityRole="button" onPress={() => create()} style={styles.emptyButton}>
                <Text style={styles.emptyButtonLabel}>Criar projeto</Text>
              </PressableScale>
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

      {dialog}
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
  emptyButton: { marginTop: space[3], height: 48, paddingHorizontal: space[5], borderRadius: 12, borderCurve: 'continuous', backgroundColor: colors.accent, justifyContent: 'center' },
  emptyButtonLabel: { color: colors.onAccent, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
});
