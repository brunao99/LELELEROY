import { useFocusEffect, useRouter } from 'expo-router';
import { Clapperboard, Plus, Settings } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
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
import { Button, IconButton } from '@/ui/Button';
import { PromptDialog, ProgressDialog } from '@/ui/Dialogs';
import { EmptyState, Toast, type ToastMessage } from '@/ui/Feedback';
import { Txt } from '@/ui/Text';
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

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Txt variant="xl" accessibilityRole="header">
          Bobina
        </Txt>
        <IconButton icon={Settings} label="Configurações" onPress={() => router.push('/settings')} />
      </View>

      <Button label="Novo projeto" icon={Plus} size="lg" onPress={create} style={styles.newButton} accessibilityHint="Escolha vídeos e fotos para começar" />

      {projects === null ? null : projects.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title="Nenhum projeto ainda"
          text="Toque em Novo projeto, escolha seus vídeos e fotos na ordem em que devem aparecer e comece a editar."
        />
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(p) => p.id}
          numColumns={2}
          columnWrapperStyle={{ gap: space[3] }}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + space[6] }]}
          ListHeaderComponent={
            <Txt variant="sm" tone="muted" style={{ marginBottom: space[2] }}>
              Projetos
            </Txt>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: space[4],
    paddingRight: space[2],
    height: 56,
  },
  newButton: { marginHorizontal: space[4], marginBottom: space[5] },
  list: { paddingHorizontal: space[4], gap: space[4] },
});
