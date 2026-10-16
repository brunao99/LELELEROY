/**
 * Recursos do desenho da colagem na tela: a cópia menor de cada foto, as
 * figurinhas e os parágrafos dos textos (refeitos só quando o texto ou o
 * estilo mudam). As imagens ficam carregadas até o editor fechar.
 */
import type { SkImage, SkTypefaceFontProvider } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';

import { collageDesignSize, type Collage } from '@/core/collage';
import type { Size } from '@/core/geometry';
import type { CollageResources } from '@/engine/collageDraw';
import { loadImage, TEXT_MAX_WIDTH } from '@/engine/resources';
import { buildTextParts, type TextParts } from '@/engine/text';
import { collageUri } from '@/storage/collages';

export interface LoadedCollageResources {
  res: CollageResources;
  /** Tamanho de cada texto (com o fundo), para tocar e selecionar. */
  textSizes: Record<string, Size>;
}

/** Parágrafos já montados, por camada (o editor abre uma colagem por vez). */
const textCache = new Map<string, { key: string; parts: TextParts }>();

export function useCollageResources(c: Collage | null, provider: SkTypefaceFontProvider | null): LoadedCollageResources {
  const [images, setImages] = useState<ReadonlyMap<string, SkImage>>(() => new Map());

  // Fotos e figurinhas: chave por id, carregadas uma vez cada.
  const wanted = useMemo(() => {
    if (!c) return [] as { key: string; uri: string }[];
    return [
      ...Object.values(c.photos).map((p) => ({ key: `p:${p.id}`, uri: collageUri(c.id, p.preview) })),
      ...Object.values(c.stickers).map((s) => ({ key: `s:${s.id}`, uri: collageUri(c.id, s.file) })),
    ];
  }, [c]);
  const missing = JSON.stringify(wanted.filter((w) => !images.has(w.key)));

  useEffect(() => {
    const list = JSON.parse(missing) as { key: string; uri: string }[];
    if (list.length === 0) return;
    let cancelled = false;
    (async () => {
      const loaded: [string, SkImage][] = [];
      for (const { key, uri } of list) {
        const image = await loadImage(uri);
        if (image) loaded.push([key, image]);
      }
      if (cancelled) {
        for (const [, image] of loaded) image.dispose();
        return;
      }
      setImages((prev) => {
        const next = new Map(prev);
        for (const [key, image] of loaded) {
          if (next.has(key)) image.dispose();
          else next.set(key, image);
        }
        return next;
      });
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [missing]);

  // Ao fechar o editor, solta tudo.
  const [owned] = useState(() => ({ images: new Map<string, SkImage>() }));
  useEffect(() => {
    for (const [key, image] of images) owned.images.set(key, image);
  }, [images, owned]);
  useEffect(
    () => () => {
      for (const image of owned.images.values()) image.dispose();
      owned.images.clear();
      textCache.clear();
    },
    [owned],
  );

  const texts = useMemo(() => {
    const out: Record<string, TextParts> = {};
    if (!c || !provider) return out;
    const { width: W, height: H } = collageDesignSize(c);
    for (const layer of c.layers) {
      if (layer.kind !== 'text') continue;
      const key = `${layer.text}|${JSON.stringify(layer.style)}|${W}x${H}`;
      const hit = textCache.get(layer.id);
      if (hit && hit.key === key) {
        out[layer.id] = hit.parts;
        continue;
      }
      const parts = buildTextParts(layer.text, layer.style, Math.min(W, H), W * TEXT_MAX_WIDTH, provider);
      textCache.set(layer.id, { key, parts });
      out[layer.id] = parts;
    }
    return out;
  }, [c, provider]);

  return useMemo(() => {
    const photos: Record<string, SkImage> = {};
    const stickers: Record<string, SkImage> = {};
    for (const [key, image] of images) {
      if (key.startsWith('p:')) photos[key.slice(2)] = image;
      else stickers[key.slice(2)] = image;
    }
    const textSizes: Record<string, Size> = {};
    for (const layer of c?.layers ?? []) {
      const parts = texts[layer.id];
      if (layer.kind !== 'text' || !parts) continue;
      const pad = layer.style.background ? parts.padding * 2 : 0;
      textSizes[layer.id] = { width: parts.width + pad, height: parts.height + pad };
    }
    return { res: { photos, stickers, texts }, textSizes };
  }, [images, texts, c]);
}
