import { clearCrash, crashReport, currentCrash, reportCrash, reportPreviousCrash, subscribeCrash, toCrashInfo } from '../state';

afterEach(() => clearCrash());

describe('tela de erro', () => {
  it('guarda o erro e avisa quem está ouvindo', () => {
    const seen: string[] = [];
    const stop = subscribeCrash((c) => seen.push(c.message));
    reportCrash(new TypeError('x is undefined'), 'in Editor');
    stop();
    expect(seen).toEqual(['TypeError: x is undefined']);
    expect(currentCrash()?.details).toContain('Componentes:\nin Editor');
  });

  it('aceita qualquer coisa lançada, não só Error', () => {
    expect(toCrashInfo('falhou').message).toBe('Error: falhou');
  });

  it('do log nativo, usa a linha da exceção como título', () => {
    reportPreviousCrash('Thread: main\njava.lang.UnsatisfiedLinkError: dlopen failed\n\tat java.lang.Runtime.loadLibrary0');
    expect(currentCrash()).toMatchObject({ kind: 'previous', message: 'java.lang.UnsatisfiedLinkError: dlopen failed' });
  });

  it('o texto compartilhado traz o aparelho e a pilha', () => {
    const text = crashReport(toCrashInfo(new Error('boom')));
    expect(text).toContain('Aparelho:');
    expect(text).toContain('Error: boom');
  });
});
