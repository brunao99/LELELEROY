import type { Project } from '@/core/types';
import { useEditor } from '@/state/editor';

import { AudioPanel } from './panels/AudioPanel';
import { CaptionStylePanel, CaptionsBatchPanel, CaptionsPanel } from './panels/CaptionsPanels';
import { AdjustPanel, AnimationPanel, FiltersPanel, FramePanel, OpacityPanel, SpeedPanel, VolumePanel } from './panels/ClipPanels';
import { BackgroundPanel, CoverPanel, FormatPanel, TransitionPanel } from './panels/ProjectPanels';
import { TextPanel } from './panels/TextPanel';

/** O painel aberto (no lugar da timeline e da barra de ferramentas). */
export function PanelSwitch({ project }: { project: Project }) {
  const panel = useEditor((s) => s.panel);
  switch (panel) {
    case 'speed':
      return <SpeedPanel project={project} />;
    case 'volume':
      return <VolumePanel project={project} />;
    case 'text':
      return <TextPanel project={project} />;
    case 'audio':
      return <AudioPanel project={project} />;
    case 'filters':
      return <FiltersPanel project={project} />;
    case 'adjust':
      return <AdjustPanel project={project} />;
    case 'transition':
      return <TransitionPanel project={project} />;
    case 'format':
      return <FormatPanel project={project} />;
    case 'background':
      return <BackgroundPanel project={project} />;
    case 'captions':
      return <CaptionsPanel project={project} />;
    case 'captionsBatch':
      return <CaptionsBatchPanel project={project} />;
    case 'captionStyle':
      return <CaptionStylePanel project={project} />;
    case 'frame':
      return <FramePanel project={project} />;
    case 'animation':
      return <AnimationPanel project={project} />;
    case 'overlay':
      return <OpacityPanel project={project} withBlend />;
    case 'opacity':
      return <OpacityPanel project={project} withBlend={false} />;
    case 'cover':
      return <CoverPanel project={project} />;
    default:
      return null;
  }
}
