/**
 * Barra de ferramentas da colagem: as gerais quando nada está selecionado e as
 * do item quando há seleção (célula da grade, foto solta, figurinha ou texto).
 */
import {
  ArrowLeft,
  Blend,
  BringToFront,
  CircleDashed,
  Copy,
  Download,
  FlipHorizontal2,
  Frame,
  ImagePlus,
  Lasso,
  LayoutGrid,
  Maximize2,
  Palette,
  Pencil,
  RectangleHorizontal,
  Replace,
  SendToBack,
  SquareDashed,
  Trash2,
  Type,
} from 'lucide-react-native';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  NO_FRAMING,
  duplicateLayer,
  findLayer,
  framingOf,
  moveLayer,
  removeLayer,
  setSlot,
  updateFraming,
  updateLayer,
  type Collage,
} from '@/core/collage';
import { newId } from '@/core/ids';
import { exportSticker } from '@/engine/collageExport';
import { useCollage } from '@/state/collage';
import { ToolbarItem } from '@/ui/Button';
import { colors, layout, space } from '@/ui/theme';

import type { useCollageActions } from './actions';

type Actions = ReturnType<typeof useCollageActions>;

export function CollageToolbar({ collage, actions }: { collage: Collage; actions: Actions }) {
  const selection = useCollage((s) => s.selection);
  const select = useCollage((s) => s.select);
  const apply = useCollage((s) => s.apply);
  const openPanel = useCollage((s) => s.openPanel);
  const showToast = useCollage((s) => s.showToast);
  const setBusy = useCollage((s) => s.setBusy);
  const back = () => select(null);

  let items: React.ReactNode;
  if (selection?.kind === 'cell') {
    const index = selection.index;
    const photoId = collage.slots[index];
    if (!photoId) return null;
    const framing = framingOf(collage, photoId);
    items = (
      <>
        <ToolbarItem icon={Replace} label="Trocar" onPress={() => actions.fillCell(index)} />
        <ToolbarItem icon={Lasso} label="Figurinha" onPress={() => actions.lassoPhoto(photoId)} />
        <ToolbarItem icon={FlipHorizontal2} label="Espelhar" onPress={() => apply((c) => updateFraming(c, photoId, { flipH: !framing.flipH }))} />
        <ToolbarItem
          icon={Maximize2}
          label="Encaixar"
          disabled={framing.zoom === 1 && framing.x === 0 && framing.y === 0}
          onPress={() => apply((c) => updateFraming(c, photoId, { ...NO_FRAMING, flipH: framing.flipH }))}
        />
        <ToolbarItem
          icon={Trash2}
          label="Tirar"
          danger
          onPress={() => {
            apply((c) => setSlot(c, index, null));
            back();
          }}
        />
      </>
    );
  } else if (selection?.kind === 'layer') {
    const layer = findLayer(collage, selection.id);
    if (!layer) return null;
    const id = layer.id;
    const common = (
      <>
        <ToolbarItem
          icon={Copy}
          label="Duplicar"
          onPress={() => {
            const copyId = newId('l');
            apply((c) => duplicateLayer(c, id, copyId));
            select({ kind: 'layer', id: copyId });
          }}
        />
        <ToolbarItem icon={BringToFront} label="Frente" onPress={() => apply((c) => moveLayer(c, id, 'front'))} />
        <ToolbarItem icon={SendToBack} label="Trás" onPress={() => apply((c) => moveLayer(c, id, 'back'))} />
        <ToolbarItem
          icon={Trash2}
          label="Apagar"
          danger
          onPress={() => {
            apply((c) => removeLayer(c, id));
            back();
          }}
        />
      </>
    );
    const flip = (
      <ToolbarItem
        icon={FlipHorizontal2}
        label="Espelhar"
        onPress={() => apply((c) => updateLayer(c, id, (l) => (l.kind === 'text' ? l : { ...l, flipH: !l.flipH })))}
      />
    );
    if (layer.kind === 'photo') {
      items = (
        <>
            <ToolbarItem icon={Lasso} label="Figurinha" onPress={() => actions.lassoPhoto(layer.photoId)} />
          <ToolbarItem icon={Frame} label="Moldura" onPress={() => openPanel('frame')} />
          <ToolbarItem icon={Blend} label="Opacidade" onPress={() => openPanel('opacity')} />
          {flip}
          {common}
        </>
      );
    } else if (layer.kind === 'sticker') {
      items = (
        <>
            <ToolbarItem icon={CircleDashed} label="Contorno" active={!!layer.outline} onPress={() => openPanel('outline')} />
          <ToolbarItem icon={Blend} label="Opacidade" onPress={() => openPanel('opacity')} />
          {flip}
          <ToolbarItem
            icon={Download}
            label="Salvar PNG"
            onPress={async () => {
              setBusy({ label: 'Salvando a figurinha', fraction: null });
              try {
                const saved = await exportSticker(collage, layer);
                showToast(saved.savedToGallery ? 'Figurinha salva na galeria.' : 'Sem permissão para salvar na galeria.', saved.savedToGallery ? 'info' : 'error');
              } catch (e) {
                showToast(`Não foi possível salvar: ${e instanceof Error ? e.message : String(e)}`, 'error');
              } finally {
                setBusy(null);
              }
            }}
          />
          {common}
        </>
      );
    } else {
      items = (
        <>
            <ToolbarItem icon={Pencil} label="Editar" onPress={() => openPanel('text')} />
          {common}
        </>
      );
    }
  } else {
    items = (
      <>
        <ToolbarItem icon={Lasso} label="Figurinha" onPress={() => openPanel('sticker')} />
        <ToolbarItem icon={Type} label="Texto" onPress={actions.addText} />
        <ToolbarItem icon={LayoutGrid} label="Modelos" onPress={() => openPanel('templates')} />
        <ToolbarItem icon={Palette} label="Fundo" onPress={() => openPanel('background')} />
        <ToolbarItem icon={SquareDashed} label="Bordas" disabled={!collage.grid} onPress={() => openPanel('borders')} />
        <ToolbarItem icon={RectangleHorizontal} label="Formato" onPress={() => openPanel('format')} />
      </>
    );
  }

  return (
    <View style={styles.bar}>
      {selection ? (
        <ToolbarItem icon={ArrowLeft} label="Voltar" onPress={back} />
      ) : (
        <ToolbarItem icon={ImagePlus} label="Fotos" onPress={actions.addMorePhotos} />
      )}
      <View style={styles.divider} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.items}>
        {items}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: layout.toolbar,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingLeft: space[1],
  },
  divider: { width: StyleSheet.hairlineWidth, height: 40, backgroundColor: colors.border, marginHorizontal: space[1] },
  items: { alignItems: 'center', paddingRight: space[2] },
});
