import { Film, MoreVertical } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { formatTime } from '@/core/time';
import { fileUri } from '@/storage/paths';
import type { ProjectSummary } from '@/storage/projects';
import { IconButton } from '@/ui/Button';
import { Txt } from '@/ui/Text';
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${summary.name}, ${formatTime(summary.duration, false)}, editado ${relativeDate(summary.updatedAt)}`}
      accessibilityHint="Abre o projeto"
      onPress={onOpen}
      onLongPress={onMenu}
      style={({ pressed }) => [styles.card, pressed ? { opacity: 0.85 } : null]}
    >
      <View style={styles.thumb}>
        {cover ? (
          <Image
            key={summary.updatedAt}
            source={{ uri: cover }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Film size={28} color={colors.textFaint} />
        )}
        <View style={styles.duration}>
          <Txt variant="xs" weight="600" tabular>
            {formatTime(summary.duration, false)}
          </Txt>
        </View>
      </View>
      <View style={styles.meta}>
        <View style={{ flex: 1 }}>
          <Txt variant="sm" weight="600" numberOfLines={1}>
            {summary.name}
          </Txt>
          <Txt variant="xs" tone="muted">
            {relativeDate(summary.updatedAt)}
          </Txt>
        </View>
        <IconButton icon={MoreVertical} label={`Opções de ${summary.name}`} onPress={onMenu} size={18} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, gap: space[1] },
  thumb: {
    aspectRatio: 1,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  duration: {
    position: 'absolute',
    right: space[2],
    bottom: space[2],
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  meta: { flexDirection: 'row', alignItems: 'center', paddingLeft: 2 },
});
