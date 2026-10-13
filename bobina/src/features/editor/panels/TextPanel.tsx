import { AlignCenter, AlignLeft, AlignRight, Bold, Italic } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { updateText, updateTextStyle } from '@/core/ops';
import type { Project, TextItem, TextStyle } from '@/core/types';
import { FONTS } from '@/engine/fonts';
import { IconButton, Row } from '@/ui/Button';
import { ChoiceRow } from '@/ui/Chip';
import { ColorRow } from '@/ui/ColorRow';
import { Panel, SectionLabel } from '@/ui/Panel';
import { Slider } from '@/ui/Slider';
import { Tabs } from '@/ui/Tabs';
import { colors, radius, space } from '@/ui/theme';

import { ToggleRow, useSelected, usePanelActions } from './common';

type StyleTab = 'font' | 'style' | 'stroke' | 'background';

/** Editor de estilo de texto (usado no texto e nas legendas). */
export function TextStyleEditor({
  style,
  onChange,
  onCommit,
  keyPrefix,
}: {
  style: TextStyle;
  onChange: (patch: Partial<TextStyle>, key?: string) => void;
  onCommit: () => void;
  keyPrefix: string;
}) {
  const [tab, setTab] = useState<StyleTab>('font');
  return (
    <>
      <Tabs
        tabs={[
          { id: 'font', label: 'Fonte' },
          { id: 'style', label: 'Estilo' },
          { id: 'stroke', label: 'Contorno' },
          { id: 'background', label: 'Fundo' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'font' ? (
        <>
          <ChoiceRow options={FONTS.map((f) => ({ value: f.id, label: f.label }))} value={style.font} onChange={(font) => onChange({ font })} />
          <Slider
            label="Tamanho"
            value={Math.round(style.size * 1000)}
            min={20}
            max={250}
            defaultValue={70}
            step={1}
            onChange={(v) => onChange({ size: v / 1000 }, `${keyPrefix}:size`)}
            onCommit={onCommit}
          />
          <Row style={{ paddingHorizontal: space[3] }}>
            <IconButton icon={Bold} label="Negrito" active={style.bold} onPress={() => onChange({ bold: !style.bold })} />
            <IconButton icon={Italic} label="Itálico" active={style.italic} onPress={() => onChange({ italic: !style.italic })} />
            <View style={{ width: space[3] }} />
            <IconButton icon={AlignLeft} label="Alinhar à esquerda" active={style.align === 'left'} onPress={() => onChange({ align: 'left' })} />
            <IconButton icon={AlignCenter} label="Centralizar" active={style.align === 'center'} onPress={() => onChange({ align: 'center' })} />
            <IconButton icon={AlignRight} label="Alinhar à direita" active={style.align === 'right'} onPress={() => onChange({ align: 'right' })} />
          </Row>
        </>
      ) : tab === 'style' ? (
        <>
          <SectionLabel>Cor</SectionLabel>
          <ColorRow label="Cor do texto" value={style.color} onChange={(color) => onChange({ color })} />
          <Slider
            label="Opacidade"
            value={Math.round(style.opacity * 100)}
            min={0}
            max={100}
            defaultValue={100}
            step={1}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) => onChange({ opacity: v / 100 }, `${keyPrefix}:opacity`)}
            onCommit={onCommit}
          />
          <Slider
            label="Espaçamento entre letras"
            value={Math.round(style.letterSpacing * 100)}
            min={-10}
            max={50}
            defaultValue={0}
            step={1}
            onChange={(v) => onChange({ letterSpacing: v / 100 }, `${keyPrefix}:spacing`)}
            onCommit={onCommit}
          />
          <ToggleRow
            label="Sombra"
            value={!!style.shadow}
            onChange={(on) => onChange({ shadow: on ? { color: '#000000', blur: 0.06, dx: 0, dy: 0.03 } : null })}
          />
        </>
      ) : tab === 'stroke' ? (
        <>
          <ToggleRow label="Contorno" value={!!style.stroke} onChange={(on) => onChange({ stroke: on ? { color: '#000000', width: 0.12 } : null })} />
          {style.stroke ? (
            <>
              <ColorRow label="Cor do contorno" value={style.stroke.color} onChange={(color) => onChange({ stroke: { ...style.stroke!, color } })} />
              <Slider
                label="Espessura"
                value={Math.round(style.stroke.width * 100)}
                min={2}
                max={40}
                defaultValue={12}
                step={1}
                onChange={(v) => onChange({ stroke: { ...style.stroke!, width: v / 100 } }, `${keyPrefix}:strokeWidth`)}
                onCommit={onCommit}
              />
            </>
          ) : null}
        </>
      ) : (
        <>
          <ToggleRow
            label="Fundo atrás do texto"
            value={!!style.background}
            onChange={(on) => onChange({ background: on ? { color: '#000000', opacity: 0.6, radius: 0.2 } : null })}
          />
          {style.background ? (
            <>
              <ColorRow label="Cor do fundo" value={style.background.color} onChange={(color) => onChange({ background: { ...style.background!, color } })} />
              <Slider
                label="Opacidade do fundo"
                value={Math.round(style.background.opacity * 100)}
                min={0}
                max={100}
                defaultValue={60}
                step={1}
                format={(v) => `${Math.round(v)}%`}
                onChange={(v) => onChange({ background: { ...style.background!, opacity: v / 100 } }, `${keyPrefix}:bgOpacity`)}
                onCommit={onCommit}
              />
              <Slider
                label="Cantos"
                value={Math.round(style.background.radius * 100)}
                min={0}
                max={60}
                defaultValue={20}
                step={1}
                onChange={(v) => onChange({ background: { ...style.background!, radius: v / 100 } }, `${keyPrefix}:bgRadius`)}
                onCommit={onCommit}
              />
            </>
          ) : null}
        </>
      )}
    </>
  );
}

export function TextPanel({ project }: { project: Project }) {
  const selected = useSelected<TextItem>(project, ['text']);
  if (!selected) return null;
  // Um editor por texto: trocar de texto selecionado recomeça o rascunho.
  return <TextEditor key={selected.id} item={selected.item} />;
}

function TextEditor({ item }: { item: TextItem }) {
  const { apply, endGesture, close } = usePanelActions();
  const [draft, setDraft] = useState(item.text);
  return (
    <Panel title="Texto" onDone={close}>
      <TextInput
        value={draft}
        onChangeText={(t) => {
          setDraft(t);
          apply((p) => updateText(p, item.id, { text: t }), { key: `text:${item.id}` });
        }}
        onBlur={endGesture}
        autoFocus={item.text === 'Texto'}
        selectTextOnFocus={item.text === 'Texto'}
        multiline
        placeholder="Digite o texto"
        placeholderTextColor={colors.textFaint}
        style={styles.input}
        accessibilityLabel="Texto"
      />
      <TextStyleEditor
        style={item.style}
        keyPrefix={`style:${item.id}`}
        onChange={(patch, key) => apply((p) => updateTextStyle(p, item.id, patch), key ? { key } : undefined)}
        onCommit={endGesture}
      />
    </Panel>
  );
}

const styles = StyleSheet.create({
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
});
