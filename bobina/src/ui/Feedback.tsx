import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';

import { Button } from './Button';
import { Txt } from './Text';
import { colors, radius, space } from './theme';

export function ProgressBar({ fraction, tone = 'accent' }: { fraction: number | null; tone?: 'accent' | 'danger' }) {
  const pct = fraction === null ? null : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <View
      style={styles.progressTrack}
      accessibilityRole="progressbar"
      accessibilityValue={pct === null ? undefined : { min: 0, max: 100, now: pct }}
    >
      <View
        style={[
          styles.progressFill,
          { backgroundColor: tone === 'danger' ? colors.danger : colors.accent, width: pct === null ? '30%' : `${pct}%` },
        ]}
      />
    </View>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.empty}>
      <Icon size={40} color={colors.textFaint} />
      <Txt variant="lg" align="center">
        {title}
      </Txt>
      <Txt variant="sm" tone="muted" align="center">
        {text}
      </Txt>
      {action ? <Button label={action.label} onPress={action.onPress} style={{ marginTop: space[2] }} /> : null}
    </View>
  );
}

export interface ToastMessage {
  id: number;
  message: string;
  kind: 'info' | 'error';
}

/** Aviso curto que some sozinho em 2,5 s (ou ao tocar). */
export function Toast({ toast }: { toast: ToastMessage | null }) {
  const [dismissed, setDismissed] = useState<number | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setDismissed(toast.id), toast.kind === 'error' ? 4000 : 2500);
    return () => clearTimeout(timer);
  }, [toast]);
  const visible = toast && toast.id !== dismissed ? toast : null;
  if (!visible) return null;
  return (
    <Animated.View entering={FadeInDown.duration(160)} exiting={FadeOutDown.duration(160)} style={styles.toastWrap} pointerEvents="box-none">
      <Pressable
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        onPress={() => setDismissed(visible.id)}
        style={[styles.toast, visible.kind === 'error' ? styles.toastError : null]}
      >
        <Txt variant="sm">{visible.message}</Txt>
      </Pressable>
    </Animated.View>
  );
}

/** Faixa de "trabalhando…" sobre o preview (velocidade, legendas). */
export function BusyBanner({ label, fraction }: { label: string; fraction: number | null }) {
  return (
    <View style={styles.busy} accessibilityLiveRegion="polite" accessibilityLabel={label}>
      <View style={styles.busyRow}>
        <ActivityIndicator size="small" color={colors.accent} />
        <Txt variant="xs" weight="600">
          {label}
          {fraction !== null ? ` ${Math.round(fraction * 100)}%` : ''}
        </Txt>
      </View>
      <ProgressBar fraction={fraction} />
    </View>
  );
}

const styles = StyleSheet.create({
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden', alignSelf: 'stretch' },
  progressFill: { height: 4, borderRadius: 2 },
  empty: { alignItems: 'center', justifyContent: 'center', gap: space[2], padding: space[6] },
  toastWrap: { position: 'absolute', left: space[4], right: space[4], bottom: space[8], alignItems: 'center' },
  toast: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    maxWidth: 480,
  },
  toastError: { borderLeftWidth: 4, borderLeftColor: colors.danger },
  busy: {
    position: 'absolute',
    left: space[3],
    right: space[3],
    top: space[2],
    backgroundColor: 'rgba(22,24,29,0.92)',
    borderRadius: radius.md,
    padding: space[2],
    gap: space[1],
  },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
});
