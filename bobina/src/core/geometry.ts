import type { ExportResolution, MediaAsset, Project, Ratio } from './types';

/** O lado menor do espaço de desenho. Tudo é desenhado nesse espaço e escalado na saída. */
export const DESIGN_SHORT_SIDE = 1080;

export interface Size {
  width: number;
  height: number;
}

const RATIO_VALUES: Record<Exclude<Ratio, 'original'>, number> = {
  '9:16': 9 / 16,
  '16:9': 16 / 9,
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '4:5': 4 / 5,
};

export const RATIOS: Ratio[] = ['original', '9:16', '16:9', '1:1', '4:3', '3:4', '4:5'];

/** Largura e altura de uma mídia como ela aparece (com a rotação aplicada). */
export function displaySize(asset: Pick<MediaAsset, 'width' | 'height' | 'rotation'>): Size {
  const turned = asset.rotation === 90 || asset.rotation === 270;
  return turned
    ? { width: asset.height, height: asset.width }
    : { width: asset.width, height: asset.height };
}

/** Largura ÷ altura do projeto. "Original" segue o primeiro clipe da faixa principal. */
export function aspectOf(project: Project): number {
  if (project.ratio !== 'original') return RATIO_VALUES[project.ratio];
  const first = project.main[0];
  const asset = first ? project.assets[first.assetId] : undefined;
  if (asset && asset.width > 0 && asset.height > 0) {
    const size = displaySize(asset);
    const crop = first!.crop;
    const w = size.width * crop.w;
    const h = size.height * crop.h;
    if (w > 0 && h > 0) return w / h;
  }
  return 9 / 16;
}

/** Tamanho com o lado menor igual a `shortSide`, arredondado para números pares (exigência dos codificadores). */
export function sizeForAspect(aspect: number, shortSide: number): Size {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (aspect >= 1) return { width: even(shortSide * aspect), height: even(shortSide) };
  return { width: even(shortSide), height: even(shortSide / aspect) };
}

export function designSize(project: Project): Size {
  return sizeForAspect(aspectOf(project), DESIGN_SHORT_SIDE);
}

export function exportSize(project: Project, resolution: ExportResolution = project.exportSettings.resolution): Size {
  return sizeForAspect(aspectOf(project), resolution);
}

/** Maior retângulo com a proporção `aspect` que cabe em `box`. */
export function fitInside(aspect: number, box: Size): Size {
  if (box.width / box.height > aspect) {
    return { width: box.height * aspect, height: box.height };
  }
  return { width: box.width, height: box.width / aspect };
}

/** Taxa de bits do vídeo exportado: ~0,15 bit por pixel por quadro, entre 2 e 60 Mbps. */
export function exportBitRate(size: Size, fps: number): number {
  const bits = size.width * size.height * fps * 0.15;
  return Math.round(Math.min(60_000_000, Math.max(2_000_000, bits)));
}
