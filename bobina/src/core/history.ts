import type { Project } from './types';

/** Histórico de um documento (o projeto de vídeo ou uma colagem). */
export interface History<T = Project> {
  past: T[];
  present: T;
  future: T[];
  /** Chave do último gesto contínuo (arrastar um slider, por exemplo). */
  lastKey: string | null;
  lastAt: number;
}

export const HISTORY_LIMIT = 100;
/** Edições com a mesma chave dentro desse intervalo viram um único passo de desfazer. */
export const COALESCE_MS = 1200;

export function initHistory<T>(project: T): History<T> {
  return { past: [], present: project, future: [], lastKey: null, lastAt: 0 };
}

export interface CommitOptions {
  /** Edições seguidas com a mesma chave (o mesmo slider, o mesmo arrasto) se juntam. */
  key?: string;
  now?: number;
  limit?: number;
}

export function commit<T>(history: History<T>, next: T, options: CommitOptions = {}): History<T> {
  if (next === history.present) return history;
  const now = options.now ?? Date.now();
  const limit = options.limit ?? HISTORY_LIMIT;
  const coalesce =
    options.key !== undefined &&
    options.key === history.lastKey &&
    now - history.lastAt < COALESCE_MS &&
    history.past.length > 0;
  if (coalesce) {
    return { ...history, present: next, future: [], lastAt: now };
  }
  const past = [...history.past, history.present];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { past, present: next, future: [], lastKey: options.key ?? null, lastAt: now };
}

/** Encerra o gesto atual: a próxima edição com a mesma chave vira um passo novo. */
export function endGesture<T>(history: History<T>): History<T> {
  return history.lastKey === null ? history : { ...history, lastKey: null };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
  if (!canUndo(history)) return history;
  const past = history.past.slice(0, -1);
  const previous = history.past[history.past.length - 1]!;
  return { past, present: previous, future: [history.present, ...history.future], lastKey: null, lastAt: 0 };
}

export function redo<T>(history: History<T>): History<T> {
  if (!canRedo(history)) return history;
  const [next, ...future] = history.future;
  return { past: [...history.past, history.present], present: next!, future, lastKey: null, lastAt: 0 };
}

/** Troca o presente sem criar passo (dados que não se desfazem, como um "bake" terminado). */
export function replacePresent<T>(history: History<T>, next: T): History<T> {
  return next === history.present ? history : { ...history, present: next };
}
