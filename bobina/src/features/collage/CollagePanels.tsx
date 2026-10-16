/**
 * Painéis do editor de colagem (no lugar da barra de ferramentas): modelos,
 * fundo, bordas, formato, texto, contorno da figurinha, moldura, opacidade,
 * escolher a foto da figurinha e salvar a imagem.
 */
import { useFonts } from '@shopify/react-native-skia';
import * as Sharing from 'expo-sharing';
import { ImagePlus, Lasso, Share2 } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import {
  COLLAGE_RATIOS,
  collageAspect,
  collageExportSize,
  findLayer,
  photosInUse,
  setBackground,
  setBorders,
  setFree,
  setRatio,
  setTemplate,
  templatesFor,
  updateLayer,
  type Collage,
  type CollageExportSize,
  type CollageLayer,
} from '@/core/collage';
import { newId } from '@/core/ids';
import type { TextStyle } from '@/core/types';
import { exportCollage } from '@/engine/collageExport';
import { CUTOUT_MODEL, downloadCutoutModel, isCutoutModelReady } from '@/engine/cutout';
import { FONT_SOURCES } from '@/engine/fonts';
import { ToggleRow } from '@/features/editor/panels/common';
import { TextStyleEditor } from '@/features/editor/panels/TextPanel';
import { useCollage, type CollagePanel } from '@/state/collage';
import { collageUri } from '@/storage/collages';
import { Button, Row } from '@/ui/Button';
import { ChoiceRow } from '@/ui/Chip';
import { ColorRow } from '@/ui/ColorRow';
import { ProgressBar } from '@/ui/Feedback';
import { Panel, SectionLabel } from '@/ui/Panel';
import { Slider } from '@/ui/Slider';
import { Txt } from '@/ui/Text';
import { colors, radius, space, SWATCHES } from '@/ui/theme';

import { TEXT_PLACEHOLDER, type useCollageActions } from './actions';
import { LayoutThumb } from './LayoutThumb';
import { thumbSize } from './CollageStrip';

type Actions = ReturnType<typeof useCollageActions>;

/** Fundos claros e suaves primeiro (combinam com foto), depois a paleta do app. */
const BACKGROUNDS = ['#ffffff', '#f4efe6', '#fde2e4', '#fff1c1', '#e2ece9', '#dbe7f6', '#e9d8fd', '#111111', ...SWATCHES.slice(1)];

const GRADIENTS: [string, string][] = [
  ['#ffecd2', '#fcb69f'],
  ['#fbc2eb', '#a18cd1'],
  ['#84fab0', '#8fd3f4'],
  ['#fccb90', '#d57eeb'],
  ['#ffb547', '#ff6b6b'],
  ['#a1c4fd', '#c2e9fb'],
  ['#30cfd0', '#330867'],
  ['#0f2027', '#2c5364'],
];

const SIZES: { value: CollageExportSize; label: string }[] = [
  { value: 1080, label: 'HD' },
  { value: 1440, label: '2K' },
  { value: 2160, label: '4K' },
];

function useClose() {
  const openPanel = useCollage((s) => s.openPanel);
  const endGesture = useCollage((s) => s.endGesture);
  return () => {
    endGesture();
    openPanel(null);
  };
}

export function CollagePanels({ collage, actions, panel }: { collage: Collage; actions: Actions; panel: CollagePanel }) {
  switch (panel) {
    case 'templates':
      return <TemplatesPanel collage={collage} />;
    case 'background':
      return <BackgroundPanel collage={collage} />;
    case 'borders':
      return <BordersPanel collage={collage} />;
    case 'format':
      return <FormatPanel collage={collage} />;
    case 'text':
      return <TextLayerPanel collage={collage} />;
    case 'outline':
    case 'frame':
    case 'opacity':
      return <LayerPanel collage={collage} panel={panel} />;
    case 'sticker':
      return <StickerSourcePanel collage={collage} actions={actions} />;
    case 'save':
      return <SavePanel collage={collage} />;
  }
}

// ------------------------------------------------------------------ grade e quadro

