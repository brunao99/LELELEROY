/**
 * Estado do recorte com laço enquanto ele está aberto: a sessão (o quadro já
 * passou pela rede), o laço, os toques, a máscara do resultado e o rastreio.
 * O palco (sobre o preview) e o painel de baixo leem e mexem daqui.
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { create } from 'zustand';

import type { Click, Point } from '@/core/cutout';
import type { Cutout, Micros } from '@/core/types';
import {
  CUTOUT_FPS,
  CutoutSession,
  releaseCutoutSessions,
  saveCutoutMasks,
  type CutoutTarget,
  type TrackProgress,
} from '@/engine/cutout';

export type CutoutTool = 'lasso' | 'include' | 'exclude';
export type CutoutPhase = 'opening' | 'drawing' | 'thinking' | 'result' | 'tracking';

interface CutoutEditorState {
  /** Clipe em edição; null = laço fechado. */
  clipId: string | null;
  phase: CutoutPhase;
  session: CutoutSession | null;
  tool: CutoutTool;
  lasso: Point[];
  clicks: Click[];
  /** Resultado para mostrar: probabilidade 0..255 em 256x256. */
  mask: Uint8Array | null;
  coverage: number;
  progress: TrackProgress | null;
  error: string | null;
  start: (clipId: string, target: CutoutTarget, time: Micros) => Promise<void>;
  setTool: (tool: CutoutTool) => void;
  finishLasso: (lasso: Point[]) => Promise<void>;
  addClick: (click: Click) => Promise<void>;
  undo: () => void;
  /** Rastreia o clipe inteiro e grava as máscaras; devolve o recorte para o projeto. */
  apply: () => Promise<Cutout | null>;
  cancelTracking: () => void;
  close: () => void;
}

let tracking: AbortController | null = null;

const IDLE = {
  clipId: null,
  phase: 'opening' as CutoutPhase,
  session: null,
  tool: 'lasso' as CutoutTool,
  lasso: [],
  clicks: [],
  mask: null,
  coverage: 0,
  progress: null,
  error: null,
};

function message(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return text.replace(/^Error:\s*/, '');
}

export const useCutoutEditor = create<CutoutEditorState>((set, get) => ({
  ...IDLE,

  async start(clipId, target, time) {
    get().session?.dispose();
    set({ ...IDLE, clipId, phase: 'opening' });
    try {
      const session = await CutoutSession.open(target, time, CUTOUT_FPS);
      if (get().clipId !== clipId) {
        session.dispose();
        return;
      }
      set({ session, phase: 'drawing' });
    } catch (e) {
      if (get().clipId === clipId) set({ error: `Não foi possível abrir o quadro: ${message(e)}`, phase: 'drawing' });
    }
  },

  setTool(tool) {
    set({ tool });
  },

  async finishLasso(lasso) {
    const session = get().session;
    if (!session || lasso.length < 3) return;
    set({ lasso, clicks: [], mask: null, phase: 'thinking', error: null, tool: 'lasso' });
    try {
      const result = await session.predict(lasso, []);
      if (get().session !== session) return;
      if (result.coverage < 0.0005) {
        set({ phase: 'drawing', lasso: [], error: 'Não achei um objeto dentro do laço. Tente contornar de novo, mais justo.' });
        return;
      }
      set({ mask: result.mask, coverage: result.coverage, phase: 'result' });
    } catch (e) {
      set({ phase: 'drawing', lasso: [], error: message(e) });
    }
  },

  async addClick(click) {
    const { session, lasso, clicks } = get();
    if (!session || get().phase !== 'result') return;
    const next = [...clicks, click];
    set({ clicks: next, phase: 'thinking', error: null });
    try {
      const result = await session.predict(lasso, next);
      if (get().session !== session) return;
      set({ mask: result.mask, coverage: result.coverage, phase: 'result' });
    } catch (e) {
      set({ clicks, phase: 'result', error: message(e) });
    }
  },

  undo() {
    const { session, clicks, phase } = get();
    if (!session || phase === 'thinking' || phase === 'tracking') return;
    if (clicks.length > 0) {
      const back = session.undo();
      set({ clicks: clicks.slice(0, -1), mask: back?.mask ?? null, coverage: back?.coverage ?? 0, phase: back ? 'result' : 'drawing' });
      return;
    }
    session.undo();
    set({ lasso: [], mask: null, coverage: 0, phase: 'drawing', tool: 'lasso' });
  },

  async apply() {
    const { session, lasso, clicks } = get();
    if (!session || !get().mask) return null;
    const controller = new AbortController();
    tracking = controller;
    set({ phase: 'tracking', progress: { done: 0, total: session.times.length, msPerFrame: 0 }, error: null });
    await activateKeepAwakeAsync('cutout').catch(() => {});
    try {
      const masks = await session.track((progress) => set({ progress }), controller.signal);
      const target = session.target;
      const file = saveCutoutMasks(target.projectId, session.times[0]!, CUTOUT_FPS, masks);
      const cutout: Cutout = {
        file,
        from: target.from,
        to: target.to,
        fps: CUTOUT_FPS,
        invert: false,
        feather: 0,
        prompt: { time: session.time, lasso, clicks },
      };
      get().close();
      return cutout;
    } catch (e) {
      if (controller.signal.aborted) set({ phase: 'result', progress: null });
      else set({ phase: 'result', progress: null, error: `O rastreio parou: ${message(e)}` });
      return null;
    } finally {
      tracking = null;
      deactivateKeepAwake('cutout').catch(() => {});
    }
  },

  cancelTracking() {
    tracking?.abort();
  },

  close() {
    tracking?.abort();
    get().session?.dispose();
    set({ ...IDLE });
    // As redes ocupam umas centenas de MB: solta quando o recorte fecha.
    releaseCutoutSessions();
  },
}));
