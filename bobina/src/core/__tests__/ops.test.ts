import { makeMainClip } from '../defaults';
import {
  addAudio,
  addOverlay,
  addText,
  duplicateItem,
  extractAudio,
  findItem,
  insertFreezeFrame,
  insertMainClips,
  mergeCaptionWithNext,
  moveItem,
  moveMainClip,
  removeItem,
  replaceMedia,
  rotate90,
  setCaptions,
  setFades,
  setReverse,
  setSpeed,
  setTransition,
  setTransitionAll,
  setVolume,
  splitCaptionAtChar,
  splitItem,
  trimItem,
  updateCaptionText,
  updateVisualAll,
} from '../ops';
import { MAX_IMAGE_DURATION, sec } from '../time';
import { clipDuration, itemEnd, layoutMain, mainDuration } from '../timeline';
import type { AudioClip, MainClip, OverlayClip, Project, TextItem } from '../types';
import { audioAsset, imageAsset, projectWith, videoAsset } from './fixtures';

const mainIds = (p: Project) => p.main.map((c) => c.id);

describe('cortar', () => {
  it('corta o começo e o fim dentro da mídia', () => {
    let p = projectWith(10);
    const id = p.main[0]!.id;
    p = trimItem(p, id, 'start', sec(2));
    p = trimItem(p, id, 'end', -sec(3));
    expect(p.main[0]).toMatchObject({ sourceIn: sec(2), sourceOut: sec(7) });
  });

  it('não passa do começo nem do fim da mídia', () => {
    let p = projectWith(10);
    const id = p.main[0]!.id;
    p = trimItem(p, id, 'start', -sec(5));
    p = trimItem(p, id, 'end', sec(5));
    expect(p.main[0]).toMatchObject({ sourceIn: 0, sourceOut: sec(10) });
  });

  it('mantém pelo menos 0,1 s', () => {
    let p = projectWith(10);
    const id = p.main[0]!.id;
    p = trimItem(p, id, 'end', -sec(20));
    expect(clipDuration(p.main[0]!)).toBe(sec(0.1));
  });

  it('respeita a velocidade: cortar 1 s na timeline a 2x tira 2 s da mídia', () => {
    let p = projectWith(10);
    const id = p.main[0]!.id;
    p = setSpeed(p, id, 2, true);
    p = trimItem(p, id, 'start', sec(1));
    expect(p.main[0]!.sourceIn).toBe(sec(2));
  });

  it('foto pode crescer além da duração inicial', () => {
    const p0 = projectWith();
    const img = imageAsset();
    let p = insertMainClips({ ...p0, assets: { [img.id]: img } }, [makeMainClip(img)], 0);
    const id = p.main[0]!.id;
    p = trimItem(p, id, 'end', sec(7));
    expect(clipDuration(p.main[0]!)).toBe(sec(10));
    p = trimItem(p, id, 'end', sec(10_000));
    expect(clipDuration(p.main[0]!)).toBe(MAX_IMAGE_DURATION);
    p = trimItem(p, id, 'start', sec(1));
    expect(p.main[0]!.sourceIn).toBe(0);
  });

  it('item solto cortado no começo mantém o fim parado', () => {
    const music = audioAsset(30);
    let { project: p, id } = addAudio(projectWith(10), music, sec(2), 'import', 'Música');
    p = trimItem(p, id, 'start', sec(3));
    const clip = findItem(p, id)!.item as AudioClip;
    expect(clip.start).toBe(sec(5));
    expect(itemEnd(clip)).toBe(sec(32));
  });

  it('item solto não invade o vizinho da mesma camada', () => {
    const music = audioAsset(30);
    let p = projectWith(10);
    const a = addAudio(p, music, 0, 'import', 'A');
    p = a.project;
    p = trimItem(p, a.id, 'end', -sec(25)); // A: 0..5
    const b = addAudio(p, music, sec(6), 'import', 'B');
    p = b.project;
    expect((findItem(p, b.id)!.item as AudioClip).layer).toBe(0);
    p = trimItem(p, a.id, 'end', sec(10));
    expect(itemEnd(findItem(p, a.id)!.item as AudioClip)).toBe(sec(6));
  });

  it('texto: corta as duas pontas', () => {
    let { project: p, id } = addText(projectWith(10), sec(1), 'Oi');
    p = trimItem(p, id, 'start', sec(0.5));
    p = trimItem(p, id, 'end', sec(2));
    expect(findItem(p, id)!.item).toMatchObject({ start: sec(1.5), duration: sec(4.5) });
  });
});

