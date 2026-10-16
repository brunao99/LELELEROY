/**
 * Erros que fechariam o app. Em vez de fechar, o app mostra o erro numa tela
 * (ver CrashGate) para o usuário compartilhar: no celular não há outro jeito
 * de ver o log. Este módulo só depende do React Native, para não falhar junto.
 */
import { Platform } from 'react-native';

export interface CrashInfo {
  /** De onde veio: erro agora ou o app fechou na abertura anterior (Java). */
  kind: 'now' | 'previous';
  message: string;
  details: string;
}

type Listener = (crash: CrashInfo) => void;

let current: CrashInfo | null = null;
const listeners = new Set<Listener>();

export function currentCrash(): CrashInfo | null {
  return current;
}

export function subscribeCrash(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function toCrashInfo(error: unknown, extra?: string): CrashInfo {
  const e = error instanceof Error ? error : new Error(String(error));
  const details = [e.stack ?? '', extra ?? ''].filter(Boolean).join('\n\nComponentes:\n');
  return { kind: 'now', message: `${e.name}: ${e.message}`, details };
}

export function reportCrash(error: unknown, extra?: string): void {
  current = toCrashInfo(error, extra);
  for (const listener of listeners) listener(current);
}

export function reportPreviousCrash(text: string): void {
  const lines = text.trim().split('\n');
  const first = lines.find((l) => /Exception|Error/.test(l)) ?? lines[0] ?? 'Erro desconhecido';
  current = { kind: 'previous', message: first.trim(), details: text.trim() };
  for (const listener of listeners) listener(current);
}

export function clearCrash(): void {
  current = null;
}

/** Texto para compartilhar: o erro e o aparelho. */
export function crashReport(crash: CrashInfo): string {
  const constants = Platform.constants as Record<string, unknown>;
  const device = [constants.Manufacturer, constants.Model].filter(Boolean).join(' ');
  return [
    `Ledit's — ${crash.kind === 'previous' ? 'fechou na abertura anterior' : 'erro'}`,
    `Aparelho: ${device || 'desconhecido'} · ${Platform.OS} ${String(constants.Release ?? Platform.Version)}`,
    '',
    crash.message,
    '',
    crash.details,
  ].join('\n');
}

/** Troca o tratamento de erros fatais do React Native por esta tela. */
export function installCrashHandler(): void {
  const utils = (globalThis as { ErrorUtils?: { getGlobalHandler(): (e: unknown, fatal?: boolean) => void; setGlobalHandler(h: (e: unknown, fatal?: boolean) => void): void } }).ErrorUtils;
  if (!utils) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    if (!isFatal) {
      previous(error, isFatal);
      return;
    }
    reportCrash(error);
  });
}
