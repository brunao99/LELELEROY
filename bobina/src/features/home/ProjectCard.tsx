import * as Haptics from 'expo-haptics';
import { Film, MoreHorizontal } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { formatTime } from '@/core/time';
import { fileUri } from '@/storage/paths';
import type { ProjectSummary } from '@/storage/projects';
import { PressableScale } from '@/ui/PressableScale';
import { colors, radius, space } from '@/ui/theme';

export function relativeDate(ms: number, now = Date.now()): string {
  const minutes = Math.floor((now - ms) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

export interface ProjectCardProps {
  summary: ProjectSummary;
  onOpen: () => void;
  onMenu: () => void;
}

export function ProjectCard({ summary, onOpen, onMenu }: ProjectCardProps) {
  const cover = summary.cover ? fileUri(summary.id, summary.cover) : null;
  const openMenu = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onMenu();
  };
  return (
    <View style={styles.card}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${summary.name}, ${formatTime(summary.duration, false)}, editado ${relativeDate(summary.updatedAt)}`}
        accessibilityHint="Abre o projeto. Segure para ver as opções."
        onPress={onOpen}
        onLongPress={openMenu}
        delayLongPress={350}
        style={styles.thumb}
      >
        {cover ? (
          <Image key={summary.updatedAt} source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
        ) : (
          <Film size={28} color={colors.textFaint} strokeWidth={1.5} />
        )}
        <View style={styles.duration}>
          <Text style={styles.durationText}>{formatTime(summary.duration, false)}</Text>
        </View>
      </PressableScale>
      <View style={styles.meta}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>
            {summary.name}
          </Text>
          <Text style={styles.date}>{relativeDate(summary.updatedAt)}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Opções de ${summary.name}`}
          onPress={openMenu}
          hitSlop={12}
          style={({ pressed }) => [styles.more, pressed && { opacity: 0.5 }]}
        >
          <MoreHorizontal size={18} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, gap: space[2] },
  thumb: {
    aspectRatio: 3 / 4,
    borderRadius: 12,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: colors.surface,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  duration: {
    position: 'absolute',
    right: space[2],
    bottom: space[2],
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  durationText: { color: '#ffffff', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  meta: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 2 },
  name: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '600', letterSpacing: -0.2 },
  date: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  more: { paddingTop: 2, paddingLeft: space[2] },
});
