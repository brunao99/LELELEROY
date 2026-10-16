/**
 * Aba Colagem: começar uma colagem de fotos (com o formato escolhido) e as
 * colagens já feitas, da mais recente para a mais antiga.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { LayoutDashboard, Settings } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CollageRatio } from '@/core/collage';
import { CollageCard } from '@/features/collage/CollageCard';
import { useCreateCollage } from '@/features/collage/useCreateCollage';
import { deleteCollage, duplicateCollage, listCollages, renameCollageOnDisk, type CollageSummary } from '@/storage/collages';
import { IconButton } from '@/ui/Button';
import { PromptDialog } from '@/ui/Dialogs';
import { Toast, type ToastMessage } from '@/ui/Feedback';
import { PressableScale } from '@/ui/PressableScale';
import { colors, space } from '@/ui/theme';

let toastSeq = 0;

/** Formatos de atalho, com o desenho do quadro em pontos. */
const FORMATS: { ratio: CollageRatio; label: string; use: string; w: number; h: number }[] = [
  { ratio: '9:16', label: '9:16', use: 'Story', w: 22, h: 39 },
  { ratio: '4:5', label: '4:5', use: 'Feed', w: 28, h: 35 },
  { ratio: '1:1', label: '1:1', use: 'Quadrado', w: 30, h: 30 },
  { ratio: '16:9', label: '16:9', use: 'Tela', w: 39, h: 22 },
];

export default function Collages() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<CollageSummary[] | null>(null);
  const [renaming, setRenaming] = useState<CollageSummary | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const say = (message: string, kind: ToastMessage['kind'] = 'info') => setToast({ id: ++toastSeq, message, kind });
  const { create, dialog, busy } = useCreateCollage((message) => say(message, 'error'));

  const refresh = useCallback(() => {
    listCollages()
      .then(setList)
      .catch(() => setList([]));
  }, []);
  useFocusEffect(refresh);

  const menu = (summary: CollageSummary) => {
    Alert.alert(summary.name, undefined, [
      { text: 'Renomear', onPress: () => setRenaming(summary) },
      {
        text: 'Duplicar',
        onPress: async () => {
          try {
            await duplicateCollage(summary.id, Date.now());
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
          Alert.alert('Excluir colagem?', `"${summary.name}" e as fotos copiadas para ela serão apagadas. Isso não tem volta.`, [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Excluir',
              style: 'destructive',
              onPress: () => {
                deleteCollage(summary.id);
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
      await renameCollageOnDisk(target.id, name, Date.now());
      refresh();
    } catch (e) {
      say(`Não foi possível renomear: ${String(e)}`, 'error');
    }
  };

  const header = (
    <View>
      <Text style={styles.largeTitle} accessibilityRole="header">
        Colagem
      </Text>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Nova colagem"
        accessibilityHint="Escolha até 20 fotos do celular. Começa no formato de story."
        onPress={() => create()}
        disabled={busy}
        style={styles.big}
      >
        <View style={styles.bigIcon}>
          <LayoutDashboard size={22} color={colors.onAccent} strokeWidth={2.25} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bigTitle}>Nova colagem</Text>
          <Text style={styles.bigText}>Junte fotos, recorte figurinhas com laço</Text>
        </View>
      </PressableScale>

      <Text style={styles.section}>Formato</Text>
      <View style={styles.formats}>
        {FORMATS.map((f) => (
          <PressableScale
            key={f.ratio}
            accessibilityRole="button"
            accessibilityLabel={`Nova colagem em ${f.label}, ${f.use}`}
            onPress={() => create(f.ratio)}
            disabled={busy}
            style={styles.format}
          >
            <View style={styles.formatBox}>
              <View style={[styles.formatFrame, { width: f.w, height: f.h }]}>
                <View style={styles.formatSplit} />
              </View>
            </View>
            <Text style={styles.formatLabel}>{f.label}</Text>
            <Text style={styles.formatUse} numberOfLines={1}>
              {f.use}
            </Text>
          </PressableScale>
        ))}
      </View>
      {list && list.length > 0 ? <Text style={styles.section}>Minhas colagens</Text> : null}
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <IconButton icon={Settings} label="Configurações" onPress={() => router.push('/settings')} />
      </View>
      <FlatList
        data={list ?? []}
        keyExtractor={(c) => c.id}
        numColumns={2}
        columnWrapperStyle={{ gap: space[3] }}
        contentContainerStyle={[styles.list, { paddingBottom: space[6] }]}
        ListHeaderComponent={header}
        ListEmptyComponent={
          list === null ? null : (
            <Text style={styles.empty}>As colagens que você fizer aparecem aqui, da mais recente para a mais antiga.</Text>
          )
        }
        renderItem={({ item }) => (
          <View style={{ flex: 0.5 }}>
            <CollageCard
              summary={item}
              onOpen={() => router.push({ pathname: '/colagem/[id]', params: { id: item.id } })}
              onMenu={() => menu(item)}
            />
          </View>
        )}
      />
      {dialog}
      <PromptDialog
        visible={renaming !== null}
        title="Renomear colagem"
        initial={renaming?.name ?? ''}
        onCancel={() => setRenaming(null)}
        onConfirm={rename}
      />
      <Toast toast={toast} />
    </View>
  );
}

const hairline = { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)' } as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  bar: { height: 44, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingRight: space[2] },
  list: { paddingHorizontal: space[4], gap: space[5] },
  largeTitle: { color: colors.text, fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: -0.6, paddingTop: space[1] },
  big: {
    marginTop: space[5],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3] + 2,
    padding: 18,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: colors.accent,
  },
  bigIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(26,18,4,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigTitle: { color: colors.onAccent, fontSize: 19, lineHeight: 24, fontWeight: '700', letterSpacing: -0.3 },
  bigText: { color: 'rgba(26,18,4,0.72)', fontSize: 13, lineHeight: 18, fontWeight: '500' },
  section: { marginTop: space[6] + 4, marginBottom: space[2] + 2, color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  formats: { flexDirection: 'row', gap: space[2] },
  format: {
    flex: 1,
    alignItems: 'center',
    gap: space[1],
    paddingTop: space[3],
    paddingBottom: space[2] + 2,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    ...hairline,
  },
  formatBox: { height: 44, justifyContent: 'center' },
  formatFrame: { borderWidth: 1.5, borderColor: colors.text, borderRadius: 4, alignItems: 'center' },
  formatSplit: { flex: 1, width: 1.5, backgroundColor: colors.text, opacity: 0.6 },
  formatLabel: { color: colors.text, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  formatUse: { color: colors.textFaint, fontSize: 11, lineHeight: 14, fontWeight: '500', textAlign: 'center' },
  empty: { color: colors.textMuted, fontSize: 15, lineHeight: 22, marginTop: space[6], textAlign: 'center', paddingHorizontal: space[4] },
});