function TemplatesPanel({ collage }: { collage: Collage }) {
  const close = useClose();
  const apply = useCollage((s) => s.apply);
  const used = photosInUse(collage).length;
  const [count, setCount] = useState(Math.min(9, Math.max(1, used)));
  const aspect = collageAspect(collage.ratio);
  const size = thumbSize(aspect, 58);
  return (
    <Panel title="Modelos" onDone={close}>
      <SectionLabel>Células</SectionLabel>
      <ChoiceRow options={Array.from({ length: 9 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))} value={count} onChange={setCount} />
      <View style={styles.wrap}>
        <Pressable
          accessibilityRole="radio"
          accessibilityLabel="Colagem livre"
          accessibilityState={{ selected: !collage.grid }}
          onPress={() => apply((c) => setFree(c, () => newId('l')))}
          style={styles.wrapTile}
        >
          <LayoutThumb root={null} width={size.width} height={size.height} active={!collage.grid} />
          <Txt variant="xs" tone="muted">
            Livre
          </Txt>
        </Pressable>
        {templatesFor(count).map((t) => (
          <Pressable
            key={t.id}
            accessibilityRole="radio"
            accessibilityLabel={`Modelo com ${t.cells} células`}
            accessibilityState={{ selected: collage.grid?.template === t.id }}
            onPress={() => apply((c) => setTemplate(c, t.id))}
            style={styles.wrapTile}
          >
            <LayoutThumb root={t.build()} width={size.width} height={size.height} active={collage.grid?.template === t.id} />
          </Pressable>
        ))}
      </View>
      {count > used ? (
        <Txt variant="xs" tone="muted" style={styles.note}>
          As células que sobrarem ficam com um +. Toque nelas para pôr uma foto.
        </Txt>
      ) : null}
    </Panel>
  );
}

function GradientSwatch({ from, to, selected, onPress }: { from: string; to: string; selected: boolean; onPress: () => void }) {
  const id = `g${from.slice(1)}${to.slice(1)}`;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`Degradê de ${from} para ${to}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.gradient, selected ? styles.gradientOn : null]}
    >
      <Svg width={32} height={32}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Circle cx={16} cy={16} r={16} fill={`url(#${id})`} />
      </Svg>
    </Pressable>
  );
}

function BackgroundPanel({ collage }: { collage: Collage }) {
  const close = useClose();
  const apply = useCollage((s) => s.apply);
  const bg = collage.background;
  return (
    <Panel title="Fundo" onDone={close}>
      <SectionLabel>Cor</SectionLabel>
      <ColorRow
        label="Cor do fundo"
        swatches={BACKGROUNDS}
        value={bg.kind === 'color' ? bg.color : null}
        onChange={(color) => apply((c) => setBackground(c, { kind: 'color', color }))}
      />
      <SectionLabel>Degradê</SectionLabel>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatches}>
        {GRADIENTS.map(([from, to]) => (
          <GradientSwatch
            key={from + to}
            from={from}
            to={to}
            selected={bg.kind === 'gradient' && bg.from === from && bg.to === to}
            onPress={() => apply((c) => setBackground(c, { kind: 'gradient', from, to, angle: 60 }))}
          />
        ))}
      </ScrollView>
      {collage.grid && collage.spacing === 0 && collage.margin === 0 ? (
        <Txt variant="xs" tone="muted" style={styles.note}>
          Sem espaço entre as fotos o fundo não aparece. Ajuste em Bordas.
        </Txt>
      ) : null}
    </Panel>
  );
}

function BordersPanel({ collage }: { collage: Collage }) {
  const close = useClose();
  const apply = useCollage((s) => s.apply);
  const endGesture = useCollage((s) => s.endGesture);
  const slider = (label: string, field: 'spacing' | 'margin' | 'radius', fallback: number) => (
    <Slider
      label={label}
      value={Math.round(collage[field] * 100)}
      min={0}
      max={100}
      defaultValue={fallback}
      step={1}
      format={(v) => `${Math.round(v)}`}
      onChange={(v) => apply((c) => setBorders(c, { [field]: v / 100 }), { key: `borders:${field}` })}
      onCommit={endGesture}
    />
  );
  return (
    <Panel title="Bordas" onDone={close}>
      {slider('Espaço entre as fotos', 'spacing', 35)}
      {slider('Margem', 'margin', 35)}
      {slider('Cantos arredondados', 'radius', 20)}
    </Panel>
  );
}

