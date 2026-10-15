/** Efeitos de vídeo e chroma key do clipe selecionado. */
import { CHROMA_PRESETS, DEFAULT_CHROMA, EFFECTS } from '@/core/effects';
import { updateVisual } from '@/core/ops';
import type { ChromaKey, EffectKind, MainClip, OverlayClip, Project } from '@/core/types';
import { ChoiceRow } from '@/ui/Chip';
import { ColorRow } from '@/ui/ColorRow';
import { Panel, SectionLabel } from '@/ui/Panel';
import { Slider } from '@/ui/Slider';

import { Note, ToggleRow, usePanelActions, useSelected } from './common';

export function EffectsPanel({ project }: { project: Project }) {
  const selected = useSelected<MainClip | OverlayClip>(project, ['main', 'overlay']);
  const { apply, endGesture, close } = usePanelActions();
  if (!selected) return null;
  const { id, item } = selected;
  const effect = item.effect ?? null;
  return (
    <Panel title="Efeitos" onDone={close}>
      <ChoiceRow
        options={[{ value: 'none' as const, label: 'Nenhum' }, ...EFFECTS.map((e) => ({ value: e.kind, label: e.name }))]}
        value={effect?.kind ?? 'none'}
        onChange={(v: EffectKind | 'none') => apply((p) => updateVisual(p, id, { effect: v === 'none' ? null : { kind: v, amount: effect?.amount ?? 0.6 } }))}
      />
      <Slider
        label="Intensidade"
        value={Math.round((effect?.amount ?? 0.6) * 100)}
        min={5}
        max={100}
        defaultValue={60}
        step={1}
        disabled={!effect}
        format={(v) => `${Math.round(v)}%`}
        onChange={(v) => effect && apply((p) => updateVisual(p, id, { effect: { kind: effect.kind, amount: v / 100 } }), { key: `effect:${id}` })}
        onCommit={endGesture}
      />
      <Note>Os efeitos valem para o clipe inteiro e aparecem no preview e no vídeo exportado.</Note>
    </Panel>
  );
}

export function ChromaPanel({ project }: { project: Project }) {
  const selected = useSelected<MainClip | OverlayClip>(project, ['main', 'overlay']);
  const { apply, endGesture, close } = usePanelActions();
  if (!selected) return null;
  const { id, item } = selected;
  const chroma = item.chroma ?? null;
  const set = (patch: Partial<ChromaKey>, key?: string) =>
    apply((p) => updateVisual(p, id, { chroma: { ...(chroma ?? DEFAULT_CHROMA), ...patch } }), key ? { key } : undefined);
  const preset = CHROMA_PRESETS.find((c) => c.color === chroma?.color)?.color ?? (chroma ? 'custom' : DEFAULT_CHROMA.color);
  return (
    <Panel title="Chroma key" onDone={close}>
      <ToggleRow
        label="Tirar a cor do fundo"
        hint="Para vídeos gravados na frente de uma tela verde ou azul."
        value={!!chroma}
        onChange={(on) => apply((p) => updateVisual(p, id, { chroma: on ? { ...DEFAULT_CHROMA } : null }))}
      />
      {chroma ? (
        <>
          <SectionLabel>Cor a tirar</SectionLabel>
          <ChoiceRow
            options={[...CHROMA_PRESETS.map((c) => ({ value: c.color, label: c.name })), { value: 'custom', label: 'Outra cor' }]}
            value={preset}
            onChange={(v) => v !== 'custom' && set({ color: v })}
          />
          {preset === 'custom' || !CHROMA_PRESETS.some((c) => c.color === chroma.color) ? (
            <ColorRow label="Outra cor" value={chroma.color} onChange={(c) => set({ color: c })} />
          ) : null}
          <Slider
            label="Intensidade"
            value={Math.round((chroma.similarity / 0.4) * 100)}
            min={0}
            max={100}
            defaultValue={30}
            step={1}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) => set({ similarity: (v / 100) * 0.4 }, `chroma:sim:${id}`)}
            onCommit={endGesture}
          />
          <Slider
            label="Suavidade da borda"
            value={Math.round((chroma.smoothness / 0.3) * 100)}
            min={0}
            max={100}
            defaultValue={27}
            step={1}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) => set({ smoothness: (v / 100) * 0.3 }, `chroma:soft:${id}`)}
            onCommit={endGesture}
          />
          <Note>Se sobrar fundo, aumente a intensidade; se o contorno ficar serrilhado, aumente a suavidade.</Note>
        </>
      ) : null}
    </Panel>
  );
}
