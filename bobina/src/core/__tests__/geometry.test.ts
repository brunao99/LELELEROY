import { exportBitRate, sourceShortSide } from '../geometry';
import { addOverlay } from '../ops';
import { createProject } from '../defaults';
import { imageAsset, projectWith, videoAsset } from './fixtures';

describe('sourceShortSide', () => {
  it('é o lado menor do maior vídeo, contando a rotação', () => {
    let p = projectWith(3);
    const fourK = videoAsset(2, { width: 3840, height: 2160, rotation: 90 });
    p = addOverlay(p, fourK, 0).project;
    expect(sourceShortSide(p)).toBe(2160);
  });

  it('ignora fotos e projetos sem vídeo', () => {
    const p = createProject({ id: 'x', name: 'x', now: 0, assets: [imageAsset({ width: 4000, height: 3000 })] });
    expect(sourceShortSide(p)).toBe(0);
  });
});

describe('exportBitRate', () => {
  it('4K a 30 qps fica perto de 37 Mbps e nunca passa de 60', () => {
    expect(exportBitRate({ width: 2160, height: 3840 }, 30)).toBe(37_324_800);
    expect(exportBitRate({ width: 2160, height: 3840 }, 60)).toBe(60_000_000);
  });
});
