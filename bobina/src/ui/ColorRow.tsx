import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { colors, SWATCHES, space } from './theme';

export interface ColorRowProps {
  label: string;
  value: string | null;
  onChange: (color: string) => void;
  /** Mostra a opção "sem cor" no começo. */
  allowNone?: boolean;
  onNone?: () => void;
}

export function ColorRow({ label, value, onChange, allowNone, onNone }: ColorRowProps) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityLabel={label}>
      {allowNone ? (
        <Pressable
          accessibilityRole="radio"
          accessibilityLabel="Sem cor"
          accessibilityState={{ selected: value === null }}
          onPress={onNone}
          style={[styles.swatch, styles.none, value === null ? styles.selected : null]}
        >
          <View style={styles.slash} />
        </Pressable>
      ) : null}
      {SWATCHES.map((c) => (
        <Pressable
          key={c}
          accessibilityRole="radio"
          accessibilityLabel={`Cor ${c}`}
          accessibilityState={{ selected: value === c }}
          onPress={() => onChange(c)}
          style={[styles.swatch, { backgroundColor: c }, value === c ? styles.selected : null]}
        />
      ))}
    </ScrollView>
  );
}

const SIZE = 32;

const styles = StyleSheet.create({
  row: { gap: space[2], paddingHorizontal: space[4], paddingVertical: 4 },
  swatch: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selected: { borderWidth: 3, borderColor: colors.accent },
  none: { backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  slash: { width: SIZE * 0.9, height: 2, backgroundColor: colors.danger, transform: [{ rotate: '45deg' }] },
});
