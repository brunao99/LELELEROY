/**
 * Arquivos do projeto: o que o JSON aponta e o disco não tem mais, e os caches
 * que nenhum clipe usa. Sem acesso ao disco aqui: quem chama diz o que existe.
 */
import { audioRenderKey, bakeKey, needsAudioRender, needsBake } from './composition';
import type { Project } from './types';

/** Mídias que o projeto usa: clipes, sobreposições, áudios e a foto de fundo. */
export function usedAssetIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const c of [...project.main, ...project.overlays, ...project.audios]) ids.add(c.assetId);
  if (project.background.kind === 'image') ids.add(project.background.assetId);
  return ids;
}

export interface FileCheck {
  project: Project;
  /** Mídias usadas cujo arquivo não está mais na pasta do projeto. */
  missingAssets: string[];
}

/**
 * Esquece as cópias aceleradas e os áudios processados cujos arquivos sumiram
 * (limpar os caches apaga essas pastas; o editor refaz o que faltar) e lista as
 * mídias originais que faltam.
 */
export function reconcileFiles(project: Project, exists: (relative: string) => boolean): FileCheck {
  const bakes = Object.fromEntries(
    Object.entries(project.bakes).filter(([, b]) => [b.videoFile, b.audioFile].every((f) => !f || exists(f))),
  );
  const audioRenders = Object.fromEntries(Object.entries(project.audioRenders).filter(([, r]) => exists(r.file)));
  const changed =
    Object.keys(bakes).length !== Object.keys(project.bakes).length ||
    Object.keys(audioRenders).length !== Object.keys(project.audioRenders).length;
  const missingAssets = [...usedAssetIds(project)].filter((id) => {
    const asset = project.assets[id];
    return !!asset && !exists(asset.file);
  });
  return { project: changed ? { ...project, bakes, audioRenders } : project, missingAssets };
}

/**
 * Cópias aceleradas e áudios processados que nenhum clipe usa mais. Devolve o
 * projeto sem eles e os arquivos para apagar.
 */
export function unusedCaches(project: Project): { project: Project; files: string[] } {
  const clips = [...project.main, ...project.overlays, ...project.audios];
  const bakeKeys = new Set(clips.filter(needsBake).map((c) => bakeKey(c.assetId, c.speed, c.keepPitch, !!c.reverse)));
  const renderKeys = new Set(clips.filter((c) => needsAudioRender(c)).map((c) => audioRenderKey(c)));
  const files: string[] = [];
  const bakes = { ...project.bakes };
  for (const [key, bake] of Object.entries(project.bakes)) {
    if (bakeKeys.has(key)) continue;
    if (bake.videoFile) files.push(bake.videoFile);
    if (bake.audioFile) files.push(bake.audioFile);
    delete bakes[key];
  }
  const audioRenders = { ...project.audioRenders };
  for (const [key, render] of Object.entries(project.audioRenders)) {
    if (renderKeys.has(key)) continue;
    files.push(render.file);
    delete audioRenders[key];
  }
  const changed =
    Object.keys(bakes).length !== Object.keys(project.bakes).length ||
    Object.keys(audioRenders).length !== Object.keys(project.audioRenders).length;
  return { project: changed ? { ...project, bakes, audioRenders } : project, files };
}

/** Quantos itens apontam para mídias que faltam (para o aviso). */
export function countUnavailable(project: Project, unavailable: ReadonlySet<string>): number {
  if (unavailable.size === 0) return 0;
  let n = 0;
  for (const c of [...project.main, ...project.overlays, ...project.audios]) if (unavailable.has(c.assetId)) n++;
  if (project.background.kind === 'image' && unavailable.has(project.background.assetId)) n++;
  return n;
}