function FormatPanel({ collage }: { collage: Collage }) {
  const close = useClose();
  const apply = useCollage((s) => s.apply);
  return (
    <Panel title="Formato" onDone={close}>
      <ChoiceRow
        options={COLLAGE_RATIOS.map((r) => ({ value: r.value, label: `${r.label} · ${r.use}` }))}
        value={collage.ratio}
        onChange={(ratio) => apply((c) => setRatio(c, ratio))}
      />
      <Txt variant="xs" tone="muted" style={styles.note}>
        As fotos, figurinhas e textos acompanham o formato novo.
      </Txt>
    </Panel>
  );
}

// ------------------------------------------------------------------ camadas

function TextLayerPanel({ collage }: { collage: Collage }) {
  const selection = useCollage((s) => s.selection);
  const layer = selection?.kind === 'layer' ? findLayer(collage, selection.id) : undefined;
  if (!layer || layer.kind !== 'text') return null;
  // Um editor por texto: trocar de texto recomeça o rascunho.
  return <TextEditor key={layer.id} id={layer.id} text={layer.text} style={layer.style} />;
}

function TextEditor({ id, text, style }: { id: string; text: string; style: TextStyle }) {
  const close = useClose();
  const apply = useCollage((s) => s.apply);
  const endGesture = useCollage((s) => s.endGesture);
  const [draft, setDraft] = useState(text);
  const [fresh] = useState(() => text === TEXT_PLACEHOLDER);
  const setLayer = (fn: (l: Extract<CollageLayer, { kind: 'text' }>) => Extract<CollageLayer, { kind: 'text' }>, key?: string) =>
    apply((c) => updateLayer(c, id, (l) => (l.kind === 'text' ? fn(l) : l)), key ? { key } : undefined);
  return (
    <Panel title="Texto" onDone={close}>
      <TextInput
        value={draft}
        onChangeText={(t) => {
          setDraft(t);
          setLayer((l) => ({ ...l, text: t }), `text:${id}`);
        }}
        onBlur={endGesture}
        autoFocus={fresh}
        selectTextOnFocus={fresh}
        multiline
        placeholder="Digite o texto"
        placeholderTextColor={colors.textFaint}
        style={styles.input}
        accessibilityLabel="Texto"
      />
      <TextStyleEditor
        style={style}
        keyPrefix={`style:${id}`}
        onChange={(patch, key) => setLayer((l) => ({ ...l, style: { ...l.style, ...patch } }), key)}
        onCommit={endGesture}
      />
    </Panel>
  );
}

