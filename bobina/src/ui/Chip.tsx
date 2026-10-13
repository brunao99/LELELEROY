import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { Txt } from './Text';
import { colors, radius, space } from './theme';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  disabled?: boolean;
}

export function Chip({ label, selected, onPress, disabled }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? colors.accent : colors.surfaceRaised },
        pressed ? { opacity: 0.8 } : null,
        disabled ? { opacity: 0.4 } : null,
      ]}
    >
      <Txt variant="sm" weight="600" style={{ color: selected ? colors.onAccent : colors.text }}>
        {label}
      </Txt>
    </Pressable>
  );
}

export interface ChoiceRowProps<T extends string | number> {
  options: { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
}

/** Linha de chips de escolha única, rolável na horizontal. */
export function ChoiceRow<T extends string | number>({ options, value, onChange }: ChoiceRowProps<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityRole="radiogroup"
    >
      {options.map((o) => (
        <Chip key={String(o.value)} label={o.label} selected={o.value === value} disabled={o.disabled} onPress={() => onChange(o.value)} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 34,
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { gap: space[2], paddingHorizontal: space[4] },
});
