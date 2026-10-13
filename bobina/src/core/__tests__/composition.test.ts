import {
  bakeKey,
  buildComposition,
  compositionForWindow,
  compositionSignature,
  planWindows,
  windowAt,
  type Composition,
} from '../composition';
import { makeMainClip } from '../defaults';
import { addAudio, addText, insertMainClips, setMuteMain, setSpeed, setTransition, setVolume } from '../ops';
import { sec } from '../time';
import type { Project } from '../types';
import { audioAsset, imageAsset, projectWith, resolve, videoAsset } from './fixtures';

describe('buildComposition', () => {
  it('vira itens em segundos com caminhos absolutos e o som dos clipes', () => {
    const p = projectWith(3, 4);
    const { composition, missing } = buildComposition(p, { resolve });
    expect(missing).toEqual([]);
    expect(composition!.duration).toBe(7);
    expect(composition!.items).toEqual([
      expect.objectContaining({ id: p.main[0]!.id, path: '/data/p1/media/' + p.assets[p.main[0]!.assetId]!.file.split('/')[1], compositionStartTime: 0, startTime: 0, duration: 3, audio: { volume: 1 } }),
      expect.objectContaining({ id: p.main[1]!.id, compositionStartTime: 3, startTime: 0, duration: 4 }),
    ]);
  });

  it('projeto vazio não tem composição', () => {
    expect(buildComposition(projectWith(), { resolve }).composition).toBeNull();
  });

  it('respeita o mudo da faixa principal e o volume zero', () => {
    let p = projectWith(3, 4);
    p = setVolume(p, p.main[1]!.id, 0);
    let items = buildComposition(p, { resolve }).composition!.items;
    expect(items.map((i) => ('audio' in i ? i.audio : 'x'))).toEqual([{ volume: 1 }, false]);
    p = setMuteMain(p, true);
    items = buildComposition(p, { resolve }).composition!.items;
    expect(items.every((i) => 'audio' in i && i.audio === false)).toBe(true);
  });

  it('fotos e textos não viram itens', () => {
    const img = imageAsset();
    let p = projectWith(3);
    p = insertMainClips({ ...p, assets: { ...p.assets, [img.id]: img } }, [makeMainClip(img)], 1);
    p = addText(p, 0, 'oi').project;
    const c = buildComposition(p, { resolve }).composition!;
    expect(c.items).toHaveLength(1);
    expect(c.duration).toBe(6);
  });

  it('áudio solto vira item de áudio, cortado no fim do vídeo', () => {
    const music = audioAsset(60);
    const p = addAudio(projectWith(5), music, sec(1), 'import', 'Música').project;
    const items = buildComposition(p, { resolve }).composition!.items;
    expect(items[1]).toEqual({
      kind: 'audio',
      id: p.audios[0]!.id,
      path: `/data/p1/${music.file}`,
      compositionStartTime: 1,
      startTime: 0,
      duration: 4,
      volume: 1,
    });
  });

  it('respeita as transições (os itens se sobrepõem)', () => {
    let p = projectWith(3, 3);
    p = setTransition(p, p.main[0]!.id, { kind: 'dissolve', duration: sec(1) });
    const items = buildComposition(p, { resolve }).composition!.items;
    expect(items[1]!.compositionStartTime).toBe(2);
  });

  it('reduz a resolução no preview', () => {
    const items = buildComposition(projectWith(3), { resolve, previewMaxSide: 960 }).composition!.items;
    expect(items[0]).toMatchObject({ resolution: { width: 960, height: 540 } });
  });

  describe('velocidade', () => {
    const fast = (): Project => {
      const p = projectWith(10);
      return setSpeed(p, p.main[0]!.id, 2, true);
    };

    it('sem cópia pronta: pede a cópia, mostra a 1x e fica mudo', () => {
      const p = fast();
      const { composition, missing } = buildComposition(p, { resolve });
      expect(missing).toEqual([
        expect.objectContaining({ speed: 2, keepPitch: true, from: 0, to: sec(10), needsVideo: true, needsAudio: true }),
      ]);
      expect(composition!.items).toEqual([expect.objectContaining({ duration: 5, audio: false })]);
    });

    it('com a cópia: usa os arquivos acelerados e o tempo dividido pela velocidade', () => {
      let p = fast();
      p = { ...p, main: [{ ...p.main[0]!, sourceIn: sec(4) }] };
      const assetId = p.main[0]!.assetId;
      const key = bakeKey(assetId, 2, true);
      p = {
        ...p,
        bakes: {
          [key]: { key, assetId, speed: 2, keepPitch: true, from: sec(2), to: sec(10), videoFile: 'baked/v.mp4', audioFile: 'baked/v.wav' },
        },
      };
      const { composition, missing } = buildComposition(p, { resolve });
      expect(missing).toEqual([]);
      expect(composition!.items).toEqual([
        expect.objectContaining({ path: '/data/p1/baked/v.mp4', startTime: 1, duration: 3, audio: false }),
        expect.objectContaining({ kind: 'audio', path: '/data/p1/baked/v.wav', startTime: 1, duration: 3 }),
      ]);
    });

    it('cópia que não cobre o trecho não serve', () => {
      let p = fast();
      const assetId = p.main[0]!.assetId;
      const key = bakeKey(assetId, 2, true);
      p = { ...p, bakes: { [key]: { key, assetId, speed: 2, keepPitch: true, from: sec(1), to: sec(10), videoFile: 'b.mp4', audioFile: 'b.wav' } } };
      expect(buildComposition(p, { resolve }).missing).toHaveLength(1);
    });

    it('junta pedidos da mesma mídia e velocidade num trecho só', () => {
      const v = videoAsset(20);
      let p = projectWith();
      const a = { ...makeMainClip(v), sourceIn: sec(2), sourceOut: sec(5), speed: 2 };
      const b = { ...makeMainClip(v), sourceIn: sec(10), sourceOut: sec(12), speed: 2 };
      p = insertMainClips({ ...p, assets: { [v.id]: v } }, [a, b], 0);
      const { missing } = buildComposition(p, { resolve });
      expect(missing).toEqual([expect.objectContaining({ from: sec(2), to: sec(12) })]);
    });
  });
});

