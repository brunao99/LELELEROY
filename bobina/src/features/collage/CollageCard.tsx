import * as Haptics from 'expo-haptics';
import { LayoutDashboard, MoreHorizontal } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { relativeDate } from '@/features/home/ProjectCard';
import { collageUri, type CollageSummary } from '@/storage/collages';
import { PressableScale } from '@/ui/PressableScale';
import { colors, radius, space } from '@/ui/theme';

export interface CollageCardProps {
  summary: CollageSummary;
  onOpen: () => void;
  onMenu: () => void;
}

/** Cartão de uma colagem na lista (mesmo desenho do cartão de projeto). */
export function CollageCard({ summary, onOpen, onMenu }: CollageCardProps) {
  const cover = summary.cover ? collageUri(summary.id, summary.cover) : null;
  const photos = summary.photoCount === 1 ? '1 foto' : `${summary.photoCount} fotos`;
  const openMenu = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onMenu();
  };
  return (
    <View style={styles.card}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${summary.name}, ${photos}, editada ${relativeDate(summary.updatedAt)}`}
        accessibilityHint="Abre a colagem. Segure para ver as opções."
        onPress={onOpen}
        onLongPress={openMenu}
        delayLongPress={350}
        style={styles.thumb}
      >
        {cover ? (
          <Image key={summary.updatedAt} source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
        ) : (
          <LayoutDashboard size={28} color={colors.textFaint} strokeWidth={1.5} />
        )}
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{photos}</Text>
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
  badge: {
    position: 'absolute',
    right: space[2],
    bottom: space[2],
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: { color: '#ffffff', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  meta: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 2 },
  name: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '600', letterSpacing: -0.2 },
  date: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  more: { paddingTop: 2, paddingLeft: space[2] },
});