describe('dividir', () => {
  it('divide o clipe principal na agulha', () => {
    const p = projectWith(10);
    const result = splitItem(p, p.main[0]!.id, sec(4))!;
    expect(result.project.main).toHaveLength(2);
    expect(result.project.main[0]).toMatchObject({ sourceIn: 0, sourceOut: sec(4) });
    expect(result.project.main[1]).toMatchObject({ sourceIn: sec(4), sourceOut: sec(10), id: result.id });
    expect(mainDuration(result.project)).toBe(sec(10));
  });

  it('não divide colado na ponta', () => {
    const p = projectWith(10);
    expect(splitItem(p, p.main[0]!.id, sec(0.05))).toBeNull();
    expect(splitItem(p, p.main[0]!.id, sec(9.95))).toBeNull();
  });

  it('divide respeitando a velocidade', () => {
    let p = projectWith(10);
    p = setSpeed(p, p.main[0]!.id, 2, false);
    const r = splitItem(p, p.main[0]!.id, sec(1))!;
    expect(r.project.main[0]!.sourceOut).toBe(sec(2));
  });

  it('a transição de saída fica com a segunda parte', () => {
    let p = projectWith(10, 5);
    p = setTransition(p, p.main[0]!.id, { kind: 'dissolve', duration: sec(1) });
    const r = splitItem(p, p.main[0]!.id, sec(3))!;
    expect(r.project.main[0]!.transitionOut).toBeNull();
    expect(r.project.main[1]!.transitionOut?.kind).toBe('dissolve');
  });

  it('divide foto, texto e legenda', () => {
    const img = imageAsset();
    const overlay = addOverlay(projectWith(10), img, sec(1));
    const r1 = splitItem(overlay.project, overlay.id, sec(2))!;
    const parts = r1.project.overlays.map((o) => [o.start, clipDuration(o)]);
    expect(parts).toEqual([
      [sec(1), sec(1)],
      [sec(2), sec(2)],
    ]);

    const text = addText(projectWith(10), 0, 'Olá mundo');
    const r2 = splitItem(text.project, text.id, sec(1))!;
    expect(r2.project.texts.map((t) => [t.start, t.duration])).toEqual([
      [0, sec(1)],
      [sec(1), sec(2)],
    ]);

    const withCaptions = setCaptions(projectWith(10), [{ id: 's1', start: 0, end: sec(2), text: 'um dois três quatro' }], 'pt', 'video');
    const r3 = splitItem(withCaptions, 's1', sec(1))!;
    expect(r3.project.captions.items.map((c) => c.text)).toEqual(['um dois', 'três quatro']);
  });
});

describe('excluir e reordenar', () => {
  it('exclui e fecha o espaço', () => {
    const p = projectWith(3, 4, 5);
    const next = removeItem(p, p.main[1]!.id);
    expect(layoutMain(next).map((s) => s.start)).toEqual([0, sec(3)]);
  });

  it('tira a transição do último clipe que sobra', () => {
    let p = projectWith(3, 4);
    p = setTransition(p, p.main[0]!.id, { kind: 'dissolve', duration: sec(1) });
    p = removeItem(p, p.main[1]!.id);
    expect(p.main[0]!.transitionOut).toBeNull();
  });

  it('reordena', () => {
    const p = projectWith(1, 2, 3);
    const [a, b, c] = mainIds(p);
    expect(mainIds(moveMainClip(p, c!, 0))).toEqual([c, a, b]);
    expect(mainIds(moveMainClip(p, a!, 5))).toEqual([b, c, a]);
  });

  it('marca as legendas como possivelmente fora de sincronia', () => {
    let p = setCaptions(projectWith(3, 4), [{ id: 's', start: 0, end: sec(1), text: 'oi' }], 'pt', 'video');
    expect(p.captions.maybeOutOfSync).toBe(false);
    p = removeItem(p, p.main[0]!.id);
    expect(p.captions.maybeOutOfSync).toBe(true);
  });
});

