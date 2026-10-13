/**
 * Painéis de um clipe (principal ou sobreposição) ou de um áudio: velocidade,
 * volume e fades, animação, filtros, ajustes, enquadramento, opacidade e mistura.
 */
import { FlipHorizontal2, FlipVertical2, RotateCw, Undo } from 'lucide-react-native';
import { useState } from 'react';

import { FILTERS } from '@/core/color';
import { NO_ADJUST, IDENTITY_TRANSFORM, FULL_CROP } from '@/core/defaults';
import { displaySize } from '@/core/geometry';
import { ANIMATIONS, LOOP_ANIMATIONS } from '@/core/motion';
import {
  flip,
  rotate90,
  setBlend,
  setFades,
  setSpeed,
  MAX_VOLUME,
  setVolume,
  updateText,
  updateVisual,
  updateVisualAll,
} from '@/core/ops';
import { MAX_SPEED, MIN_SPEED, formatSeconds, formatSpeed, sec } from '@/core/time';
import { clipDuration } from '@/core/timeline';
import type {
  Adjustments,
  Anim,
  AudioClip,
  BlendKind,
  MainClip,
  OverlayClip,
  Project,
  TextItem,
} from '@/core/types';
import { Button, Row } from '@/ui/Button';
import { ChoiceRow } from '@/ui/Chip';
import { Panel, SectionLabel } from '@/ui/Panel';
import { Slider } from '@/ui/Slider';
import { Tabs } from '@/ui/Tabs';
import { space } from '@/ui/theme';

import { Note, ToggleRow, useSelected, usePanelActions } from './common';

type Clip = MainClip | OverlayClip | AudioClip;

/** Arredonda a velocidade para valores fáceis de ler. */
function roundSpeed(v: number): number {
  if (Math.abs(v - 1) < 0.04) return 1;
  if (v < 1) return Math.round(v * 100) / 100;
  if (v < 10) return Math.round(v * 10) / 10;
  return Math.round(v);
}

export function SpeedPanel({ project }: { project: Project }) {
  const selected = useSelected<Clip>(project, ['main', 'overlay', 'audio']);
  const { apply, endGesture, close } = usePanelActions();
  if (!selected) return null;
  const { id, item } = selected;
  const original = item.sourceOut - item.sourceIn;
  const change = (speed: number, keepPitch = item.keepPitch) =>
    apply((p) => setSpeed(p, id, roundSpeed(speed), keepPitch), { key: `speed:${id}` });
  return (
    <Panel title="Velocidade" onDone={close}>
      <Slider
        label="Velocidade"
        value={item.speed}
        min={MIN_SPEED}
        max={MAX_SPEED}
        defaultValue={1}
        scale="log"
        format={formatSpeed}
        onChange={(v) => change(v)}
        onCommit={endGesture}
      />
      <ChoiceRow
        options={[0.25, 0.5, 1, 1.5, 2, 3, 5].map((v) => ({ value: v, label: formatSpeed(v) }))}
        value={item.speed}
        onChange={(v) => {
          change(v);
          endGesture();
        }}
      />
      <ToggleRow
        label="Manter o tom da voz"
        hint="Desligado, a voz fica fina ao acelerar e grossa ao desacelerar."
        value={item.keepPitch}
        onChange={(v) => change(item.speed, v)}
      />
      <Note>
        Duração: {formatSeconds(original)} → {formatSeconds(clipDuration(item))}. A velocidade é aplicada em segundo plano; enquanto isso o
        preview mostra o clipe sem som.
      </Note>
    </Panel>
  );
}

