/**
 * Colagem para fora do editor: a imagem final (JPEG na galeria), a capa da
 * lista e a figurinha sozinha em PNG transparente. Desenha com o mesmo
 * `drawCollage` da tela, numa superfície fora da tela.
 */
import { ImageFormat, Skia, type SkImage, type SkTypefaceFontProvider } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Asset, requestPermissionsAsync } from 'expo-media-library';

import {
  collageDesignSize,
  collageExportSize,
  photoDrawSides,
  type Collage,
  type CollageExportSize,
  type StickerLayer,
} from '@/core/collage';
import { collageDir, collageUri, saveCollageSummary } from '@/storage/collages';
import { ensureDir, exportsDir } from '@/storage/paths';

import { drawCollage, stickerFilter, type CollageResources } from './collageDraw';
import { loadImage, TEXT_MAX_WIDTH } from './resources';
import { buildTextParts, type TextParts } from './text';

/** Parágrafos dos textos da colagem, no espaço de desenho. */
export function buildCollageTexts(c: Collage, provider: SkTypefaceFontProvider): Record<string, TextParts> {
  const { width: W, height: H } = collageDesignSize(c);
  const out: Record<string, TextParts> = {};
  for (const layer of c.layers) {
    if (layer.kind === 'text') out[layer.id] = buildTextParts(layer.text, layer.style, Math.min(W, H), W * TEXT_MAX_WIDTH, provider);
  }
  return out;
}

export async function loadStickers(c: Collage): Promise<Record<string, SkImage>> {
  const out: Record<string, SkImage> = {};
  await Promise.all(
    Object.values(c.stickers).map(async (s) => {
      const image = await loadImage(collageUri(c.id, s.file));
      if (image) out[s.id] = image;
    }),
  );
  return out;
}

/**
 * Fotos no tamanho em que aparecem na saída: a cópia da tela quando basta; a
 * foto inteira (reduzida pelo sistema ao tamanho certo) quando precisa de mais.
 * Uma por vez, para não juntar várias fotos grandes na memória.
 */
async function loadPhotosFor(c: Collage, scale: number): Promise<Record<string, SkImage>> {
  const { width: W, height: H } = collageDesignSize(c);
  const sides = photoDrawSides(c, W, H);
  const out: Record<string, SkImage> = {};
  for (const [id, side] of Object.entries(sides)) {
    const photo = c.photos[id];
    if (!photo) continue;
    const needed = Math.ceil(side * scale);
    const long = Math.max(photo.width, photo.height);
    const previewLong = Math.min(long, 1600);
    let uri = collageUri(c.id, photo.preview);
    let temp: File | null = null;
    if (needed > previewLong * 1.05) {
      uri = collageUri(c.id, photo.file);
      if (long > needed * 1.25) {
        const k = needed / long;
        const ctx = ImageManipulator.manipulate(uri);
        ctx.resize(photo.width >= photo.height ? { width: Math.round(photo.width * k) } : { height: Math.round(photo.height * k) });
        const saved = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
        uri = saved.uri;
        temp = new File(saved.uri);
      }
    }
    const image = await loadImage(uri);
    if (temp?.exists) temp.delete();
    if (image) out[id] = image;
  }
  return out;
}

function disposeAll(res: CollageResources) {
  for (const image of Object.values(res.photos)) image.dispose();
  for (const image of Object.values(res.stickers)) image.dispose();
}

/** Desenha a colagem com o lado menor `short` e devolve a imagem (quem chama libera). */
function render(c: Collage, res: CollageResources, short: CollageExportSize | number): SkImage {
  const design = collageDesignSize(c);
  const out = collageExportSize(c, short as CollageExportSize);
  const surface = Skia.Surface.MakeOffscreen(out.width, out.height);
  if (!surface) throw new Error('Não foi possível criar a imagem.');
  const canvas = surface.getCanvas();
  canvas.scale(out.width / design.width, out.height / design.height);
  drawCollage(canvas, c, res, design.width, design.height);
  surface.flush();
  const snapshot = surface.makeImageSnapshot();
  const image = snapshot.makeNonTextureImage() ?? snapshot;
  if (image !== snapshot) snapshot.dispose();
  surface.dispose();
  return image;
}