describe('mover itens soltos', () => {
  it('vai para outra camada se a pedida estiver ocupada', () => {
    let p = projectWith(10);
    const a = addText(p, 0, 'A');
    p = a.project;
    const b = addText(p, sec(5), 'B');
    p = b.project;
    p = moveItem(p, b.id, sec(1), 0);
    const moved = findItem(p, b.id)!.item as TextItem;
    expect(moved.start).toBe(sec(1));
    expect(moved.layer).toBe(1);
  });

  it('legenda não passa por cima das vizinhas', () => {
    let p = setCaptions(
      projectWith(10),
      [
        { id: 'a', start: 0, end: sec(1), text: 'a' },
        { id: 'b', start: sec(2), end: sec(3), text: 'b' },
        { id: 'c', start: sec(4), end: sec(5), text: 'c' },
      ],
      'pt',
      'video',
    );
    p = moveItem(p, 'b', sec(3.5));
    expect(findItem(p, 'b')!.item).toMatchObject({ start: sec(3), end: sec(4) });
    p = moveItem(p, 'b', 0);
    expect(findItem(p, 'b')!.item).toMatchObject({ start: sec(1), end: sec(2) });
  });
});

describe('duplicar', () => {
  it('duplica clipe principal logo depois', () => {
    const p = projectWith(3, 4);
    const r = duplicateItem(p, p.main[0]!.id)!;
    expect(r.project.main).toHaveLength(3);
    expect(r.project.main[1]!.id).toBe(r.id);
    expect(r.project.main[1]!.sourceOut).toBe(sec(3));
  });

  it('duplica texto logo depois, na mesma camada', () => {
    const t = addText(projectWith(10), 0, 'Oi');
    const r = duplicateItem(t.project, t.id)!;
    expect(findItem(r.project, r.id)!.item).toMatchObject({ start: sec(3), layer: 0 });
  });
});

describe('velocidade, volume e áudio', () => {
  it('limita a velocidade a 0,1x–100x', () => {
    let p = projectWith(10);
    p = setSpeed(p, p.main[0]!.id, 500, true);
    expect(p.main[0]!.speed).toBe(100);
    p = setSpeed(p, p.main[0]!.id, 0.01, true);
    expect(p.main[0]!.speed).toBe(0.1);
  });

  it('ignora velocidade em foto', () => {
    const img = imageAsset();
    const o = addOverlay(projectWith(10), img, 0);
    expect(setSpeed(o.project, o.id, 2, true)).toBe(o.project);
  });

  it('item solto que cresceu com a velocidade troca de camada', () => {
    let p = projectWith(10);
    const music = audioAsset(4);
    const a = addAudio(p, music, 0, 'import', 'A');
    p = a.project;
    const b = addAudio(p, music, sec(5), 'import', 'B');
    p = b.project;
    p = setSpeed(p, a.id, 0.5, true); // A passa a durar 8 s e encostaria em B
    expect((findItem(p, a.id)!.item as AudioClip).layer).toBe(1);
  });

  it('limita volume e fades', () => {
    let p = projectWith(4);
    const id = p.main[0]!.id;
    p = setVolume(p, id, 3);
    expect(p.main[0]!.volume).toBe(2);
    p = setFades(p, id, sec(5), sec(1));
    expect(p.main[0]).toMatchObject({ fadeIn: sec(2), fadeOut: sec(1) });
  });

  it('extrai o áudio: clipe mudo e som na faixa de áudio na mesma posição', () => {
    let p = projectWith(3, 5);
    const r = extractAudio(p, p.main[1]!.id)!;
    p = r.project;
    expect(p.main[1]!.volume).toBe(0);
    const audio = findItem(p, r.id)!.item as AudioClip;
    expect(audio).toMatchObject({ start: sec(3), sourceIn: 0, sourceOut: sec(5), source: 'extract' });
  });

  it('não extrai de vídeo sem som', () => {
    const silent = videoAsset(5, { hasAudio: false });
    const base = projectWith();
    const p = insertMainClips({ ...base, assets: { [silent.id]: silent } }, [makeMainClip(silent)], 0);
    expect(extractAudio(p, p.main[0]!.id)).toBeNull();
  });
});

