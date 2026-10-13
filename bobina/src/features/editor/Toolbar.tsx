import * as Haptics from 'expo-haptics';
import {
  ArrowLeft,
  AudioLines,
  Blend,
  Captions,
  Copy,
  Crop,
  Film,
  Gauge,
  Layers,
  Music,
  Palette,
  RectangleHorizontal,
  Replace,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  SquareDashed,
  Trash2,
  Type,
  Volume2,
  Wand2,
} from 'lucide-react-native';
import { ScrollView, StyleSheet, View } from 'react-native';

import { addOverlay, addText, duplicateItem, extractAudio, findItem, removeItem, replaceMedia, splitItem } from '@/core/ops';
import { layoutMain, mainSlotAt } from '@/core/timeline';
import type { Project } from '@/core/types';
import { importAll, pickVisualMedia } from '@/features/media/pick';
import { useEditor } from '@/state/editor';
import { ToolbarItem } from '@/ui/Button';
import { colors, layout, space } from '@/ui/theme';

import { useEditorRuntime } from './EditorContext';

export function Toolbar({ project, onAddMedia }: { project: Project; onAddMedia: () => void }) {
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const apply = useEditor((s) => s.apply);
  const applyAdded = useEditor((s) => s.applyAdded);
  const openPanel = useEditor((s) => s.openPanel);
  const showToast = useEditor((s) => s.showToast);
  const setBusy = useEditor((s) => s.setBusy);
  const { now, player } = useEditorRuntime();

  const found = selection ? findItem(project, selection.id) : null;
  const kind = found?.kind ?? null;
  const asset =
    found && (found.kind === 'main' || found.kind === 'overlay' || found.kind === 'audio')
      ? project.assets[(found.item as { assetId: string }).assetId]
      : undefined;
  const isPhoto = asset?.kind === 'image';
  const hasSound = !!asset && (asset.kind === 'audio' || asset.hasAudio);

  /** Seleciona o clipe sob a agulha (para ferramentas da tela principal). */
  const clipUnderPlayhead = (): string | null => {
    const slot = mainSlotAt(layoutMain(project), now());
    return slot?.clip.id ?? null;
  };

  const withClip = (panel: Parameters<typeof openPanel>[0]) => () => {
    const id = clipUnderPlayhead();
    if (!id) {
      showToast('Ponha a agulha sobre um clipe.');
      return;
    }
    player?.pause();
    useEditor.setState({ selection: { kind: 'main', id }, panel });
  };

  const split = () => {
    if (!selection) return;
    player?.pause();
    const ok = applyAdded((p) => splitItem(p, selection.id, now()), selection.kind);
    if (ok) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    else showToast('Não dá para dividir aqui: ponha a agulha dentro do item, longe das pontas.');
  };

  const remove = () => {
    if (!selection) return;
    apply((p) => removeItem(p, selection.id));
    select(null);
  };

  const duplicate = () => {
    if (!selection) return;
    if (!applyAdded((p) => duplicateItem(p, selection.id), selection.kind)) showToast('Este item não pode ser duplicado.');
  };

  const extract = () => {
    if (!selection) return;
    if (!applyAdded((p) => extractAudio(p, selection.id), 'audio')) showToast('Este clipe não tem som.');
    else showToast('Áudio separado na faixa de áudio.');
  };

  const pickOne = async () => {
    const picked = await pickVisualMedia({ multiple: false });
    if (picked.length === 0) return null;
    setBusy({ label: 'Importando', fraction: null });
    try {
      const { assets } = await importAll(project.id, picked, () => {});
      return assets[0] ?? null;
    } finally {
      setBusy(null);
    }
  };

  const replace = async () => {
    if (!selection) return;
    const id = selection.id;
    const asset = await pickOne();
    if (!asset) return;
    apply((p) => replaceMedia(p, id, asset));
    showToast('Mídia substituída.');
  };

  const addOverlayAtPlayhead = async () => {
    player?.pause();
    const t = now();
    const asset = await pickOne();
    if (!asset) return;
    applyAdded((p) => addOverlay(p, asset, t), 'overlay');
  };

  const addTextAtPlayhead = () => {
    player?.pause();
    applyAdded((p) => addText(p, now(), 'Texto'), 'text', { panel: 'text' });
  };

  let items: React.ReactNode;
  if (!selection || !found) {
    items = (
      <>
        <ToolbarItem icon={Scissors} label="Editar" onPress={() => {
          const id = clipUnderPlayhead();
          if (id) select({ kind: 'main', id });
          else showToast('Ponha a agulha sobre um clipe.');
        }} />
        <ToolbarItem icon={Music} label="Áudio" onPress={() => openPanel('audio')} />
        <ToolbarItem icon={Type} label="Texto" onPress={addTextAtPlayhead} />
        <ToolbarItem icon={Captions} label="Legendas" onPress={() => openPanel('captions')} />
        <ToolbarItem icon={Layers} label="Sobrepor" onPress={addOverlayAtPlayhead} />
        <ToolbarItem icon={Wand2} label="Filtros" onPress={withClip('filters')} />
        <ToolbarItem icon={SlidersHorizontal} label="Ajustar" onPress={withClip('adjust')} />
        <ToolbarItem icon={RectangleHorizontal} label="Formato" onPress={() => openPanel('format')} />
        <ToolbarItem icon={Palette} label="Fundo" onPress={() => openPanel('background')} />
      </>
    );
  } else if (kind === 'main' || kind === 'overlay') {
    items = (
      <>
        <ToolbarItem icon={Scissors} label="Dividir" onPress={split} />
        <ToolbarItem icon={Gauge} label="Velocidade" onPress={() => openPanel('speed')} disabled={isPhoto} />
        <ToolbarItem icon={Volume2} label="Volume" onPress={() => openPanel('volume')} disabled={!hasSound} />
        <ToolbarItem icon={Sparkles} label="Animação" onPress={() => openPanel('animation')} />
        <ToolbarItem icon={Wand2} label="Filtros" onPress={() => openPanel('filters')} />
        <ToolbarItem icon={SlidersHorizontal} label="Ajustar" onPress={() => openPanel('adjust')} />
        <ToolbarItem icon={Crop} label="Enquadrar" onPress={() => openPanel('frame')} />
        {kind === 'overlay' ? (
          <ToolbarItem icon={Blend} label="Mistura" onPress={() => openPanel('overlay')} />
        ) : (
          <ToolbarItem icon={SquareDashed} label="Opacidade" onPress={() => openPanel('opacity')} />
        )}
        <ToolbarItem icon={AudioLines} label="Extrair áudio" onPress={extract} disabled={!hasSound || isPhoto} />
        <ToolbarItem icon={Replace} label="Substituir" onPress={replace} />
        <ToolbarItem icon={Copy} label="Duplicar" onPress={duplicate} />
        <ToolbarItem icon={Trash2} label="Excluir" onPress={remove} danger />
      </>
    );
  } else if (kind === 'audio') {
    items = (
      <>
        <ToolbarItem icon={Scissors} label="Dividir" onPress={split} />
        <ToolbarItem icon={Volume2} label="Volume" onPress={() => openPanel('volume')} />
        <ToolbarItem icon={Gauge} label="Velocidade" onPress={() => openPanel('speed')} />
        <ToolbarItem icon={Copy} label="Duplicar" onPress={duplicate} />
        <ToolbarItem icon={Trash2} label="Excluir" onPress={remove} danger />
      </>
    );
  } else if (kind === 'text') {
    items = (
      <>
        <ToolbarItem icon={Type} label="Editar" onPress={() => openPanel('text')} />
        <ToolbarItem icon={Sparkles} label="Animação" onPress={() => openPanel('animation')} />
        <ToolbarItem icon={Scissors} label="Dividir" onPress={split} />
        <ToolbarItem icon={Copy} label="Duplicar" onPress={duplicate} />
        <ToolbarItem icon={Trash2} label="Excluir" onPress={remove} danger />
      </>
    );
  } else {
    items = (
      <>
        <ToolbarItem icon={Captions} label="Editar todas" onPress={() => openPanel('captionsBatch')} />
        <ToolbarItem icon={Type} label="Estilo" onPress={() => openPanel('captionStyle')} />
        <ToolbarItem icon={Scissors} label="Dividir" onPress={split} />
        <ToolbarItem icon={Trash2} label="Excluir" onPress={remove} danger />
      </>
    );
  }

  return (
    <View style={styles.bar}>
      {selection ? <ToolbarItem icon={ArrowLeft} label="Voltar" onPress={() => select(null)} /> : <ToolbarItem icon={Film} label="Adicionar" onPress={onAddMedia} />}
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
