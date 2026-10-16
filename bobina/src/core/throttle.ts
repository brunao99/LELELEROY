/**
 * Limita a frequência de uma função: chama na hora, depois no máximo uma vez a
 * cada `interval` ms, e sempre uma última vez com o valor mais recente (para o
 * fim do gesto nunca se perder).
 */
export interface Throttled<T> {
  (value: T): void;
  /** Executa já o que estiver pendente. */
  flush: () => void;
  cancel: () => void;
}

export function throttle<T>(fn: (value: T) => void, interval: number, now: () => number = Date.now): Throttled<T> {
  let last = -Infinity;
  let pending: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const run = () => {
    timer = null;
    if (!pending) return;
    const { value } = pending;
    pending = null;
    last = now();
    fn(value);
  };

  const throttled = ((value: T) => {
    pending = { value };
    const wait = last + interval - now();
    if (wait <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      run();
    } else if (!timer) {
      timer = setTimeout(run, wait);
    }
  }) as Throttled<T>;
  throttled.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    run();
  };
  throttled.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return throttled;
}
