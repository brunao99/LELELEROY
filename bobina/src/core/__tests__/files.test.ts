import { audioRenderKey, bakeKey } from '../composition';
import { countUnavailable, reconcileFiles, unusedCaches, usedAssetIds } from '../files';
import { addAudio, addOverlay, setBackground, setFades, setSpeed } from '../ops';
import { sec } from '../time';
import type { Bake, Project } from '../types';
import { audioAsset, imageAsset, projectWith } from './fixtures';

function bake(project: Project, clipIndex: number, speed: number, files: { video?: string; audio?: string }): Bake {
  const clip = project.main[clipIndex]!;
  return {
    key: bakeKey(clip.assetId, speed, false),
    assetId: clip.assetId,
    speed,
    keepPitch: false,
    from: clip.sourceIn,
    to: clip.sourceOut,
    videoFile: files.video ?? null,
    audioFile: files.audio ?? null,
  };
}

describe('usedAssetIds', () => {
  it('junta clipes, sobreposições, áudios e a foto de fundo', () => {
    let p = projectWith(3);
    const music = audioAsset(10);
    const photo = imageAsset();
    const bg = imageAsset();
    p = addAudio(p, music, 0, 'import', 'Música').project;
    p = addOverlay(p, photo, 0).project;
    p = setBackground({ ...p, assets: { ...p.assets, [bg.id]: bg } }, { kind: 'image', assetId: bg.id });
    expect(usedAssetIds(p)).toEqual(new Set([p.main[0]!.assetId, music.id, photo.id, bg.id]));
  });
});

describe('reconcileFiles', () => {
  it('esquece cópias e áudios processados cujos arquivos sumiram', () => {
    let p = projectWith(4, 4);
    p = setSpeed(p, p.main[0]!.id, 2, false);
    p = setSpeed(p, p.main[1]!.id, 3, false);
    p = setFades(p, p.main[0]!.id, sec(1), 0);
    const kept = bake(p, 0, 2, { video: 'baked/a.mp4', audio: 'baked/a.wav' });
    const lost = bake(p, 1, 3, { video: 'baked/b.mp4' });
    const renderKey = audioRenderKey(p.main[0]!);
    p = {
      ...p,
      bakes: { [kept.key]: kept, [lost.key]: lost },
      audioRenders: { [renderKey]: { key: renderKey, file: 'rendered/x.wav' } },
    };
    const onDisk = new Set(['baked/a.mp4', 'baked/a.wav', ...Object.values(p.assets).map((a) => a.file)]);
    const { project, missingAssets } = reconcileFiles(p, (f) => onDisk.has(f));
    expect(Object.keys(project.bakes)).toEqual([kept.key]);
    expect(project.audioRenders).toEqual({});
    expect(missingAssets).toEqual([]);
  });

  it('lista as mídias originais que faltam', () => {
    const p = projectWith(3, 3);
    const gone = p.assets[p.main[1]!.assetId]!;
    const { project, missingAssets } = reconcileFiles(p, (f) => f !== gone.file);
    expect(missingAssets).toEqual([gone.id]);
    // Nada a esquecer: o projeto é o mesmo objeto.
    expect(project).toBe(p);
  });
});

describe('unusedCaches', () => {
  it('separa o que nenhum clipe usa e devolve os arquivos para apagar', () => {
    let p = projectWith(4);
    p = setSpeed(p, p.main[0]!.id, 2, false);
    const used = bake(p, 0, 2, { video: 'baked/used.mp4' });
    const old = { ...bake(p, 0, 4, { video: 'baked/old.mp4', audio: 'baked/old.wav' }) };
    p = {
      ...p,
      bakes: { [used.key]: used, [old.key]: old },
      audioRenders: { stale: { key: 'stale', file: 'rendered/stale.wav' } },
    };
    const { project, files } = unusedCaches(p);
    expect(Object.keys(project.bakes)).toEqual([used.key]);
    expect(project.audioRenders).toEqual({});
    expect(files.sort()).toEqual(['baked/old.mp4', 'baked/old.wav', 'rendered/stale.wav']);
  });

  it('mantém o áudio processado de um clipe com fade', () => {
    let p = projectWith(4);
    p = setFades(p, p.main[0]!.id, sec(1), sec(1));
    const key = audioRenderKey(p.main[0]!);
    p = { ...p, audioRenders: { [key]: { key, file: 'rendered/f.wav' } } };
    const result = unusedCaches(p);
    expect(result.files).toEqual([]);
    expect(result.project).toBe(p);
  });
});

describe('countUnavailable', () => {
  it('conta os itens que apontam para mídias que faltam', () => {
    let p = projectWith(3, 3);
    const music = audioAsset(10);
    p = addAudio(p, music, 0, 'import', 'Música').project;
    expect(countUnavailable(p, new Set())).toBe(0);
    expect(countUnavailable(p, new Set([p.main[0]!.assetId, music.id]))).toBe(2);
  });
});
