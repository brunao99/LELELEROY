import { createContext, useContext } from 'react';

import type { Micros } from '@/core/types';
import type { PreviewPlayer } from '@/engine/player';
import type { DrawResources } from '@/engine/draw';

export interface EditorRuntime {
  player: PreviewPlayer | null;
  resources: DrawResources | null;
  /** Instante da agulha agora (lê o tempo do player). */
  now: () => Micros;
  /** Leva a agulha (e a timeline) para `t`. */
  seek: (t: Micros) => void;
}

export const EditorContext = createContext<EditorRuntime>({
  player: null,
  resources: null,
  now: () => 0,
  seek: () => {},
});

export function useEditorRuntime(): EditorRuntime {
  return useContext(EditorContext);
}
