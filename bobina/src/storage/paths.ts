import { Directory, File, Paths } from 'expo-file-system';

/** Pasta raiz dos projetos dentro dos documentos do app. */
export function projectsRoot(): Directory {
  return new Directory(Paths.document, 'projects');
}

export function projectDir(projectId: string): Directory {
  return new Directory(Paths.document, 'projects', projectId);
}

export function modelsDir(): Directory {
  return new Directory(Paths.document, 'models');
}

export function exportsDir(): Directory {
  return new Directory(Paths.document, 'exports');
}

/** Arquivo dentro do projeto a partir do caminho relativo (`media/abc.mp4`). */
export function projectFile(projectId: string, relative: string): File {
  return new File(projectDir(projectId), ...relative.split('/'));
}

/** `file:///…` → `/…` (o motor de vídeo quer o caminho puro). */
export function toPlainPath(uri: string): string {
  const path = uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** Caminho absoluto puro de um arquivo do projeto. */
export function absolutePath(projectId: string, relative: string): string {
  return toPlainPath(projectFile(projectId, relative).uri);
}

/** URI `file://` de um arquivo do projeto (para Image, Skia e o decodificador de áudio). */
export function fileUri(projectId: string, relative: string): string {
  return projectFile(projectId, relative).uri;
}

export function ensureDir(dir: Directory): Directory {
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}
