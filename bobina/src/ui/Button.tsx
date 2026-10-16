import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Txt } from './Text';
import { colors, layout, radius, space } from './theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const HEIGHT: Record<Size, number> = { sm: 32, md: 40, lg: 48 };
const BG: Record<Variant, string> = {
  primary: colors.accent,
  secondary: colors.surfaceRaised,
  ghost: 'transparent',
  danger: colors.danger,
};

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

export function Button({ label, onPress, variant = 'primary', size = 'md', icon: Icon, disabled, loading, style, accessibilityHint }: ButtonProps) {
  const fg = variant === 'primary' ? colors.onAccent : variant === 'danger' ? colors.onTrack : colors.text;
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      hitSlop={Math.max(0, (layout.touchMin - HEIGHT[size]) / 2)}
      style={({ pressed }) => [
        styles.base,
        { height: HEIGHT[size], backgroundColor: BG[variant] },
        pressed && !inactive ? { opacity: 0.8 } : null,
        disabled ? { opacity: 0.4 } : null,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : Icon ? <Icon size={18} color={fg} /> : null}
      <Txt variant="sm" weight="600" style={{ color: fg }}>
        {label}
      </Txt>
    </Pressable>
  );
}

export interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

/** Botão só com ícone: área de toque de 44 pt, rótulo para o leitor de tela. */
export function IconButton({ icon: Icon, label, onPress, disabled, active, size = 22, color, style }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.icon,
        pressed && !disabled ? { backgroundColor: colors.surfaceRaised } : null,
        disabled ? { opacity: 0.4 } : null,
        style,
      ]}
    >
      <Icon size={size} color={color ?? (active ? colors.accent : colors.text)} />
    </Pressable>
  );
}

export interface ToolbarItemProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
}

/** Item da barra de ferramentas: ícone em cima, rótulo embaixo. */
export function ToolbarItem({ icon: Icon, label, onPress, disabled, active, danger }: ToolbarItemProps) {
  const color = danger ? colors.danger : active ? colors.accent : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.toolbarItem,
        pressed && !disabled ? { backgroundColor: colors.surfaceRaised } : null,
        disabled ? { opacity: 0.4 } : null,
      ]}
    >
      <Icon size={22} color={color} />
      <Txt variant="xs" numberOfLines={1} style={{ color: danger ? colors.danger : active ? colors.accent : colors.textMuted }}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function Row({ children, gap = space[2], style }: { children: React.ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    paddingHorizontal: space[4],
    borderRadius: radius.md,
  },
  icon: {
    width: layout.touchMin,
    height: layout.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  toolbarItem: {
    width: layout.toolbarItem,
    height: layout.toolbar - 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: radius.md,
  },
});
