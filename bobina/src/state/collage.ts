/**
 * Estado do editor de colagem: a colagem com desfazer/refazer, o que está
 * selecionado (uma célula da grade ou uma camada), o painel aberto e o
 * salvamento automático.
 */
import { create } from 'zustand';

import type { Collage } from '@/core/collage';
import { canRedo, canUndo, commit, endGesture, initHistory, redo, undo, type History } from '@/core/history';
import { saveCollage } from '@/storage/collages';

import type { Busy, Toast } from './editor';

export type CollagePanel =
  | 'templates'
  | 'background'
  | 'borders'
  | 'format'
  | 'text'
  | 'outline'
  | 'frame'
  | 'opacity'
  | 'sticker'
  | 'save';

export type CollageSelection = { kind: 'cell'; index: number } | { kind: 'layer'; id: string } | null;

interface CollageState {
  history: History<Collage> | null;
  selection: CollageSelection;
  panel: CollagePanel | null;
  toast: Toast | null;
  busy: Busy | null;
  open: (c: Collage) => void;
  close: () => void;
  apply: (fn: (c: Collage) => Collage, options?: { key?: string }) => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  select: (selection: CollageSelection) => void;
  openPanel: (panel: CollagePanel | null) => void;
  showToast: (message: string, kind?: Toast['kind']) => void;
  setBusy: (busy: Busy | null) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let toastId = 0;

function scheduleSave(c: Collage) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      saveCollage({ ...c, updatedAt: Date.now() });
    } catch (e) {
      useCollage.getState().showToast(`Não foi possível salvar: ${String(e)}`, 'error');
    }
  }, 400);
}

/** Salva já (ao sair do editor). */
export function flushCollageSave() {
  const history = useCollage.getState().history;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (history) saveCollage({ ...history.present, updatedAt: Date.now() });
}

export const useCollage = create<CollageState>((set, get) => ({
  history: null,
  selection: null,
  panel: null,
  toast: null,
  busy: null,

  open(c) {
    set({ history: initHistory(c), selection: null, panel: null, toast: null, busy: null });
  },

  close() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    set({ history: null, selection: null, panel: null, busy: null });
  },

  apply(fn, options) {
    const history = get().history;
    if (!history) return;
    const next = fn(history.present);
    if (next === history.present) return;
    set({ history: commit(history, next, { key: options?.key }) });
    scheduleSave(next);
  },

  endGesture() {
    const history = get().history;
    if (history) set({ history: endGesture(history) });
  },

  undo() {
    const history = get().history;
    if (!history || !canUndo(history)) return;
    const next = undo(history);
    set({ history: next, selection: validSelection(next.present, get().selection) });
    scheduleSave(next.present);
  },

  redo() {
    const history = get().history;
    if (!history || !canRedo(history)) return;
    const next = redo(history);
    set({ history: next, selection: validSelection(next.present, get().selection) });
    scheduleSave(next.present);
  },

  select(selection) {
    set({ selection, panel: null });
  },

  openPanel(panel) {
    set({ panel });
  },

  showToast(message, kind = 'info') {
    set({ toast: { id: ++toastId, message, kind } });
  },

  setBusy(busy) {
    set({ busy });
  },
}));

/** A seleção continua valendo depois de desfazer? */
function validSelection(c: Collage, selection: CollageSelection): CollageSelection {
  if (!selection) return null;
  if (selection.kind === 'layer') return c.layers.some((l) => l.id === selection.id) ? selection : null;
  return c.grid && c.slots[selection.index] ? selection : null;
}

export function useCollageDoc(): Collage | null {
  return useCollage((s) => s.history?.present ?? null);
}
