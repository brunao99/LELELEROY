import { StyleSheet, Switch, View } from 'react-native';

import { findItem, type AnyItem } from '@/core/ops';
import type { ItemKind, Project } from '@/core/types';
import { useEditor } from '@/state/editor';
import { Txt } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

/** Item selecionado (do tipo pedido) ou null. */
export function useSelected<T extends AnyItem>(project: Project, kinds: ItemKind[]): { id: string; kind: ItemKind; item: T } | null {
  const selection = useEditor((s) => s.selection);
  if (!selection || !kinds.includes(selection.kind)) return null;
  const found = findItem(project, selection.id);
  if (!found || !kinds.includes(found.kind)) return null;
  return { id: selection.id, kind: found.kind, item: found.item as T };
}

export function usePanelActions() {
  const apply = useEditor((s) => s.apply);
  const endGesture = useEditor((s) => s.endGesture);
  const openPanel = useEditor((s) => s.openPanel);
  const showToast = useEditor((s) => s.showToast);
  return { apply, endGesture, close: () => openPanel(null), showToast };
}

export function ToggleRow({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <View style={styles.toggle}>
      <View style={{ flex: 1 }}>
        <Txt variant="sm">{label}</Txt>
        {hint ? (
          <Txt variant="xs" tone="muted">
            {hint}
          </Txt>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: colors.accent, false: colors.border }}
        thumbColor={colors.text}
      />
    </View>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return (
    <Txt variant="xs" tone="muted" style={{ paddingHorizontal: space[4] }}>
      {children}
    </Txt>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space[4], gap: space[3], minHeight: 44 },
});
