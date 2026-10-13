/**
 * Aba Criar: começar um projeto (com o formato do primeiro vídeo ou um formato
 * escolhido) e voltar ao último projeto editado.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { Plus, Settings } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatTime } from '@/core/time';
import type { Ratio } from '@/core/types';
import { relativeDate } from '@/features/home/ProjectCard';
import { useCreateProject } from '@/features/home/useCreateProject';
import { fileUri } from '@/storage/paths';
import { listProjects, type ProjectSummary } from '@/storage/projects';
import { IconButton } from '@/ui/Button';
import { Toast, type ToastMessage } from '@/ui/Feedback';
import { PressableScale } from '@/ui/PressableScale';
import { colors, space } from '@/ui/theme';

let toastSeq = 0;

const WORDMARK = require('../../../assets/brand/wordmark.png');

/** Formatos de atalho, com o desenho do quadro em pontos. */
const FORMATS: { ratio: Ratio; label: string; use: string; w: number; h: number }[] = [
  { ratio: '9:16', label: '9:16', use: 'Reels e TikTok', w: 22, h: 39 },
  { ratio: '16:9', label: '16:9', use: 'YouTube', w: 39, h: 22 },
  { ratio: '1:1', label: '1:1', use: 'Quadrado', w: 30, h: 30 },
  { ratio: '4:5', label: '4:5', use: 'Feed', w: 28, h: 35 },
];

export default function Create() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [last, setLast] = useState<ProjectSummary | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const { create, dialog, busy } = useCreateProject((message) => setToast({ id: ++toastSeq, message, kind: 'error' }));

  useFocusEffect(
    useCallback(() => {
      listProjects()
        .then((list) => setLast(list[0] ?? null))
        .catch(() => setLast(null));
    }, []),
  );

  const cover = last?.cover ? fileUri(last.id, last.cover) : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Image source={WORDMARK} style={styles.wordmark} resizeMode="contain" accessibilityRole="image" accessibilityLabel="Ledit's" />
        <IconButton icon={Settings} label="Configurações" onPress={() => router.push('/settings')} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.largeTitle} accessibilityRole="header">
            Criar
          </Text>
        </View>

        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Novo projeto"
          accessibilityHint="Escolha vídeos e fotos do celular. O formato segue o primeiro vídeo."
          onPress={() => create()}
          disabled={busy}
          style={styles.big}
        >
          <View style={styles.bigIcon}>
            <Plus size={22} color={colors.onAccent} strokeWidth={2.5} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.bigTitle}>Novo projeto</Text>
            <Text style={styles.bigText}>Escolha vídeos e fotos do celular</Text>
          </View>
        </PressableScale>

        <Text style={styles.section}>Formato</Text>
        <View style={styles.formats}>
          {FORMATS.map((f) => (
            <PressableScale
              key={f.ratio}
              accessibilityRole="button"
              accessibilityLabel={`Novo projeto em ${f.label}, ${f.use}`}
              onPress={() => create(f.ratio)}
              disabled={busy}
              style={styles.format}
            >
              <View style={styles.formatBox}>
                <View style={[styles.formatFrame, { width: f.w, height: f.h }]} />
              </View>
              <Text style={styles.formatLabel}>{f.label}</Text>
              <Text style={styles.formatUse} numberOfLines={2}>
                {f.use}
              </Text>
            </PressableScale>
          ))}
        </View>

        {last ? (
          <>
            <Text style={styles.section}>Continuar editando</Text>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Continuar ${last.name}`}
              onPress={() => router.push({ pathname: '/editor/[id]', params: { id: last.id } })}
              style={styles.last}
            >
              <View style={styles.lastThumb}>
                {cover ? <Image key={last.updatedAt} source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.lastName} numberOfLines={1}>
                  {last.name}
                </Text>
                <Text style={styles.lastMeta}>
                  {formatTime(last.duration, false)} · editado {relativeDate(last.updatedAt)}
                </Text>
              </View>
            </PressableScale>
          </>
        ) : null}
      </ScrollView>
      {dialog}
      <Toast toast={toast} />
    </View>
  );
}

const hairline = { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)' } as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  bar: { height: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingLeft: space[4], paddingRight: space[2] },
  wordmark: { height: 22, width: (22 * 822) / 262 },
  content: { paddingHorizontal: space[4], paddingBottom: space[7] },
  hero: { paddingTop: space[1], gap: 2 },
  largeTitle: { color: colors.text, fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: -0.6 },
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
  formatFrame: { borderWidth: 1.5, borderColor: colors.text, borderRadius: 4 },
  formatLabel: { color: colors.text, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  formatUse: { color: colors.textFaint, fontSize: 11, lineHeight: 14, fontWeight: '500', textAlign: 'center' },
  last: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[2] + 2,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    ...hairline,
  },
  lastThumb: { width: 52, height: 68, borderRadius: 8, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: colors.surfaceRaised },
  lastName: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '600', letterSpacing: -0.2 },
  lastMeta: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
});