function LayerPanel({ collage, panel }: { collage: Collage; panel: 'outline' | 'frame' | 'opacity' }) {
  const close = useClose();
  const apply = useCollage((s) => s.apply);
  const endGesture = useCollage((s) => s.endGesture);
  const selection = useCollage((s) => s.selection);
  const layer = selection?.kind === 'layer' ? findLayer(collage, selection.id) : undefined;
  if (!layer || layer.kind === 'text') return null;
  const id = layer.id;
  const set = (patch: Partial<CollageLayer>, key?: string) =>
    apply((c) => updateLayer(c, id, (l) => ({ ...l, ...patch }) as CollageLayer), key ? { key } : undefined);

  if (panel === 'opacity') {
    return (
      <Panel title="Opacidade" onDone={close}>
        <Slider
          label="Opacidade"
          value={Math.round(layer.opacity * 100)}
          min={0}
          max={100}
          defaultValue={100}
          step={1}
          format={(v) => `${Math.round(v)}%`}
          onChange={(v) => set({ opacity: v / 100 }, `opacity:${id}`)}
          onCommit={endGesture}
        />
      </Panel>
    );
  }

  if (panel === 'outline' && layer.kind === 'sticker') {
    const outline = layer.outline;
    return (
      <Panel title="Contorno" onDone={close}>
        <ToggleRow
          label="Contorno"
          hint="A borda das figurinhas de papel."
          value={!!outline}
          onChange={(on) => set({ outline: on ? { color: '#ffffff', width: 0.5 } : null })}
        />
        {outline ? (
          <>
            <ColorRow label="Cor do contorno" value={outline.color} onChange={(color) => set({ outline: { ...outline, color } })} />
            <Slider
              label="Espessura"
              value={Math.round(outline.width * 100)}
              min={5}
              max={100}
              defaultValue={50}
              step={1}
              format={(v) => `${Math.round(v)}%`}
              onChange={(v) => set({ outline: { ...outline, width: v / 100 } }, `outline:${id}`)}
              onCommit={endGesture}
            />
          </>
        ) : null}
        <ToggleRow label="Sombra" value={layer.shadow} onChange={(shadow) => set({ shadow })} />
      </Panel>
    );
  }

  if (panel === 'frame' && layer.kind === 'photo') {
    const border = layer.border;
    return (
      <Panel title="Moldura" onDone={close}>
        <ToggleRow
          label="Moldura"
          hint="Borda em volta da foto, como uma foto impressa."
          value={!!border}
          onChange={(on) => set({ border: on ? { color: '#ffffff', width: 0.035 } : null })}
        />
        {border ? (
          <>
            <ColorRow label="Cor da moldura" value={border.color} onChange={(color) => set({ border: { ...border, color } })} />
            <Slider
              label="Largura"
              value={Math.round(border.width * 1000)}
              min={5}
              max={120}
              defaultValue={35}
              step={1}
              format={(v) => `${(v / 10).toFixed(1).replace('.', ',')}%`}
              onChange={(v) => set({ border: { ...border, width: v / 1000 } }, `border:${id}`)}
              onCommit={endGesture}
            />
          </>
        ) : null}
        <ToggleRow label="Sombra" value={layer.shadow} onChange={(shadow) => set({ shadow })} />
      </Panel>
    );
  }
  return null;
}

// ------------------------------------------------------------------ figurinha

