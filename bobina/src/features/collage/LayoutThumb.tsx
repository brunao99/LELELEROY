/**
 * Miniatura de um modelo de grade (as divisões viram caixas com flex) e a da
 * colagem livre (duas fotos tortas, uma sobre a outra).
 */
import { StyleSheet, View } from 'react-native';

import type { LayoutNode } from '@/core/collage';
import { colors } from '@/ui/theme';

const GAP = 2;

function Node({ node, color }: { node: LayoutNode; color: string }) {
  if (node.kind === 'cell') return <View style={[styles.cell, { backgroundColor: color }]} />;
  return (
    <View style={{ flex: 1, flexDirection: node.dir === 'row' ? 'row' : 'column', gap: GAP }}>
      {node.children.map((child, i) => (
        <View key={i} style={{ flex: node.sizes[i] }}>
          <Node node={child} color={color} />
        </View>
      ))}
    </View>
  );
}

export function LayoutThumb({ root, width, height, active }: { root: LayoutNode | null; width: number; height: number; active: boolean }) {
  const color = active ? colors.accent : colors.textMuted;
  return (
    <View style={[styles.frame, { width, height, borderColor: active ? colors.accent : 'transparent' }]}>
      {root ? (
        <View style={{ flex: 1, padding: 3 }}>
          <Node node={root} color={color} />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={[styles.loose, { left: '10%', top: '16%', width: '62%', height: '44%', backgroundColor: color, transform: [{ rotate: '-10deg' }] }]} />
          <View style={[styles.loose, { right: '8%', bottom: '14%', width: '62%', height: '44%', backgroundColor: color, transform: [{ rotate: '8deg' }] }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderWidth: 1.5, borderRadius: 7, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  cell: { flex: 1, borderRadius: 2, opacity: 0.85 },
  loose: { position: 'absolute', borderRadius: 2, borderWidth: 1.5, borderColor: colors.surfaceRaised },
});
