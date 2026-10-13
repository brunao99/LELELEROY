import type { Project } from './types';

export interface History {
  past: Project[];
  present: Project;
  future: Project[];
  /** Chave do último gesto contínuo (arrastar um slider, por exemplo). */
  lastKey: string | null;
  lastAt: number;
}

export const HISTORY_LIMIT = 100;
/** Edições com a mesma chave dentro desse intervalo viram um único passo de desfazer. */
export const COALESCE_MS = 1200;

export function initHistory(project: Project): History {
  return { past: [], present: project, future: [], lastKey: null, lastAt: 0 };
}

export interface CommitOptions {
  /** Edições seguidas com a mesma chave (o mesmo slider, o mesmo arrasto) se juntam. */
  key?: string;
  now?: number;
  limit?: number;
}

export function commit(history: History, next: Project, options: CommitOptions = {}): History {
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
export function endGesture(history: History): History {
  return history.lastKey === null ? history : { ...history, lastKey: null };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

export function undo(history: History): History {
  if (!canUndo(history)) return history;
  const past = history.past.slice(0, -1);
  const previous = history.past[history.past.length - 1]!;
  return { past, present: previous, future: [history.present, ...history.future], lastKey: null, lastAt: 0 };
}

export function redo(history: History): History {
  if (!canRedo(history)) return history;
  const [next, ...future] = history.future;
  return { past: [...history.past, history.present], present: next!, future, lastKey: null, lastAt: 0 };
}

/** Troca o presente sem criar passo (dados que não se desfazem, como um "bake" terminado). */
export function replacePresent(history: History, next: Project): History {
  return next === history.present ? history : { ...history, present: next };
}