function StickerSourcePanel({ collage, actions }: { collage: Collage; actions: Actions }) {
  const close = useClose();
  const [ready, setReady] = useState(isCutoutModelReady);
  const [download, setDownload] = useState<{ fraction: number } | { error: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const photos = photosInUse(collage)
    .map((id) => collage.photos[id])
    .filter((p) => !!p);

  const getModel = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setDownload({ fraction: 0 });
    try {
      await downloadCutoutModel((fraction) => setDownload({ fraction }), controller.signal);
      setDownload(null);
      setReady(isCutoutModelReady());
    } catch (e) {
      setDownload(controller.signal.aborted ? null : { error: `O download não terminou: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      abort.current = null;
    }
  };

  return (
    <Panel title="Figurinha" onDone={close}>
      {!ready ? (
        <View style={styles.card}>
          <Txt variant="base" weight="600">
            Figurinhas com laço
          </Txt>
          <Txt variant="sm" tone="muted">
            Contorne uma pessoa, um bichinho ou um objeto numa foto e ele vira uma figurinha com borda, para colocar por cima da
            colagem. Usa o EdgeTAM, um modelo da Meta que roda no próprio celular. Baixe uma vez ({CUTOUT_MODEL.megabytes} MB);
            depois funciona sem internet.
          </Txt>
          {download && 'fraction' in download ? (
            <View style={{ gap: space[2] }}>
              <ProgressBar fraction={download.fraction} />
              <Button label="Cancelar" variant="ghost" size="sm" onPress={() => abort.current?.abort()} />
            </View>
          ) : (
            <Button label={`Baixar o modelo (${CUTOUT_MODEL.megabytes} MB)`} onPress={getModel} />
          )}
          {download && 'error' in download ? (
            <Txt variant="sm" tone="danger">
              {download.error}
            </Txt>
          ) : null}
        </View>
      ) : (
        <>
          <SectionLabel>De qual foto?</SectionLabel>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
            {photos.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel="Recortar desta foto"
                onPress={() => actions.lassoPhoto(p.id)}
                style={({ pressed }) => [styles.photo, pressed ? { opacity: 0.7 } : null]}
              >
                <Image source={{ uri: collageUri(collage.id, p.preview) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Escolher outra foto da galeria"
              onPress={actions.lassoNewPhoto}
              style={({ pressed }) => [styles.photo, styles.photoNew, pressed ? { opacity: 0.7 } : null]}
            >
              <ImagePlus size={22} color={colors.text} />
              <Txt variant="xs" tone="muted">
                Outra
              </Txt>
            </Pressable>
          </ScrollView>
          <View style={styles.tip}>
            <Lasso size={16} color={colors.accent} />
            <Txt variant="xs" tone="muted" style={{ flex: 1 }}>
              Contorne o objeto com o dedo. Não precisa ser exato: a IA acha a borda.
            </Txt>
          </View>
        </>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ salvar

function SavePanel({ collage }: { collage: Collage }) {
  const close = useClose();
  const apply = useCollage((s) => s.apply);
  const setBusy = useCollage((s) => s.setBusy);
  const showToast = useCollage((s) => s.showToast);
  const provider = useFonts(FONT_SOURCES);
  const [saved, setSaved] = useState<{ uri: string; gallery: boolean } | null>(null);
  const size = collageExportSize(collage);

  const save = async () => {
    if (!provider) return;
    setBusy({ label: 'Salvando a imagem', fraction: null });
    try {
      const out = await exportCollage(collage, provider, collage.exportSize);
      setSaved({ uri: out.uri, gallery: out.savedToGallery });
      showToast(out.savedToGallery ? 'Imagem salva na galeria.' : 'Sem permissão para a galeria. Use Compartilhar.', out.savedToGallery ? 'info' : 'error');
    } catch (e) {
      showToast(`Não foi possível salvar: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    if (saved && (await Sharing.isAvailableAsync())) await Sharing.shareAsync(saved.uri, { mimeType: 'image/jpeg', dialogTitle: 'Compartilhar colagem' });
  };

  return (
    <Panel title="Salvar imagem" onDone={close}>
      <View style={styles.summary}>
        <Txt variant="lg" tabular>
          {size.width}×{size.height}
        </Txt>
        <Txt variant="sm" tone="muted">
          JPEG em alta qualidade
        </Txt>
      </View>
      <SectionLabel>Tamanho</SectionLabel>
      <ChoiceRow
        options={SIZES}
        value={collage.exportSize}
        onChange={(exportSize) => {
          setSaved(null);
          apply((c) => ({ ...c, exportSize }));
        }}
      />
      <Row style={{ paddingHorizontal: space[4] }}>
        <Button label="Salvar na galeria" onPress={save} disabled={!provider} style={{ flex: 1 }} />
        {saved ? <Button label="Compartilhar" icon={Share2} variant="secondary" onPress={share} /> : null}
      </Row>
    </Panel>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], paddingHorizontal: space[4] },
  wrapTile: { alignItems: 'center', gap: 4, padding: 2 },
  note: { paddingHorizontal: space[4] },
  swatches: { gap: space[2], paddingHorizontal: space[4], paddingVertical: 4 },
  gradient: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden' },
  gradientOn: { borderWidth: 3, borderColor: colors.accent },
  input: {
    marginHorizontal: space[4],
    minHeight: 48,
    maxHeight: 110,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderInput,
    color: colors.text,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    fontSize: 16,
  },
  card: {
    marginHorizontal: space[4],
    padding: space[4],
    gap: space[3],
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceRaised,
  },
  photos: { gap: space[2], paddingHorizontal: space[4] },
  photo: {
    width: 68,
    height: 68,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoNew: { gap: 2, borderWidth: 1, borderColor: colors.border },
  tip: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[4] },
  summary: {
    marginHorizontal: space[4],
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceRaised,
    gap: space[1],
  },
});
