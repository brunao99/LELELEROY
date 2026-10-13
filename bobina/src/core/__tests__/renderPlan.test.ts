import { makeMainClip } from '../defaults';
import { designSize, exportSize, sizeForAspect } from '../geometry';
import { addText, insertMainClips, setCaptions, setRatio, setTransition, updateVisual } from '../ops';
import { activeMainAt, buildRenderPlan, captionAt, clipBox, rotatedSize } from '../renderPlan';
import { sec } from '../time';
import { imageAsset, projectWith, videoAsset } from './fixtures';

describe('tamanhos', () => {
  it('lado menor 1080, pares', () => {
    expect(sizeForAspect(9 / 16, 1080)).toEqual({ width: 1080, height: 1920 });
    expect(sizeForAspect(16 / 9, 720)).toEqual({ width: 1280, height: 720 });
    expect(sizeForAspect(4 / 5, 1080)).toEqual({ width: 1080, height: 1350 });
  });

  it('"original" segue o primeiro clipe, com a rotação', () => {
    const v = videoAsset(3, { width: 1920, height: 1080, rotation: 90 });
    const base = projectWith();
    const p = insertMainClips({ ...base, assets: { [v.id]: v } }, [makeMainClip(v)], 0);
    expect(designSize(p)).toEqual({ width: 1080, height: 1920 });
    expect(exportSize(setRatio(p, '1:1'), 720)).toEqual({ width: 720, height: 720 });
  });
});

describe('buildRenderPlan', () => {
  it('descreve os clipes, transições, textos e legendas', () => {
    let p = projectWith(3, 3);
    p = setTransition(p, p.main[0]!.id, { kind: 'circle', duration: sec(1) });
    p = updateVisual(p, p.main[0]!.id, { filter: { id: 'pb', intensity: 1 } });
    p = addText(p, sec(1), 'Olá').project;
    p = setCaptions(p, [{ id: 's', start: 0, end: sec(1), text: 'oi' }], 'pt', 'video');
    const plan = buildRenderPlan(p);
    expect(plan.duration).toBe(sec(5));
    expect(plan.main[0]!.transitionOut).toEqual({ kind: 'circle', start: sec(2), end: sec(3) });
    expect(plan.main[1]!.transitionIn).toEqual({ kind: 'circle', start: sec(2), end: sec(3) });
    expect(plan.main[0]!.clip.colorMatrix).not.toBeNull();
    expect(plan.main[1]!.clip.colorMatrix).toBeNull();
    expect(plan.texts[0]).toMatchObject({ text: 'Olá', start: sec(1), end: sec(4) });
    expect(plan.captions.items[0]!.text).toBe('oi');
  });

  it('a versão do texto muda quando o estilo muda', () => {
    const a = addText(projectWith(3), 0, 'x');
    const v1 = buildRenderPlan(a.project).texts[0]!.version;
    const p2 = { ...a.project, texts: a.project.texts.map((t) => ({ ...t, style: { ...t.style, color: '#ff0000' } })) };
    expect(buildRenderPlan(p2).texts[0]!.version).not.toBe(v1);
  });

  it('fotos aparecem como imagem', () => {
    const img = imageAsset();
    const base = projectWith();
    const p = insertMainClips({ ...base, assets: { [img.id]: img } }, [makeMainClip(img)], 0);
    expect(buildRenderPlan(p).main[0]!.clip.source).toBe('image');
  });
});

describe('por quadro', () => {
  let p = projectWith(3, 3);
  p = setTransition(p, p.main[0]!.id, { kind: 'dissolve', duration: sec(1) });
  const plan = buildRenderPlan(p);

  it('um clipe fora da transição', () => {
    const a = activeMainAt(plan.main, sec(1));
    expect(a.primary?.clip.id).toBe(p.main[0]!.id);
    expect(a.outgoing).toBeNull();
  });

  it('dois clipes na transição, com o progresso', () => {
    const a = activeMainAt(plan.main, sec(2.25));
    expect(a.primary?.clip.id).toBe(p.main[1]!.id);
    expect(a.outgoing?.clip.id).toBe(p.main[0]!.id);
    expect(a.progress).toBeCloseTo(0.25);
  });

  it('nada depois do fim', () => {
    expect(activeMainAt(plan.main, sec(5)).primary).toBeNull();
    expect(activeMainAt([], 0).primary).toBeNull();
  });

  it('acha a legenda certa', () => {
    const items = [
      { id: 'a', start: 0, end: sec(1), text: 'a', version: '' },
      { id: 'b', start: sec(2), end: sec(3), text: 'b', version: '' },
    ];
    expect(captionAt(items, sec(0.5))?.id).toBe('a');
    expect(captionAt(items, sec(1.5))).toBeNull();
    expect(captionAt(items, sec(2))?.id).toBe('b');
    expect(captionAt(items, sec(3))).toBeNull();
  });

  it('encaixa o clipe no quadro ("ajustar")', () => {
    // Vídeo deitado num quadro em pé: largura cheia.
    const box = clipBox(1080, 1920, 1920, 1080, { x: 0, y: 0, scale: 1, rotation: 0 });
    expect(box).toEqual({ cx: 540, cy: 960, width: 1080, height: 607.5, rotation: 0 });
    const moved = clipBox(1080, 1920, 1080, 1920, { x: 0.25, y: -0.1, scale: 0.5, rotation: 30 });
    expect(moved).toEqual({ cx: 810, cy: 768, width: 540, height: 960, rotation: 30 });
  });

  it('troca largura e altura com rotação de 90°', () => {
    expect(rotatedSize(1920, 1080, 90)).toEqual({ width: 1080, height: 1920 });
    expect(rotatedSize(1920, 1080, -90)).toEqual({ width: 1080, height: 1920 });
    expect(rotatedSize(1920, 1080, 180)).toEqual({ width: 1920, height: 1080 });
  });
});
