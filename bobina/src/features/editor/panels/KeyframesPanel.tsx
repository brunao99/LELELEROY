/**
 * Keyframes do item selecionado: pôr ou tirar na agulha, andar entre eles,
 * escolher a curva e limpar. Com keyframes, mexer no item no preview (ou no
 * zoom e na opacidade) grava um keyframe na agulha.
 */
import { ChevronLeft, ChevronRight, Diamond } from 'lucide-react-native';

import { KEYFRAME_SNAP, keyframeIndexAt } from '@/core/keyframes';
import { clearKeyframes, itemStartTime, setKeyframeEase, toggleKeyframe } from '@/core/ops';
import { formatTime } from '@/core/time';
import type { KeyframeEase, MainClip, OverlayClip, Project, TextItem } from '@/core/types';
import { useEditor } from '@/state/editor';
import { Button, IconButton, Row } from '@/ui/Button';
import { ChoiceRow } from '@/ui/Chip';
import { Panel, SectionLabel } from '@/ui/Panel';
import { Txt } from '@/ui/Text';
import { space } from '@/ui/theme';

import { useEditorRuntime } from '../EditorContext';
import { Note, usePanelActions, useSelected } from './common';

const EASES: { value: KeyframeEase; label: string }[] = [
  { value: 'smooth', label: 'Suave' },
  { value: 'linear', label: 'Constante' },
];

export function KeyframesPanel({ project }: { project: Project }) {
  const selected = useSelected<MainClip | OverlayClip | TextItem>(project, ['main', 'overlay', 'text']);
  const { apply, close, showToast } = usePanelActions();
  const playhead = useEditor((s) => s.playhead);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const { seek, player, now } = useEditorRuntime();
  if (!selected) return null;
  const { id, item } = selected;
  const start = itemStartTime(project, id) ?? 0;
  const keyframes = item.keyframes ?? [];
  const local = playhead - start;
  const index = keyframeIndexAt(keyframes, local);
  const here = index >= 0 ? keyframes[index]! : null;

  const go = (t: number) => {
    player?.pause();
    seek(t);
    setPlayhead(t);
  };
  const prev = [...keyframes].reverse().find((k) => k.at < local - KEYFRAME_SNAP);
  const next = keyframes.find((k) => k.at > local + KEYFRAME_SNAP);

  const toggle = () => {
    player?.pause();
    const t = now();
    setPlayhead(t);
    const had = keyframeIndexAt(keyframes, t - start) >= 0;
    apply((p) => toggleKeyframe(p, id, t));
    if (!had && keyframes.length === 0) {
      showToast('Keyframe criado. Leve a agulha a outro ponto e mova, gire ou mude o tamanho: o app anima entre eles.');
    }
  };

  return (
    <Panel title="Keyframes" onDone={close}>
      <Row style={{ paddingHorizontal: space[4], justifyContent: 'space-between' }}>
        <IconButton icon={ChevronLeft} label="Keyframe anterior" onPress={() => prev && go(start + prev.at)} disabled={!prev} />
        <Button label={here ? 'Remover keyframe' : 'Adicionar keyframe'} icon={Diamond} variant={here ? 'secondary' : 'primary'} onPress={toggle} />
        <IconButton icon={ChevronRight} label="Próximo keyframe" onPress={() => next && go(start + next.at)} disabled={!next} />
      </Row>
      <Txt variant="xs" tone="muted" style={{ paddingHorizontal: space[4], textAlign: 'center' }}>
        {keyframes.length === 0
          ? 'Nenhum keyframe neste item.'
          : `${keyframes.length} keyframe${keyframes.length > 1 ? 's' : ''}${here ? ` · agulha num keyframe (${formatTime(start + here.at)})` : ''}`}
      </Txt>
      {here ? (
        <>
          <SectionLabel>Curva até o próximo</SectionLabel>
          <ChoiceRow options={EASES} value={here.ease} onChange={(v) => apply((p) => setKeyframeEase(p, id, playhead, v))} />
        </>
      ) : null}
      {keyframes.length > 0 ? (
        <Row style={{ paddingHorizontal: space[4] }}>
          <Button label="Remover todos" variant="ghost" size="sm" onPress={() => apply((p) => clearKeyframes(p, id, playhead))} />
        </Row>
      ) : null}
      <Note>
        Com keyframes, mover, girar, aumentar ou mudar a opacidade em outro instante cria um keyframe ali. Os losangos na timeline mostram onde eles estão.
      </Note>
    </Panel>
  );
}