describe('visual e transições', () => {
  it('gira de 90 em 90', () => {
    let p = projectWith(3);
    const id = p.main[0]!.id;
    for (let i = 0; i < 4; i++) p = rotate90(p, id);
    expect(p.main[0]!.transform.rotation).toBe(0);
    p = rotate90(p, id);
    expect(p.main[0]!.transform.rotation).toBe(90);
  });

  it('aplica a todos', () => {
    const p = updateVisualAll(projectWith(1, 2, 3), { filter: { id: 'vivo', intensity: 0.8 } });
    expect(p.main.every((c) => c.filter?.id === 'vivo')).toBe(true);
  });

  it('transição em todos os cortes, menos no último clipe', () => {
    const p = setTransitionAll(projectWith(1, 2, 3), { kind: 'fadeBlack', duration: sec(0.5) });
    expect(p.main.map((c) => c.transitionOut?.kind ?? null)).toEqual(['fadeBlack', 'fadeBlack', null]);
  });

  it('não põe transição no último clipe', () => {
    const p = projectWith(1, 2);
    expect(setTransition(p, p.main[1]!.id, { kind: 'dissolve', duration: sec(0.5) })).toBe(p);
  });
});

describe('substituir mídia', () => {
  it('mantém a duração quando a nova mídia é longa', () => {
    let p = projectWith(10);
    const id = p.main[0]!.id;
    p = trimItem(p, id, 'end', -sec(6)); // 4 s
    const other = videoAsset(20);
    p = replaceMedia(p, id, other);
    expect(p.main[0]).toMatchObject({ assetId: other.id, sourceIn: 0, sourceOut: sec(4) });
  });

  it('encurta quando a nova mídia é curta', () => {
    const p0 = projectWith(10);
    const other = videoAsset(2);
    const p = replaceMedia(p0, p0.main[0]!.id, other);
    expect(clipDuration(p.main[0] as MainClip)).toBe(sec(2));
  });
});

describe('de trás para frente', () => {
  const reversed = () => {
    const p = projectWith(10);
    return setReverse(p, p.main[0]!.id, true);
  };

  it('cortar o começo tira do fim do trecho original', () => {
    const base = reversed();
    const id = base.main[0]!.id;
    const p = trimItem(base, id, 'start', sec(2));
    expect(findItem(p, id)!.item).toMatchObject({ sourceIn: 0, sourceOut: sec(8) });
    const q = trimItem(p, id, 'end', -sec(3));
    expect(findItem(q, id)!.item).toMatchObject({ sourceIn: sec(3), sourceOut: sec(8) });
  });

  it('dividir: a primeira parte é o fim do trecho original', () => {
    const p = reversed();
    const r = splitItem(p, p.main[0]!.id, sec(3))!;
    const [a, b] = r.project.main;
    expect(a).toMatchObject({ sourceIn: sec(7), sourceOut: sec(10), reverse: true });
    expect(b).toMatchObject({ sourceIn: 0, sourceOut: sec(7), reverse: true });
  });

  it('desinverter volta ao normal e o áudio extraído acompanha', () => {
    const p = reversed();
    const id = p.main[0]!.id;
    expect(setReverse(p, id, false).main[0]!.reverse).toBeUndefined();
    const ex = extractAudio(p, id)!;
    expect(findItem(ex.project, ex.id)!.item).toMatchObject({ reverse: true });
  });
});

describe('congelar quadro', () => {
  it('divide o clipe e põe a foto do quadro no meio, com o mesmo enquadramento', () => {
    let p = projectWith(10);
    const id = p.main[0]!.id;
    p = { ...p, main: [{ ...p.main[0]!, transform: { x: 0.1, y: 0, scale: 1.2, rotation: 0 } }] };
    const frame = imageAsset();
    const r = insertFreezeFrame(p, id, sec(4), frame)!;
    const [a, f, b] = r.project.main;
    expect(r.project.main).toHaveLength(3);
    expect(f).toMatchObject({ id: r.id, assetId: frame.id, sourceIn: 0, sourceOut: sec(3), transform: { x: 0.1, scale: 1.2 } });
    expect(a).toMatchObject({ sourceIn: 0, sourceOut: sec(4) });
    expect(b).toMatchObject({ sourceIn: sec(4), sourceOut: sec(10) });
    expect(r.project.assets[frame.id]).toBe(frame);
    expect(mainDuration(r.project)).toBe(sec(13));
  });

  it('perto das pontas, entra antes ou depois sem dividir', () => {
    const p = projectWith(10);
    const id = p.main[0]!.id;
    const before = insertFreezeFrame(p, id, sec(0.02), imageAsset())!;
    expect(before.project.main.map((c) => c.id)).toEqual([before.id, id]);
    const after = insertFreezeFrame(p, id, sec(9.98), imageAsset())!;
    expect(after.project.main.map((c) => c.id)).toEqual([id, after.id]);
  });
});