function fileName(name: string, ext: string): string {
  return `${name.replace(/[^\p{L}\p{N}_ -]/gu, '').trim() || 'colagem'}-${Date.now()}.${ext}`;
}

async function toGallery(uri: string): Promise<boolean> {
  try {
    const permission = await requestPermissionsAsync(true, ['photo']);
    if (!permission.granted) return false;
    await Asset.create(uri);
    return true;
  } catch {
    return false;
  }
}

export interface SavedImage {
  uri: string;
  width: number;
  height: number;
  savedToGallery: boolean;
}

/** Gera o JPEG final e salva na galeria. */
export async function exportCollage(c: Collage, provider: SkTypefaceFontProvider, short: CollageExportSize): Promise<SavedImage> {
  const scale = short / Math.min(collageDesignSize(c).width, collageDesignSize(c).height);
  const res: CollageResources = { photos: await loadPhotosFor(c, scale), stickers: await loadStickers(c), texts: buildCollageTexts(c, provider) };
  try {
    const image = render(c, res, short);
    const bytes = image.encodeToBytes(ImageFormat.JPEG, 95);
    const size = { width: image.width(), height: image.height() };
    image.dispose();
    ensureDir(exportsDir());
    const file = new File(exportsDir(), fileName(c.name, 'jpg'));
    file.create({ overwrite: true });
    file.write(bytes);
    return { uri: file.uri, ...size, savedToGallery: await toGallery(file.uri) };
  } finally {
    disposeAll(res);
  }
}

/** Capa da lista (`cover.jpg`, lado menor 480). */
export async function makeCollageCover(c: Collage, provider: SkTypefaceFontProvider | null): Promise<void> {
  try {
    const scale = 480 / Math.min(collageDesignSize(c).width, collageDesignSize(c).height);
    const res: CollageResources = {
      photos: await loadPhotosFor(c, scale),
      stickers: await loadStickers(c),
      texts: provider ? buildCollageTexts(c, provider) : {},
    };
    try {
      const image = render(c, res, 480);
      const bytes = image.encodeToBytes(ImageFormat.JPEG, 82);
      image.dispose();
      const file = new File(collageDir(c.id), 'cover.jpg');
      file.create({ overwrite: true });
      file.write(bytes);
      saveCollageSummary(c);
    } finally {
      disposeAll(res);
    }
  } catch {
    // Sem capa: a lista mostra um ícone.
  }
}

/**
 * A figurinha sozinha, com contorno e sombra, num PNG transparente (para usar
 * em outros apps). Salva na galeria.
 */
export async function exportSticker(c: Collage, layer: StickerLayer): Promise<SavedImage> {
  const sticker = c.stickers[layer.stickerId];
  if (!sticker) throw new Error('Figurinha não encontrada.');
  const image = await loadImage(collageUri(c.id, sticker.file));
  if (!image) throw new Error('Não foi possível abrir a figurinha.');
  try {
    const iw = image.width();
    const ih = image.height();
    const long = Math.max(iw, ih);
    // Folga para o contorno e a sombra não serem cortados.
    const pad = Math.ceil((layer.outline ? layer.outline.width * 0.05 * long : 0) + (layer.shadow ? long * 0.08 : 0) + 4);
    const surface = Skia.Surface.MakeOffscreen(iw + pad * 2, ih + pad * 2);
    if (!surface) throw new Error('Não foi possível criar a imagem.');
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    const paint = Skia.Paint();
    const filter = stickerFilter(layer, iw, ih);
    if (filter) paint.setImageFilter(filter);
    if (layer.flipH) {
      canvas.translate(iw + pad * 2, 0);
      canvas.scale(-1, 1);
    }
    canvas.drawImage(image, pad, pad, paint);
    surface.flush();
    const snapshot = surface.makeImageSnapshot();
    const bytes = snapshot.encodeToBytes(ImageFormat.PNG, 100);
    snapshot.dispose();
    surface.dispose();
    ensureDir(exportsDir());
    const file = new File(exportsDir(), fileName('figurinha', 'png'));
    file.create({ overwrite: true });
    file.write(bytes);
    return { uri: file.uri, width: iw + pad * 2, height: ih + pad * 2, savedToGallery: await toGallery(file.uri) };
  } finally {
    image.dispose();
  }
}
