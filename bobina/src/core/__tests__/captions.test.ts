import {
  CAPTION_MAX_CHARS,
  CAPTION_SAMPLE_RATE,
  captionParts,
  cleanSegmentText,
  mixCaptionAudio,
  packSpeech,
  segmentsToCaptions,
  segmentsToWords,
  unpackSegments,
  unpackTime,
  vadToSpeech,
  type WhisperSegment,
  type WhisperToken,
} from '../captions';
import { addAudio, setSpeed } from '../ops';
import { sec } from '../time';
import { audioAsset, projectWith } from './fixtures';

/**
 * Monta um segmento como o Whisper devolve: cada item é um token com tempo em
 * centésimos. Texto começando com espaço abre palavra; sem espaço, continua a anterior.
 */
function seg(tokens: [string, number, number, number?][]): WhisperSegment {
  const list: WhisperToken[] = tokens.map(([text, t0, t1, p]) => ({ text, t0, t1, p: p ?? 0.9 }));
  return { text: list.map((t) => t.text).join(''), t0: list[0]!.t0, t1: list[list.length - 1]!.t1, tokens: list };
}

/** Frase em tokens de uma palavra cada, com `step` centésimos por palavra a partir de `t0`. */
function sentence(text: string, t0: number, step = 30, p = 0.9): WhisperSegment {
  return seg(text.split(' ').map((w, i) => [` ${w}`, t0 + i * step, t0 + (i + 1) * step - 2, p]));
}