describe('janelas de decodificação', () => {
  const comp = (count: number): Composition => ({
    duration: count,
    items: Array.from({ length: count }, (_, i) => ({ id: `c${i}`, path: 'x', compositionStartTime: i, startTime: 0, duration: 1 })),
  });

  it('projeto pequeno: uma janela só', () => {
    expect(planWindows(comp(4), 6)).toEqual([{ start: 0, end: 4 }]);
  });

  it('projeto grande: janelas com no máximo N vídeos', () => {
    const c = comp(14);
    const windows = planWindows(c, 6);
    expect(windows[0]).toEqual({ start: 0, end: 6 });
    expect(windows[windows.length - 1]!.end).toBe(14);
    for (const w of windows) {
      expect(compositionForWindow(c, w).items.length).toBeLessThanOrEqual(6);
    }
    // Cobrem a timeline sem buracos.
    for (let i = 1; i < windows.length; i++) expect(windows[i]!.start).toBe(windows[i - 1]!.end);
  });

  it('acha a janela de um instante', () => {
    const windows = planWindows(comp(14), 6);
    expect(windowAt(windows, 0)).toBe(windows[0]);
    expect(windowAt(windows, 6.5)).toBe(windows[1]);
    expect(windowAt(windows, 999)).toBe(windows[windows.length - 1]);
  });

  it('assinatura muda com a mídia, não com a ordem dos textos', () => {
    const p = projectWith(3, 4);
    const a = buildComposition(p, { resolve }).composition;
    const b = buildComposition(addText(p, 0, 'oi').project, { resolve }).composition;
    expect(compositionSignature(a)).toBe(compositionSignature(b));
    const c = buildComposition(setVolume(p, p.main[0]!.id, 0.5), { resolve }).composition;
    expect(compositionSignature(c)).not.toBe(compositionSignature(a));
  });
});
