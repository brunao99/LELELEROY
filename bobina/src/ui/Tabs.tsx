import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Txt } from './Text';
import { colors, space } from './theme';

export interface TabsProps<T extends string> {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}

export function Tabs<T extends string>({ tabs, value, onChange }: TabsProps<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityRole="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
            onPress={() => onChange(tab.id)}
            style={styles.tab}
          >
            <Txt variant="sm" weight="600" tone={active ? 'default' : 'muted'}>
              {tab.label}
            </Txt>
            <View style={[styles.underline, { backgroundColor: active ? colors.accent : 'transparent' }]} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: space[3], gap: space[1] },
  tab: { paddingHorizontal: space[3], paddingTop: space[3], paddingBottom: space[1], alignItems: 'center', gap: 6, minHeight: 44 },
  underline: { height: 2, alignSelf: 'stretch', borderRadius: 1 },
});
