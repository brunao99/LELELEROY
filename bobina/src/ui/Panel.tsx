import { Check } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { SlideInDown } from 'react-native-reanimated';

import { IconButton } from './Button';
import { Txt } from './Text';
import { colors, radius, space } from './theme';

export interface PanelProps {
  title: string;
  onDone: () => void;
  children: React.ReactNode;
  /** Ação no rodapé, como "Aplicar a todos". */
  footer?: { label: string; onPress: () => void } | null;
  /** Conteúdo rolável (padrão) ou fixo (listas próprias). */
  scroll?: boolean;
}

/** Painel inferior: título, conteúdo e ✓ para confirmar. Fica no lugar da timeline. */
export function Panel({ title, onDone, children, footer, scroll = true }: PanelProps) {
  return (
    <Animated.View entering={SlideInDown.duration(180)} style={styles.panel}>
      <View style={styles.header}>
        <Txt variant="lg" accessibilityRole="header">
          {title}
        </Txt>
        <IconButton icon={Check} label="Confirmar" onPress={onDone} color={colors.accent} />
      </View>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, { flex: 1 }]}>{children}</View>
      )}
      {footer ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={footer.label}
          onPress={footer.onPress}
          style={({ pressed }) => [styles.footer, pressed ? { backgroundColor: colors.surfaceRaised } : null]}
        >
          <Txt variant="sm" weight="600" tone="accent">
            {footer.label}
          </Txt>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

/** Título pequeno de uma seção dentro de um painel. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Txt variant="xs" tone="faint" style={{ paddingHorizontal: space[4], textTransform: 'uppercase', letterSpacing: 0.6 }}>
      {children}
    </Txt>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: space[4],
    paddingRight: space[1],
    height: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  content: { paddingVertical: space[3], gap: space[4] },
  footer: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