export function VolumePanel({ project }: { project: Project }) {
  const selected = useSelected<Clip>(project, ['main', 'overlay', 'audio']);
  const { apply, endGesture, close } = usePanelActions();
  if (!selected) return null;
  const { id, item } = selected;
  const maxFade = Math.max(0, Math.min(sec(10), Math.floor(clipDuration(item) / 2)));
  return (
    <Panel title="Volume" onDone={close}>
      <Slider
        label="Volume"
        value={Math.round(item.volume * 100)}
        min={0}
        max={MAX_VOLUME * 100}
        defaultValue={100}
        step={1}
        format={(v) => `${Math.round(v)}%`}
        onChange={(v) => apply((p) => setVolume(p, id, v / 100), { key: `volume:${id}` })}
        onCommit={endGesture}
      />
      {item.volume > 1 ? <Note>Acima de 100% o som é amplificado com um limitador suave para não distorcer.</Note> : null}
      <Slider
        label="Entrada gradual"
        value={item.fadeIn / 1_000_000}
        min={0}
        max={maxFade / 1_000_000}
        defaultValue={0}
        step={0.1}
        format={(v) => `${v.toFixed(1).replace('.', ',')}s`}
        disabled={maxFade <= 0}
        onChange={(v) => apply((p) => setFades(p, id, sec(v), item.fadeOut), { key: `fadein:${id}` })}
        onCommit={endGesture}
      />
      <Slider
        label="Saída gradual"
        value={item.fadeOut / 1_000_000}
        min={0}
        max={maxFade / 1_000_000}
        defaultValue={0}
        step={0.1}
        format={(v) => `${v.toFixed(1).replace('.', ',')}s`}
        disabled={maxFade <= 0}
        onChange={(v) => apply((p) => setFades(p, id, item.fadeIn, sec(v)), { key: `fadeout:${id}` })}
        onCommit={endGesture}
      />
    </Panel>
  );
}

type AnimTab = 'in' | 'out' | 'loop';

export function AnimationPanel({ project }: { project: Project }) {
  const selected = useSelected<MainClip | OverlayClip | TextItem>(project, ['main', 'overlay', 'text']);
  const { apply, endGesture, close } = usePanelActions();
  const [tab, setTab] = useState<AnimTab>('in');
  if (!selected) return null;
  const { id, kind, item } = selected;
  const isText = kind === 'text';
  const current: Anim = tab === 'out' ? item.animOut : item.animIn;
  const set = (patch: { animIn?: Anim; animOut?: Anim; animLoop?: TextItem['animLoop'] }, key?: string) =>
    apply((p) => (isText ? updateText(p, id, patch) : updateVisual(p, id, patch as Partial<MainClip>)), key ? { key } : undefined);
  const tabs: { id: AnimTab; label: string }[] = [
    { id: 'in', label: 'Entrada' },
    { id: 'out', label: 'Saída' },
    ...(isText ? [{ id: 'loop' as const, label: 'Em laço' }] : []),
  ];
  return (
    <Panel title="Animação" onDone={close}>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'loop' && isText ? (
        <ChoiceRow
          options={LOOP_ANIMATIONS.map((a) => ({ value: a.kind, label: a.name }))}
          value={(item as TextItem).animLoop}
          onChange={(v) => set({ animLoop: v })}
        />
      ) : (
        <>
          <ChoiceRow
            options={ANIMATIONS.map((a) => ({ value: a.kind, label: a.name }))}
            value={current.kind}
            onChange={(v) => set(tab === 'in' ? { animIn: { ...item.animIn, kind: v } } : { animOut: { ...item.animOut, kind: v } })}
          />
          <Slider
            label="Duração"
            value={current.duration / 1_000_000}
            min={0.1}
            max={3}
            defaultValue={0.5}
            step={0.1}
            disabled={current.kind === 'none'}
            format={(v) => `${v.toFixed(1).replace('.', ',')}s`}
            onChange={(v) =>
              set(
                tab === 'in' ? { animIn: { ...item.animIn, duration: sec(v) } } : { animOut: { ...item.animOut, duration: sec(v) } },
                `anim:${tab}:${id}`,
              )
            }
            onCommit={endGesture}
          />
        </>
      )}
    </Panel>
  );
}

