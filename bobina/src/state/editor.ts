/**
 * Estado do editor: projeto com histórico (desfazer/refazer), seleção, painel
 * aberto, salvamento automático e o processamento de velocidade em segundo plano.
 */
import { create } from 'zustand';

import { buildComposition, type AudioRenderRequest, type BakeRequest } from '@/core/composition';
import {
  canRedo,
  canUndo,
  commit,
  endGesture,
  initHistory,
  redo,
  replacePresent,
  undo,
  type History,
} from '@/core/history';
import type { Added } from '@/core/ops';
import type { ItemRef, Micros, Project } from '@/core/types';
import { runAudioRender, runBake } from '@/engine/bake';
import { absolutePath } from '@/storage/paths';
import { saveProject } from '@/storage/projects';

export type PanelId =
  | 'speed'
  | 'volume'
  | 'text'
  | 'audio'
  | 'filters'
  | 'adjust'
  | 'transition'
  | 'format'
  | 'background'
  | 'captions'
  | 'captionsBatch'
  | 'captionStyle'
  | 'frame'
  | 'animation'
  | 'overlay'
  | 'opacity';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
}

export interface Busy {
  label: string;
  /** 0..1, ou null quando não dá para medir. */
  fraction: number | null;
}

interface EditorState {
  history: History | null;
  selection: ItemRef | null;
  panel: PanelId | null;
  /** Para a transição: o clipe de onde ela sai. */
  panelTarget: string | null;
  playhead: Micros;
  toast: Toast | null;
  busy: Busy | null;
  open: (project: Project) => void;
  close: () => void;
  apply: (fn: (p: Project) => Project, options?: { key?: string }) => void;
  /** Para operações que criam um item: aplica e seleciona o novo item. */
  applyAdded: (fn: (p: Project) => Added | null, kind: ItemRef['kind'], options?: { key?: string; panel?: PanelId }) => boolean;
  /**
   * Edição contínua (arrastar): `fn` recebe o projeto como estava no começo do
   * gesto, então cada passo aplica o deslocamento total. Termina com `endGesture`.
   */
  applyGesture: (key: string, fn: (base: Project) => Project) => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  select: (ref: ItemRef | null) => void;
  openPanel: (panel: PanelId | null, target?: string | null) => void;
  setPlayhead: (t: Micros) => void;
  showToast: (message: string, kind?: Toast['kind']) => void;
  /** Troca o presente sem passo de desfazer (cache de velocidade, por exemplo). */
  patchSilently: (fn: (p: Project) => Project) => void;
  setBusy: (busy: Busy | null) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let bakeTimer: ReturnType<typeof setTimeout> | null = null;
let bakeRunning = false;
let toastId = 0;

function scheduleSave(project: Project) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      saveProject({ ...project, updatedAt: Date.now() });
    } catch (e) {
      useEditor.getState().showToast(`Não foi possível salvar: ${String(e)}`, 'error');
    }
  }, 400);
}

/** Salva já (ao sair do editor). */
export function flushSave() {
  const history = useEditor.getState().history;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (history) saveProject({ ...history.present, updatedAt: Date.now() });
}

function pendingWork(project: Project): { bakes: BakeRequest[]; audio: AudioRenderRequest[] } {
  const result = buildComposition(project, { resolve: (r) => absolutePath(project.id, r) });
  return { bakes: result.missing, audio: result.missingAudio };
}

function scheduleBakes() {
  if (bakeTimer) clearTimeout(bakeTimer);
  bakeTimer = setTimeout(runPendingBakes, 700);
}

/** Faz, uma por vez, as cópias aceleradas e os áudios com fade que faltam. */
async function runPendingBakes() {
  if (bakeRunning) return;
  const state = useEditor.getState();
  const project = state.history?.present;
  if (!project) return;
  const { bakes, audio } = pendingWork(project);
  if (bakes.length === 0 && audio.length === 0) return;
  bakeRunning = true;
  try {
    for (let i = 0; i < bakes.length; i++) {
      const request = bakes[i]!;
      const label = bakes.length > 1 ? `Aplicando velocidade (${i + 1} de ${bakes.length})` : 'Aplicando velocidade';
      useEditor.getState().setBusy({ label, fraction: 0 });
      const current = useEditor.getState().history?.present;
      if (!current || current.id !== project.id) return;
      const bake = await runBake(current, request, (fraction) => useEditor.getState().setBusy({ label, fraction }));
      useEditor.getState().patchSilently((p) => ({ ...p, bakes: { ...p.bakes, [bake.key]: bake } }));
    }
    for (let i = 0; i < audio.length; i++) {
      useEditor.getState().setBusy({ label: 'Preparando o áudio', fraction: i / audio.length });
      const current = useEditor.getState().history?.present;
      if (!current || current.id !== project.id) return;
      const render = await runAudioRender(current, audio[i]!);
      useEditor.getState().patchSilently((p) => ({ ...p, audioRenders: { ...p.audioRenders, [render.key]: render } }));
    }
  } catch (e) {
    useEditor.getState().showToast(`Não foi possível processar o áudio ou a velocidade: ${String(e)}`, 'error');
  } finally {
    bakeRunning = false;
    useEditor.getState().setBusy(null);
  }
  // Se algo mudou de novo durante o trabalho, faz o que ficou faltando.
  const latest = useEditor.getState().history?.present;
  if (latest) {
    const again = pendingWork(latest);
    if (again.bakes.length > 0 || again.audio.length > 0) scheduleBakes();
  }
}

