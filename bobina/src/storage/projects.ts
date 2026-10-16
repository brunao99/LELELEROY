/**
 * Projetos no disco: uma pasta por projeto com `project.json` (o projeto) e
 * `summary.json` (o que a tela inicial precisa, para não abrir projetos inteiros).
 */
import { Directory, File } from 'expo-file-system';

import { SCHEMA_VERSION } from '@/core/defaults';
import { reconcileFiles, unusedCaches, type FileCheck } from '@/core/files';
import { newId } from '@/core/ids';
import { projectDuration } from '@/core/timeline';
import type { Project, Ratio } from '@/core/types';

import { ensureDir, projectDir, projectFile, projectsRoot } from './paths';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  duration: number;
  ratio: Ratio;
  /** Caminho relativo da capa (`cover.jpg`) ou null. */
  cover: string | null;
  clipCount: number;
}

export class ProjectFormatError extends Error {}

function summaryOf(project: Project, cover: string | null): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    duration: projectDuration(project),
    ratio: project.ratio,
    cover,
    clipCount: project.main.length,
  };
}

/** Grava texto de forma atômica: arquivo temporário e depois troca. */
export function writeAtomic(dir: Directory, name: string, content: string) {
  const tmp = new File(dir, `${name}.tmp`);
  if (tmp.exists) tmp.delete();
  tmp.create();
  tmp.write(content);
  const target = new File(dir, name);
  tmp.moveSync(target, { overwrite: true });
}

export function saveProject(project: Project): void {
  const dir = ensureDir(projectDir(project.id));
  writeAtomic(dir, 'project.json', JSON.stringify(project));
  const coverFile = new File(dir, 'cover.jpg');
  writeAtomic(dir, 'summary.json', JSON.stringify(summaryOf(project, coverFile.exists ? 'cover.jpg' : null)));
}

/** Atualiza só o arquivo de resumo (por exemplo, depois de gerar a capa). */
export function saveSummary(project: Project): void {
  const dir = ensureDir(projectDir(project.id));
  const coverFile = new File(dir, 'cover.jpg');
  writeAtomic(dir, 'summary.json', JSON.stringify(summaryOf(project, coverFile.exists ? 'cover.jpg' : null)));
}

/** Migrações de versões antigas do arquivo ficam aqui. */
export function migrate(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new ProjectFormatError('Arquivo de projeto inválido.');
  const data = raw as Partial<Project>;
  if (data.schemaVersion !== SCHEMA_VERSION) {
    throw new ProjectFormatError(`Versão de projeto desconhecida: ${String(data.schemaVersion)}.`);
  }
  // Campos adicionados depois da versão 1 ganham valores padrão aqui.
  return { ...(data as Project), bakes: data.bakes ?? {}, audioRenders: data.audioRenders ?? {} };
}

export async function loadProject(id: string): Promise<Project> {
  const file = new File(projectDir(id), 'project.json');
  if (!file.exists) throw new ProjectFormatError('O projeto não foi encontrado.');
  return migrate(JSON.parse(await file.text()));
}

/**
 * Confere os arquivos do projeto no disco (ver `reconcileFiles`). Com `prune`,
 * também apaga as cópias e os áudios processados que nenhum clipe usa: só ao
 * abrir o editor, quando ainda não há histórico de desfazer que precise deles.
 */
export function checkProjectFiles(project: Project, options: { prune: boolean }): FileCheck {
  const checked = reconcileFiles(project, (relative) => projectFile(project.id, relative).exists);
  if (!options.prune) return checked;
  const unused = unusedCaches(checked.project);
  for (const relative of unused.files) {
    try {
      const file = projectFile(project.id, relative);
      if (file.exists) file.delete();
    } catch {
      // Fica para a próxima limpeza de caches.
    }
  }
  return { ...checked, project: unused.project };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const root = projectsRoot();
  if (!root.exists) return [];
  const out: ProjectSummary[] = [];
  for (const entry of root.list()) {
    if (!(entry instanceof Directory)) continue;
    const summary = new File(entry, 'summary.json');
    if (!summary.exists) continue;
    try {
      out.push(JSON.parse(await summary.text()) as ProjectSummary);
    } catch {
      // Resumo corrompido: o projeto aparece de novo quando for salvo.
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteProject(id: string): void {
  const dir = projectDir(id);
  if (dir.exists) dir.delete();
}

/** Copia a pasta inteira para um projeto novo, com outro id e nome. */
export async function duplicateProject(id: string, now: number): Promise<ProjectSummary> {
  const source = await loadProject(id);
  const copyId = newId('p');
  const target = projectDir(copyId);
  projectDir(id).copySync(target);
  const copy: Project = { ...source, id: copyId, name: `${source.name} (cópia)`, createdAt: now, updatedAt: now };
  saveProject(copy);
  return summaryOf(copy, new File(target, 'cover.jpg').exists ? 'cover.jpg' : null);
}

export function renameProjectOnDisk(project: Project, name: string, now: number): Project {
  const renamed = { ...project, name: name.trim() || project.name, updatedAt: now };
  saveProject(renamed);
  return renamed;
}

/** Tamanho ocupado por uma pasta (para a tela de configurações). */
export function directorySize(dir: Directory): number {
  if (!dir.exists) return 0;
  let total = 0;
  for (const entry of dir.list()) {
    if (entry instanceof Directory) total += directorySize(entry);
    else total += entry.size ?? 0;
  }
  return total;
}