export function FiltersPanel({ project }: { project: Project }) {
  const selected = useSelected<MainClip | OverlayClip>(project, ['main', 'overlay']);
  const { apply, endGesture, close, showToast } = usePanelActions();
  if (!selected) return null;
  const { id, kind, item } = selected;
  const filterId = item.filter?.id ?? 'none';
  return (
    <Panel
      title="Filtros"
      onDone={close}
      footer={
        kind === 'main'
          ? {
              label: 'Aplicar a todos os clipes',
              onPress: () => {
                apply((p) => updateVisualAll(p, { filter: item.filter ? { ...item.filter } : null }));
                showToast('Filtro aplicado a todos os clipes.');
              },
            }
          : null
      }
    >
      <ChoiceRow
        options={[{ value: 'none', label: 'Nenhum' }, ...FILTERS.map((f) => ({ value: f.id, label: f.name }))]}
        value={filterId}
        onChange={(v) => apply((p) => updateVisual(p, id, { filter: v === 'none' ? null : { id: v, intensity: item.filter?.intensity ?? 0.8 } }))}
      />
      <Slider
        label="Intensidade"
        value={Math.round((item.filter?.intensity ?? 0.8) * 100)}
        min={0}
        max={100}
        defaultValue={80}
        step={1}
        disabled={!item.filter}
        format={(v) => `${Math.round(v)}%`}
        onChange={(v) => item.filter && apply((p) => updateVisual(p, id, { filter: { id: item.filter!.id, intensity: v / 100 } }), { key: `filter:${id}` })}
        onCommit={endGesture}
      />
    </Panel>
  );
}

const ADJUST_PARAMS: { key: keyof Adjustments; label: string; min: number }[] = [
  { key: 'brightness', label: 'Brilho', min: -100 },
  { key: 'contrast', label: 'Contraste', min: -100 },
  { key: 'saturation', label: 'Saturação', min: -100 },
  { key: 'exposure', label: 'Exposição', min: -100 },
  { key: 'temperature', label: 'Temperatura', min: -100 },
  { key: 'tint', label: 'Matiz', min: -100 },
  { key: 'highlights', label: 'Realces', min: -100 },
  { key: 'shadows', label: 'Sombras', min: -100 },
  { key: 'sharpen', label: 'Nitidez', min: 0 },
  { key: 'vignette', label: 'Vinheta', min: 0 },
];

export function AdjustPanel({ project }: { project: Project }) {
  const selected = useSelected<MainClip | OverlayClip>(project, ['main', 'overlay']);
  const { apply, endGesture, close, showToast } = usePanelActions();
  const [param, setParam] = useState<keyof Adjustments>('brightness');
  if (!selected) return null;
  const { id, kind, item } = selected;
  const info = ADJUST_PARAMS.find((p) => p.key === param)!;
  return (
    <Panel
      title="Ajustar"
      onDone={close}
      footer={
        kind === 'main'
          ? {
              label: 'Aplicar a todos os clipes',
              onPress: () => {
                apply((p) => updateVisualAll(p, { adjust: { ...item.adjust } }));
                showToast('Ajustes aplicados a todos os clipes.');
              },
            }
          : null
      }
    >
      <ChoiceRow
        options={ADJUST_PARAMS.map((p) => ({ value: p.key, label: item.adjust[p.key] ? `${p.label} •` : p.label }))}
        value={param}
        onChange={setParam}
      />
      <Slider
        label={info.label}
        value={item.adjust[param]}
        min={info.min}
        max={100}
        defaultValue={0}
        step={1}
        centered={info.min < 0}
        format={(v) => `${v > 0 && info.min < 0 ? '+' : ''}${Math.round(v)}`}
        onChange={(v) => apply((p) => updateVisual(p, id, { adjust: { ...item.adjust, [param]: Math.round(v) } }), { key: `adjust:${param}:${id}` })}
        onCommit={endGesture}
      />
      <Row style={{ paddingHorizontal: space[4] }}>
        <Button label="Redefinir tudo" icon={Undo} variant="secondary" size="sm" onPress={() => apply((p) => updateVisual(p, id, { adjust: { ...NO_ADJUST } }))} />
      </Row>
    </Panel>
  );
}

const CROPS: { value: string; label: string; aspect: number | null }[] = [
  { value: 'free', label: 'Original', aspect: null },
  { value: '1:1', label: '1:1', aspect: 1 },
  { value: '9:16', label: '9:16', aspect: 9 / 16 },
  { value: '16:9', label: '16:9', aspect: 16 / 9 },
  { value: '4:5', label: '4:5', aspect: 4 / 5 },
  { value: '3:4', label: '3:4', aspect: 3 / 4 },
];