describe('legendas', () => {
  const base = () =>
    setCaptions(
      projectWith(10),
      [
        { id: 'b', start: sec(2), end: sec(4), text: 'segunda' },
        { id: 'a', start: 0, end: sec(2), text: 'primeira frase' },
      ],
      'pt',
      'video',
    );

  it('ordena por tempo', () => {
    expect(base().captions.items.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('divide no cursor e junta de volta', () => {
    const r = splitCaptionAtChar(base(), 'a', 'primeira'.length)!;
    expect(r.project.captions.items.map((c) => c.text)).toEqual(['primeira', 'frase', 'segunda']);
    const merged = mergeCaptionWithNext(r.project, r.project.captions.items[0]!.id);
    expect(merged.captions.items.map((c) => c.text)).toEqual(['primeira frase', 'segunda']);
  });

  describe('com o tempo de cada palavra', () => {
    const words = () =>
      setCaptions(
        projectWith(10),
        [
          {
            id: 'w',
            start: sec(1),
            end: sec(3),
            text: 'oi tudo bem',
            words: [
              { text: 'oi', start: sec(1), end: sec(1.3) },
              { text: 'tudo', start: sec(1.6), end: sec(2) },
              { text: 'bem', start: sec(2.2), end: sec(2.6) },
            ],
          },
        ],
        'pt',
        'video',
      );

    it('divide no texto exatamente onde a palavra começa', () => {
      const r = splitCaptionAtChar(words(), 'w', 'oi'.length)!;
      const [a, b] = r.project.captions.items;
      expect(a).toMatchObject({ text: 'oi', end: sec(1.6) });
      expect(b).toMatchObject({ text: 'tudo bem', start: sec(1.6) });
      expect(b!.words!.map((w) => w.text)).toEqual(['tudo', 'bem']);
    });

    it('divide no cursor da timeline entre as palavras certas', () => {
      const r = splitItem(words(), 'w', sec(2.1))!;
      expect(r.project.captions.items.map((c) => c.text)).toEqual(['oi tudo', 'bem']);
      expect(r.project.captions.items[1]!.words!.map((w) => w.text)).toEqual(['bem']);
    });

    it('juntar mantém as palavras; mover leva as palavras junto', () => {
      const r = splitCaptionAtChar(words(), 'w', 'oi'.length)!;
      const merged = mergeCaptionWithNext(r.project, r.project.captions.items[0]!.id);
      expect(merged.captions.items[0]!.words!.map((w) => w.text)).toEqual(['oi', 'tudo', 'bem']);
      const moved = moveItem(words(), 'w', sec(5));
      expect(moved.captions.items[0]!.words![0]!.start).toBe(sec(5));
    });

    it('corrigir uma palavra mantém os tempos; reescrever a frase descarta', () => {
      const fixed = updateCaptionText(words(), 'w', 'oi tudo bom');
      expect(fixed.captions.items[0]!.words!.map((w) => w.text)).toEqual(['oi', 'tudo', 'bom']);
      const rewritten = updateCaptionText(words(), 'w', 'olá a todos vocês');
      expect(rewritten.captions.items[0]!.words).toBeUndefined();
    });
  });
});

describe('sobreposição', () => {
  it('nasce com metade do tamanho e na primeira camada livre', () => {
    let p = projectWith(10);
    const a = addOverlay(p, videoAsset(5), 0);
    p = a.project;
    const b = addOverlay(p, videoAsset(5), sec(1));
    const clip = findItem(b.project, b.id)!.item as OverlayClip;
    expect(clip.transform.scale).toBe(0.5);
    expect(clip.layer).toBe(1);
  });
});
