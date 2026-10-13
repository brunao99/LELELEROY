import { CAPTION_SAMPLE_RATE, captionParts, cleanSegmentText, mixCaptionAudio, segmentsToCaptions } from '../captions';
import { addAudio, setSpeed } from '../ops';
import { sec } from '../time';
import { audioAsset, projectWith } from './fixtures';

describe('legendas automáticas', () => {
  it('converte centésimos de segundo e limpa ruídos', () => {
    const caps = segmentsToCaptions(
      [
        { text: ' Olá, pessoal!', t0: 0, t1: 150 },
        { text: '[Música]', t0: 150, t1: 300 },
        { text: ' Hoje vamos editar um vídeo.', t0: 300, t1: 520 },
      ],
      sec(10),
    );
    expect(caps.map((c) => [c.start, c.end, c.text])).toEqual([
      [0, sec(1.5), 'Olá, pessoal!'],
      [sec(3), sec(5.2), 'Hoje vamos editar um vídeo.'],
    ]);
  });

  it('corta sobreposição e o que passa do fim', () => {
    const caps = segmentsToCaptions(
      [
        { text: 'primeira legenda bem comprida aqui', t0: 0, t1: 300 },
        { text: 'segunda legenda também comprida', t0: 250, t1: 2000 },
      ],
      sec(5),
    );
    expect(caps[1]!.start).toBe(caps[0]!.end);
    expect(caps[1]!.end).toBe(sec(5));
  });

  it('junta pedaços curtos colados', () => {
    const caps = segmentsToCaptions(
      [
        { text: 'Oi', t0: 0, t1: 50 },
        { text: 'tudo bem', t0: 50, t1: 100 },
      ],
      sec(5),
    );
    expect(caps.map((c) => c.text)).toEqual(['Oi tudo bem']);
  });

  it('ruídos viram vazio', () => {
    expect(cleanSegmentText('(risos)')).toBe('');
    expect(cleanSegmentText(' ... ')).toBe('');
    expect(cleanSegmentText('  bom  dia ')).toBe('bom dia');
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