/** As cópias aceleradas são cache: desfazer não deve jogá-las fora. */
function keepBakes(next: History, from: Project): History {
  if (next.present.bakes === from.bakes && next.present.audioRenders === from.audioRenders) return next;
  return {
    ...next,
    present: {
      ...next.present,
      bakes: { ...next.present.bakes, ...from.bakes },
      audioRenders: { ...next.present.audioRenders, ...from.audioRenders },
    },
  };
}

export const useEditor = create<EditorState>((set, get) => ({
  history: null,
  selection: null,
  panel: null,
  panelTarget: null,
  playhead: 0,
  toast: null,
  busy: null,

  open: (project) => {
    set({ history: initHistory(project), selection: null, panel: null, panelTarget: null, playhead: 0, busy: null });
    scheduleBakes();
  },

  close: () => {
    flushSave();
    if (bakeTimer) clearTimeout(bakeTimer);
    set({ history: null, selection: null, panel: null, panelTarget: null, busy: null });
  },

  apply: (fn, options) => {
    const history = get().history;
    if (!history) return;
    const next = fn(history.present);
    if (next === history.present) return;
    const updated = commit(history, next, { key: options?.key });
    set({ history: updated });
    scheduleSave(updated.present);
    scheduleBakes();
  },

  applyAdded: (fn, kind, options) => {
    const history = get().history;
    if (!history) return false;
    const result = fn(history.present);
    if (!result) return false;
    const updated = commit(history, result.project, { key: options?.key });
    set({
      history: updated,
      selection: { kind, id: result.id },
      ...(options?.panel ? { panel: options.panel } : {}),
    });
    scheduleSave(updated.present);
    scheduleBakes();
    return true;
  },

  applyGesture: (key, fn) => {
    const history = get().history;
    if (!history) return;
    const continuing = history.lastKey === key && history.past.length > 0;
    const base = continuing ? history.past[history.past.length - 1]! : history.present;
    const next = fn(base);
    if (next === history.present) return;
    const updated = continuing
      ? { ...history, present: next, future: [], lastAt: Date.now() }
      : commit(history, next, { key });
    set({ history: updated });
    scheduleSave(updated.present);
    scheduleBakes();
  },

  endGesture: () => {
    const history = get().history;
    if (history) set({ history: endGesture(history) });
  },

  undo: () => {
    const history = get().history;
    if (!history || !canUndo(history)) return;
    const next = keepBakes(undo(history), history.present);
    set({ history: next, selection: null, panel: null });
    scheduleSave(next.present);
    scheduleBakes();
  },

  redo: () => {
    const history = get().history;
    if (!history || !canRedo(history)) return;
    const next = keepBakes(redo(history), history.present);
    set({ history: next, selection: null, panel: null });
    scheduleSave(next.present);
    scheduleBakes();
  },

  select: (ref) => set({ selection: ref, panel: null }),

  openPanel: (panel, target = null) => set({ panel, panelTarget: target }),

  setPlayhead: (t) => set({ playhead: Math.max(0, Math.round(t)) }),

  showToast: (message, kind = 'info') => set({ toast: { id: ++toastId, message, kind } }),

  patchSilently: (fn) => {
    const history = get().history;
    if (!history) return;
    const next = fn(history.present);
    if (next === history.present) return;
    const updated = replacePresent(history, next);
    set({ history: updated });
    scheduleSave(updated.present);
  },

  setBusy: (busy) => set({ busy }),
}));

/** Projeto atual (ou null fora do editor). */
export function useProject(): Project | null {
  return useEditor((s) => s.history?.present ?? null);
}

export function useCanUndo(): boolean {
  return useEditor((s) => (s.history ? canUndo(s.history) : false));
}

export function useCanRedo(): boolean {
  return useEditor((s) => (s.history ? canRedo(s.history) : false));
}
