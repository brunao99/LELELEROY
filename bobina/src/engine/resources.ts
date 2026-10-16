/**
 * Recursos do desenho: fotos carregadas no Skia e parágrafos dos textos, em cache
 * pela versão (texto + estilo). Recalcula só o que mudou.
 */
import { Skia, type SkImage, type SkTypefaceFontProvider } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { scheduleOnUI } from 'react-native-worklets';

import { parseMaskFile } from '@/core/cutout';
import type { RenderPlan } from '@/core/renderPlan';
import type { Project } from '@/core/types';
import { fileUri, projectFile } from '@/storage/paths';

import type { DrawResources } from './draw';
import { installMasks, removeMasks } from './maskStore';
import { fxEffect, gradeEffect } from './shaders';
import { buildCaptionParts, buildTextParts, type TextParts } from './text';

/** Largura máxima de uma linha de texto, em fração da largura do quadro. */
export const TEXT_MAX_WIDTH = 0.9;
export const CAPTION_MAX_WIDTH = 0.86;

export async function loadImage(uri: string): Promise<SkImage | null> {
  try {
    const data = await Skia.Data.fromURI(uri);
    return Skia.Image.MakeImageFromEncoded(data);
  } catch {
    return null;
  }
}

/** Ids das fotos que o desenho precisa (clipes, sobreposições e fundo). */
export function imageAssetIds(project: Project): string[] {
  const ids = new Set<string>();
  for (const c of [...project.main, ...project.overlays]) {
    if (project.assets[c.assetId]?.kind === 'image') ids.add(c.assetId);
  }
  if (project.background.kind === 'image') ids.add(project.background.assetId);
  return [...ids];
}

export async function loadImages(project: Project, ids: string[]): Promise<Record<string, SkImage>> {
  const out: Record<string, SkImage> = {};
  await Promise.all(
    ids.map(async (id) => {
      const asset = project.assets[id];
      if (!asset) return;
      const image = await loadImage(fileUri(project.id, asset.file));
      if (image) out[id] = image;
    }),
  );
  return out;
}

/** Máscaras do recorte já lidas do arquivo (comprimidas). */
export interface LoadedMasks {
  data: Uint8Array;
  offsets: Uint32Array;
  size: number;
}

/** Arquivos de máscara que o desenho do projeto usa. */
export function cutoutFiles(project: Project): string[] {
  const files = new Set<string>();
  for (const c of [...project.main, ...project.overlays]) if (c.cutout) files.add(c.cutout.file);
  return [...files];
}

export async function readMasks(projectId: string, file: string): Promise<LoadedMasks | null> {
  try {
    const f = projectFile(projectId, file);
    if (!f.exists) return null;
    const parsed = parseMaskFile(await f.bytes());
    return { data: parsed.data, offsets: parsed.offsets, size: parsed.header.size };
  } catch {
    return null;
  }
}

/** Máscaras já instaladas no runtime do preview (só existe um editor aberto por vez). */
const masksOnUI = new Set<string>();

/** Monta os parágrafos de todos os textos e legendas do plano (sem cache: para a exportação). */
export function buildAllText(plan: RenderPlan, provider: SkTypefaceFontProvider) {
  const shortSide = Math.min(plan.width, plan.height);
  const texts: Record<string, TextParts> = {};
  for (const t of plan.texts) {
    texts[t.id] = buildTextParts(t.text, t.style, shortSide, plan.width * TEXT_MAX_WIDTH, provider);
  }
  const captions: Record<string, TextParts> = {};
  for (const c of plan.captions.items) {
    captions[c.id] = buildCaptionParts(c.text, plan.captions.style, shortSide, plan.width * CAPTION_MAX_WIDTH, provider, c.words, plan.captions.highlight);
  }
  return { texts, captions };
}

/**
 * Cache dos parágrafos do preview, por (id, versão, tamanho do quadro). Fica no
 * módulo: só existe um editor aberto por vez e o cache é podado a cada uso.
 */
const textCache = new Map<string, TextParts>();
const captionCache = new Map<string, TextParts>();

function cachedParts(
  cache: Map<string, TextParts>,
  used: Set<string>,
  key: string,
  build: () => TextParts,
): TextParts {
  used.add(key);
  let parts = cache.get(key);
  if (!parts) {
    parts = build();
    cache.set(key, parts);
  }
  return parts;
}

function prune(cache: Map<string, TextParts>, used: Set<string>) {
  for (const key of [...cache.keys()]) if (!used.has(key)) cache.delete(key);
}

/** Recursos do preview, refeitos aos poucos conforme o projeto muda. */
export function useDrawResources(
  project: Project | null,
  plan: RenderPlan | null,
  provider: SkTypefaceFontProvider | null,
): DrawResources | null {
  const [images, setImages] = useState<Record<string, SkImage>>({});
  const [masks, setMasks] = useState(0);

  const imageIds = project ? imageAssetIds(project).sort().join(',') : '';
  useEffect(() => {
    if (!project) return;
    const wanted = imageIds ? imageIds.split(',') : [];
    const missing = wanted.filter((id) => !images[id]);
    if (missing.length === 0) return;
    let cancelled = false;
    loadImages(project, missing).then((loaded) => {
      if (!cancelled && Object.keys(loaded).length) setImages((prev) => ({ ...prev, ...loaded }));
    });
    return () => {
      cancelled = true;
    };
    // `project` muda a cada edição; só importa a lista de fotos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageIds, project?.id]);

  // Recortes: as máscaras vão para o runtime do preview uma vez; o desenho pede quadro a quadro.
  const cutoutKeys = project ? cutoutFiles(project).sort().join(',') : '';
  useEffect(() => {
    if (!project) return;
    const wanted = new Set(cutoutKeys ? cutoutKeys.split(',') : []);
    for (const key of [...masksOnUI]) {
      if (wanted.has(key)) continue;
      scheduleOnUI(removeMasks, key);
      masksOnUI.delete(key);
    }
    let cancelled = false;
    for (const key of wanted) {
      if (masksOnUI.has(key)) continue;
      readMasks(project.id, key).then((loaded) => {
        if (cancelled || !loaded) return;
        scheduleOnUI(installMasks, key, loaded.data, loaded.offsets, loaded.size);
        masksOnUI.add(key);
        setMasks((n) => n + 1);
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cutoutKeys, project?.id]);

  return useMemo(() => {
    if (!plan || !provider) return null;
    const shortSide = Math.min(plan.width, plan.height);
    const size = `${plan.width}x${plan.height}`;
    const usedTexts = new Set<string>();
    const texts: Record<string, TextParts> = {};
    for (const t of plan.texts) {
      texts[t.id] = cachedParts(textCache, usedTexts, `${t.id}:${t.version}:${size}`, () =>
        buildTextParts(t.text, t.style, shortSide, plan.width * TEXT_MAX_WIDTH, provider),
      );
    }
    prune(textCache, usedTexts);
    const usedCaptions = new Set<string>();
    const captions: Record<string, TextParts> = {};
    for (const c of plan.captions.items) {
      captions[c.id] = cachedParts(captionCache, usedCaptions, `${c.id}:${c.version}:${size}`, () =>
        buildCaptionParts(c.text, plan.captions.style, shortSide, plan.width * CAPTION_MAX_WIDTH, provider, c.words, plan.captions.highlight),
      );
    }
    prune(captionCache, usedCaptions);
    return { images, texts, captions, grade: gradeEffect(), fx: fxEffect(), masks };
  }, [plan, provider, images, masks]);
}
