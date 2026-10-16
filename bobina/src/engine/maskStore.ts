/**
 * Máscaras do recorte dentro de cada runtime de desenho (preview e exportação).
 * Só worklets: quem lê o arquivo e instala é engine/resources.ts (preview) e
 * engine/exporter.ts (exportação).
 *
 * O arquivo comprimido (poucos KB por quadro) é copiado uma vez para o runtime
 * e fica num objeto global dele; a cada quadro desenhado, só aquela máscara é
 * descomprimida (64 KB) e vira imagem. Assim nada grande atravessa os runtimes
 * a cada edição do projeto.
 */
import { AlphaType, ColorType, FilterMode, MipmapMode, Skia, TileMode, type SkImage, type SkShader } from '@shopify/react-native-skia';

import { decodeRle } from '@/core/cutout';

interface Entry {
  data: Uint8Array;
  offsets: Uint32Array;
  size: number;
  buf: Uint8Array;
  index: number;
  image: SkImage | null;
}

interface StoreGlobal {
  __ledCutouts?: Record<string, Entry>;
  __ledNoMask?: SkShader;
}

/** Guarda as máscaras no runtime onde roda (chamar dentro de um worklet). */
export function installMasks(key: string, data: Uint8Array, offsets: Uint32Array, size: number): void {
  'worklet';
  const g = globalThis as unknown as StoreGlobal;
  g.__ledCutouts ??= {};
  g.__ledCutouts[key]?.image?.dispose();
  g.__ledCutouts[key] = { data, offsets, size, buf: new Uint8Array(size * size), index: -1, image: null };
}

export function removeMasks(key: string): void {
  'worklet';
  const g = globalThis as unknown as StoreGlobal;
  const entry = g.__ledCutouts?.[key];
  if (!entry) return;
  entry.image?.dispose();
  delete g.__ledCutouts![key];
}

/** Máscara `index` como imagem (tons de cinza), ou null se não estiver carregada. */
export function maskImage(key: string, index: number): SkImage | null {
  'worklet';
  const entry = (globalThis as unknown as StoreGlobal).__ledCutouts?.[key];
  if (!entry || index < 0 || index + 1 >= entry.offsets.length) return null;
  if (entry.index === index && entry.image) return entry.image;
  decodeRle(entry.data, entry.buf, entry.offsets[index], entry.offsets[index + 1]);
  const image = Skia.Image.MakeImage(
    { width: entry.size, height: entry.size, colorType: ColorType.Gray_8, alphaType: AlphaType.Opaque },
    Skia.Data.fromBytes(entry.buf),
    entry.size,
  );
  entry.image?.dispose();
  entry.image = image;
  entry.index = image ? index : -1;
  return image;
}

/** Shader de máscara vazia (o shader de efeitos sempre recebe dois filhos). */
export function noMaskShader(): SkShader {
  'worklet';
  const g = globalThis as unknown as StoreGlobal;
  if (!g.__ledNoMask) {
    const one = Skia.Image.MakeImage(
      { width: 1, height: 1, colorType: ColorType.Gray_8, alphaType: AlphaType.Opaque },
      Skia.Data.fromBytes(new Uint8Array([255])),
      1,
    )!;
    g.__ledNoMask = one.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Nearest, MipmapMode.None);
  }
  return g.__ledNoMask;
}