describe('legendas automáticas', () => {
  it('junta os pedaços de uma palavra e cola a pontuação', () => {
    const words = segmentsToWords([
      seg([
        [' A', 0, 20],
        [' trans', 20, 40],
        ['cr', 40, 50],
        ['ição', 50, 70],
        [' ficou', 70, 90],
        [' ótima', 90, 110],
        ['!', 110, 112],
      ]),
    ]);
    expect(words.map((w) => w.text)).toEqual(['A', 'transcrição', 'ficou', 'ótima!']);
    expect(words[1]).toMatchObject({ start: sec(0.2), end: sec(0.7) });
  });

  it('nunca corta uma palavra e respeita o tamanho máximo', () => {
    const text =
      'Hoje eu vou mostrar como editar um vídeo inteiro pelo celular usando só ferramentas gratuitas e sem complicação nenhuma';
    const caps = segmentsToCaptions([sentence(text, 0, 25)], sec(60));
    const original = text.split(' ');
    expect(caps.flatMap((c) => c.text.split(' '))).toEqual(original);
    for (const c of caps) expect(c.text.length).toBeLessThanOrEqual(CAPTION_MAX_CHARS);
    expect(caps.length).toBeGreaterThan(1);
  });

  it('quebra nas pausas e no fim das frases', () => {
    const caps = segmentsToCaptions(
      [sentence('Oi gente, tudo bem? Hoje tem novidade.', 0, 30), sentence('Bora começar', 400, 30)],
      sec(10),
    );
    expect(caps.map((c) => c.text)).toEqual(['Oi gente, tudo bem?', 'Hoje tem novidade.', 'Bora começar']);
  });

  it('não termina uma legenda em "de", "que" e afins quando precisa quebrar', () => {
    const text = 'eu fui na casa da minha avó comer um bolo de chocolate muito bom';
    const caps = segmentsToCaptions([sentence(text, 0, 20)], sec(30), null, { maxChars: 30 });
    for (const c of caps.slice(0, -1)) {
      const last = c.text.split(' ').pop()!;
      expect(['de', 'da', 'na', 'um', 'que', 'e', 'a', 'o', 'minha']).not.toContain(last);
    }
  });

  it('guarda o tempo de cada palavra, e o texto bate com as palavras', () => {
    const caps = segmentsToCaptions([sentence('bom dia pessoal', 100, 40)], sec(10));
    expect(caps).toHaveLength(1);
    const c = caps[0]!;
    expect(c.words!.map((w) => w.text).join(' ')).toBe(c.text);
    expect(c.words![0]!.start).toBe(sec(1));
    expect(c.start).toBe(sec(1));
  });

  it('dá um tempo mínimo de leitura sem invadir a próxima legenda', () => {
    const caps = segmentsToCaptions([sentence('Oi', 0, 10), sentence('tchau gente', 120, 20)], sec(10));
    expect(caps.map((c) => c.text)).toEqual(['Oi', 'tchau gente']);
    expect(caps[0]!.end - caps[0]!.start).toBeGreaterThanOrEqual(sec(0.8));
    expect(caps[0]!.end).toBeLessThanOrEqual(caps[1]!.start);
  });

  it('descarta marcas de som como [Música], (risos) e ♪', () => {
    const caps = segmentsToCaptions(
      [
        seg([
          [' [', 0, 10],
          ['M', 10, 20],
          ['ús', 20, 30],
          ['ica', 30, 40],
          [']', 40, 50],
        ]),
        sentence('vamos lá', 60, 30),
        seg([
          [' (', 200, 210],
          ['ris', 210, 220],
          ['os', 220, 230],
          [')', 230, 240],
        ]),
        seg([[' ♪', 300, 400]]),
      ],
      sec(10),
    );
    expect(caps.map((c) => c.text)).toEqual(['vamos lá']);
  });

  it('descarta frases que o modelo inventa no silêncio', () => {
    const caps = segmentsToCaptions(
      [sentence('Legendas pela comunidade Amara.org', 0, 30), sentence('Obrigado por assistir', 500, 30, 0.5)],
      sec(10),
    );
    expect(caps).toEqual([]);
  });

  it('mantém "obrigado por assistir" quando é fala de verdade', () => {
    const speech = [{ start: sec(4.9), end: sec(6.2) }];
    const caps = segmentsToCaptions([sentence('Obrigado por assistir', 500, 30, 0.95)], sec(10), speech);
    expect(caps.map((c) => c.text)).toEqual(['Obrigado por assistir']);
  });

  it('com o VAD, a legenda sai da tela quando a fala acaba', () => {
    const speech = [{ start: 0, end: sec(1) }];
    // a última palavra "escorregou" até 3 s, dentro da música
    const caps = segmentsToCaptions([seg([[' tudo', 0, 40], [' certo', 60, 300]])], sec(10), speech);
    expect(caps[0]!.end).toBeLessThanOrEqual(sec(1.4));
  });

  it('com o VAD, legendas seguidas nunca se sobrepõem', () => {
    const speech = [{ start: 0, end: sec(3) }];
    const text = 'Hoje eu vou mostrar como eu edito os meus vídeos direto pelo celular agora mesmo.';
    const caps = segmentsToCaptions([sentence(text, 0, 3)], sec(10), speech);
    expect(caps.length).toBeGreaterThan(1);
    for (let i = 1; i < caps.length; i++) expect(caps[i]!.start).toBeGreaterThanOrEqual(caps[i - 1]!.end);
  });

  it('com o VAD, tira palavras que caem fora da fala', () => {
    const speech = [{ start: 0, end: sec(1.2) }];
    const caps = segmentsToCaptions([sentence('isso é fala', 0, 30), sentence('isso é música', 600, 30, 0.5)], sec(10), speech);
    expect(caps.map((c) => c.text)).toEqual(['isso é fala']);
  });

  it('descarta segmentos com confiança muito baixa e palavras soltas no ruído', () => {
    const caps = segmentsToCaptions(
      [sentence('texto confiável aqui', 0, 30), sentence('blá', 500, 20, 0.2), sentence('ruído qualquer', 800, 30, 0.2)],
      sec(12),
    );
    expect(caps.map((c) => c.text)).toEqual(['texto confiável aqui']);
  });

  it('corta repetições em laço', () => {
    const caps = segmentsToCaptions([sentence('e aí e aí e aí e aí e aí beleza', 0, 20)], sec(10));
    expect(caps.flatMap((c) => c.text.split(' '))).toEqual(['e', 'aí', 'beleza']);
  });

  it('sem tokens, ainda funciona dividindo o texto do segmento', () => {
    const caps = segmentsToCaptions(
      [
        { text: ' Olá, pessoal!', t0: 0, t1: 150 },
        { text: '[Música]', t0: 150, t1: 300 },
        { text: ' Hoje vamos editar um vídeo.', t0: 300, t1: 520 },
      ],
      sec(10),
    );
    expect(caps.map((c) => c.text)).toEqual(['Olá, pessoal!', 'Hoje vamos editar um vídeo.']);
    expect(caps[1]!.start).toBe(sec(3));
  });

  it('limita ao fim do vídeo', () => {
    const caps = segmentsToCaptions([sentence('fala que passa do fim', 400, 30)], sec(5));
    for (const c of caps) expect(c.end).toBeLessThanOrEqual(sec(5));
    expect(caps.flatMap((c) => c.words!).every((w) => w.start < sec(5))).toBe(true);
  });

  it('ruídos viram vazio', () => {
    expect(cleanSegmentText('(risos)')).toBe('');
    expect(cleanSegmentText(' ... ')).toBe('');
    expect(cleanSegmentText('  bom  dia ')).toBe('bom dia');
  });

  it('VAD: junta trechos que se encostam', () => {
    const speech = vadToSpeech([
      { t0: 100, t1: 200 },
      { t0: 190, t1: 250 },
      { t0: 400, t1: 450 },
    ]);
    expect(speech).toEqual([
      { start: sec(1), end: sec(2.5) },
      { start: sec(4), end: sec(4.5) },
    ]);
  });

  it('emenda só a fala e devolve cada tempo ao lugar original', () => {
    const rate = CAPTION_SAMPLE_RATE;
    const audio = new Float32Array(rate * 10).fill(0.5);
    const speech = [
      { start: sec(2), end: sec(3) },
      { start: sec(7), end: sec(8) },
    ];
    const { audio: packed, chunks } = packSpeech(audio, speech, sec(0.2), sec(0.3));
    // 1,4 s de cada trecho (com a margem) + 0,3 s de silêncio depois de cada um
    expect(packed.length).toBe(Math.round(rate * (1.4 + 0.3 + 1.4 + 0.3)));
    expect(chunks).toEqual([
      { packed: 0, original: sec(1.8), length: sec(1.4) },
      { packed: sec(1.7), original: sec(6.8), length: sec(1.4) },
    ]);
    expect(unpackTime(sec(0.5), chunks)).toBe(sec(2.3));
    expect(unpackTime(sec(2), chunks)).toBe(sec(7.1));
    // no silêncio entre trechos, vai para a borda mais próxima
    expect(unpackTime(sec(1.5), chunks)).toBe(sec(3.2));
    expect(unpackTime(sec(1.6), chunks)).toBe(sec(6.8));
    const [seg] = unpackSegments([{ text: ' oi', t0: 20, t1: 60, tokens: [{ text: ' oi', t0: 200, t1: 230, p: 0.9 }] }], chunks);
    expect(seg).toMatchObject({ t0: 200, t1: 240 });
    expect(seg!.tokens![0]).toMatchObject({ t0: 710, t1: 740 });
  });

  it('a primeira palavra de uma frase não fica presa antes de uma pausa', () => {
    const caps = segmentsToCaptions(
      [
        seg([
          [' Tudo', 0, 30],
          [' certo.', 30, 60],
          [' A', 62, 70, 0.6],
        ]),
        sentence('transcrição ficou boa.', 300, 30),
      ],
      sec(10),
    );
    expect(caps.map((c) => c.text)).toEqual(['Tudo certo.', 'A transcrição ficou boa.']);
  });

  it('escolhe os áudios pela origem', () => {
    let p = projectWith(3, 4);
    p = addAudio(p, audioAsset(5), 0, 'voiceover', 'Narração').project;
    p = addAudio(p, audioAsset(5), 0, 'import', 'Música').project;
    expect(captionParts(p, 'video')).toHaveLength(2);
    expect(captionParts(p, 'voiceover')).toHaveLength(1);
    expect(captionParts(p, 'both')).toHaveLength(3);
  });

  it('monta o áudio da timeline a 16 kHz no lugar certo e na velocidade certa', () => {
    let p = projectWith(2, 2);
    p = setSpeed(p, p.main[1]!.id, 2, false);
    const parts = captionParts(p, 'video');
    const ones = new Float32Array(CAPTION_SAMPLE_RATE * 2).fill(0.5);
    const decoded = Object.fromEntries(parts.map((part) => [part.assetId, ones]));
    const mixed = mixCaptionAudio(parts, decoded, sec(3));
    expect(mixed.length).toBe(CAPTION_SAMPLE_RATE * 3);
    expect(mixed[CAPTION_SAMPLE_RATE * 2.5]).toBeCloseTo(0.5);
    expect(mixed[CAPTION_SAMPLE_RATE * 3 - 1]).toBeCloseTo(0.5);
  });
});