/** Recorte centrado com a proporção pedida, em frações da imagem já girada. */
function centeredCrop(imageAspect: number, aspect: number | null) {
  if (aspect === null) return { ...FULL_CROP };
  if (imageAspect > aspect) {
    const w = aspect / imageAspect;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = imageAspect / aspect;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

export function FramePanel({ project }: { project: Project }) {
  const selected = useSelected<MainClip | OverlayClip>(project, ['main', 'overlay']);
  const { apply, endGesture, close } = usePanelActions();
  const [crop, setCrop] = useState('free');
  if (!selected) return null;
  const { id, item } = selected;
  const asset = project.assets[item.assetId];
  const size = asset ? displaySize(asset) : { width: 1, height: 1 };
  return (
    <Panel title="Enquadrar" onDone={close}>
      <Row style={{ paddingHorizontal: space[4], flexWrap: 'wrap' }}>
        <Button label="Girar 90°" icon={RotateCw} variant="secondary" size="sm" onPress={() => apply((p) => rotate90(p, id))} />
        <Button label="Espelhar" icon={FlipHorizontal2} variant="secondary" size="sm" onPress={() => apply((p) => flip(p, id, 'h'))} />
        <Button label="Inverter" icon={FlipVertical2} variant="secondary" size="sm" onPress={() => apply((p) => flip(p, id, 'v'))} />
      </Row>
      <SectionLabel>Recortar</SectionLabel>
      <ChoiceRow
        options={CROPS.map((c) => ({ value: c.value, label: c.label }))}
        value={crop}
        onChange={(v) => {
          setCrop(v);
          const c = CROPS.find((x) => x.value === v)!;
          apply((p) => updateVisual(p, id, { crop: centeredCrop(size.width / Math.max(1, size.height), c.aspect) }));
        }}
      />
      <Slider
        label="Zoom"
        value={item.transform.scale}
        min={0.2}
        max={4}
        defaultValue={1}
        scale="log"
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => apply((p) => updateVisual(p, id, { transform: { ...item.transform, scale: v } }), { key: `zoom:${id}` })}
        onCommit={endGesture}
      />
      <Note>Arraste o vídeo no preview para mudar a posição; use dois dedos para girar e aproximar.</Note>
      <Row style={{ paddingHorizontal: space[4] }}>
        <Button
          label="Redefinir"
          icon={Undo}
          variant="secondary"
          size="sm"
          onPress={() => {
            setCrop('free');
            apply((p) => updateVisual(p, id, { transform: { ...IDENTITY_TRANSFORM }, crop: { ...FULL_CROP }, flipH: false, flipV: false }));
          }}
        />
      </Row>
    </Panel>
  );
}

const BLENDS: { value: BlendKind; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiplicar' },
  { value: 'screen', label: 'Clarear (tela)' },
  { value: 'overlay', label: 'Sobrepor' },
  { value: 'darken', label: 'Escurecer' },
  { value: 'lighten', label: 'Clarear' },
  { value: 'add', label: 'Somar' },
];

export function OpacityPanel({ project, withBlend }: { project: Project; withBlend: boolean }) {
  const selected = useSelected<MainClip | OverlayClip>(project, ['main', 'overlay']);
  const { apply, endGesture, close } = usePanelActions();
  if (!selected) return null;
  const { id, kind, item } = selected;
  return (
    <Panel title={withBlend ? 'Mistura' : 'Opacidade'} onDone={close}>
      <Slider
        label="Opacidade"
        value={Math.round(item.opacity * 100)}
        min={0}
        max={100}
        defaultValue={100}
        step={1}
        format={(v) => `${Math.round(v)}%`}
        onChange={(v) => apply((p) => updateVisual(p, id, { opacity: v / 100 }), { key: `opacity:${id}` })}
        onCommit={endGesture}
      />
      {withBlend && kind === 'overlay' ? (
        <>
          <SectionLabel>Modo de mistura</SectionLabel>
          <ChoiceRow options={BLENDS} value={(item as OverlayClip).blend} onChange={(v) => apply((p) => setBlend(p, id, v))} />
        </>
      ) : null}
    </Panel>
  );
}
