/**
 * Faixa acima da barra de ferramentas: sem seleção, os modelos para o número de
 * fotos da colagem (e a colagem livre); com seleção, a dica dos gestos.
 */
import { MoreHorizontal } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  MAX_GRID_CELLS,
  collageAspect,
  findLayer,
  photosInUse,
  setFree,
  setTemplate,
  templatesFor,
  type Collage,
  type LayoutNode,
} from '@/core/collage';
import { newId } from '@/core/ids';
import { useCollage } from '@/state/collage';
import { Txt } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

import { LayoutThumb } from './LayoutThumb';

export const STRIP_HEIGHT = 72;

/** Medidas da miniatura com a proporção da colagem. */
export function thumbSize(aspect: number, long = 46): { width: number; height: number } {
  return aspect >= 1 ? { width: long, height: Math.round(long / aspect) } : { width: Math.round(long * aspect), height: long };
}

function Tile({ root, active, label, onPress, aspect }: { root: LayoutNode | null; active: boolean; label: string; onPress: () => void; aspect: number }) {
  const size = thumbSize(aspect);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed ? { opacity: 0.7 } : null]}
    >
      <LayoutThumb root={root} width={size.width} height={size.height} active={active} />
    </Pressable>
  );
}

export function CollageStrip({ collage }: { collage: Collage }) {
  const selection = useCollage((s) => s.selection);
  const apply = useCollage((s) => s.apply);
  const openPanel = useCollage((s) => s.openPanel);

  if (selection) {
    const layer = selection.kind === 'layer' ? findLayer(collage, selection.id) : null;
    const hint =
      selection.kind === 'cell'
        ? 'Arraste para enquadrar · pinça para aproximar · segure e arraste para trocar de lugar'
        : layer?.kind === 'text'
          ? 'Arraste para mover · toque de novo no texto para editar'
          : 'Arraste para mover · use dois dedos ou a alça do canto para girar e mudar o tamanho';
    return (
      <View style={[styles.strip, styles.hintBox]}>
        <Txt variant="xs" tone="muted" align="center">
          {hint}
        </Txt>
      </View>
    );
  }

  const aspect = collageAspect(collage.ratio);
  const count = Math.max(1, photosInUse(collage).length);
  const templates = count <= MAX_GRID_CELLS ? templatesFor(count) : [];
  return (
    <View style={styles.strip}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityRole="radiogroup">
        <Tile root={null} aspect={aspect} active={!collage.grid} label="Colagem livre" onPress={() => apply((c) => setFree(c, () => newId('l')))} />
        <View style={styles.sep} />
        {templates.map((t) => (
          <Tile
            key={t.id}
            root={t.build()}
            aspect={aspect}
            active={collage.grid?.template === t.id}
            label={`Modelo com ${t.cells} ${t.cells === 1 ? 'foto' : 'fotos'}`}
            onPress={() => apply((c) => setTemplate(c, t.id))}
          />
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mais modelos"
          onPress={() => openPanel('templates')}
          style={({ pressed }) => [styles.more, pressed ? { opacity: 0.7 } : null]}
        >
          <MoreHorizontal size={20} color={colors.textMuted} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { height: STRIP_HEIGHT, justifyContent: 'center' },
  hintBox: { paddingHorizontal: space[5] },
  row: { alignItems: 'center', paddingHorizontal: space[3], gap: space[2] },
  tile: { padding: 4, alignItems: 'center', justifyContent: 'center' },
  sep: { width: StyleSheet.hairlineWidth, height: 36, backgroundColor: colors.border, marginHorizontal: space[1] },
  more: { width: 44, height: 52, alignItems: 'center', justifyContent: 'center' },
});
