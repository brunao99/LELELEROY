/**
 * Store do editor: gestos contínuos, desfazer/refazer e o cache de velocidade.
 * O disco e o motor nativo ficam de fora (mocks).
 */
import { setFades, setSpeed, trimItem } from '@/core/ops';
import { sec } from '@/core/time';
import { clipDuration } from '@/core/timeline';
import { projectWith } from '@/core/__tests__/fixtures';

jest.mock('@/storage/projects', () => ({ saveProject: jest.fn() }));
jest.mock('@/storage/paths', () => ({ absolutePath: (_id: string, r: string) => `/data/${r}` }));
jest.mock('@/engine/bake', () => ({
  runBake: jest.fn(),
  runAudioRender: jest.fn(),
}));

// eslint-disable-next-line import/first
import { useEditor } from '../editor';

beforeEach(() => {
  jest.useFakeTimers();
  useEditor.getState().open(projectWith(10, 5));
});

afterEach(() => {
  useEditor.getState().close();
  jest.useRealTimers();
});

const present = () => useEditor.getState().history!.present;

describe('gestos contínuos', () => {
  it('aplicam o deslocamento total a partir do começo do gesto e viram um passo só', () => {
    const id = present().main[0]!.id;
    const { applyGesture, endGesture, undo } = useEditor.getState();
    // Três passos de um arrasto: -1 s, -2 s, -3 s no fim do clipe.
    for (const delta of [-1, -2, -3]) applyGesture(`trim:${id}`, (base) => trimItem(base, id, 'end', sec(delta)));
    endGesture();
    expect(clipDuration(present().main[0]!)).toBe(sec(7));
    expect(useEditor.getState().history!.past).toHaveLength(1);
    undo();
    expect(clipDuration(present().main[0]!)).toBe(sec(10));
  });

  it('dois gestos seguidos são dois passos', () => {
    const id = present().main[0]!.id;
    const { applyGesture, endGesture } = useEditor.getState();
    applyGesture(`trim:${id}`, (base) => trimItem(base, id, 'end', sec(-1)));
    endGesture();
    applyGesture(`trim:${id}`, (base) => trimItem(base, id, 'end', sec(-1)));
    endGesture();
    expect(clipDuration(present().main[0]!)).toBe(sec(8));
    expect(useEditor.getState().history!.past).toHaveLength(2);
  });
});

describe('desfazer não joga fora o cache', () => {
  it('cópias aceleradas e áudios processados sobrevivem ao desfazer', () => {
    const id = present().main[0]!.id;
    useEditor.getState().apply((p) => setSpeed(p, id, 2, true));
    useEditor.getState().patchSilently((p) => ({
      ...p,
      bakes: { k: { key: 'k', assetId: 'x', speed: 2, keepPitch: true, from: 0, to: 1, videoFile: 'b.mp4', audioFile: null } },
      audioRenders: { r: { key: 'r', file: 'r.wav' } },
    }));
    useEditor.getState().undo();
    expect(present().main[0]!.speed).toBe(1);
    expect(present().bakes.k?.videoFile).toBe('b.mp4');
    expect(present().audioRenders.r?.file).toBe('r.wav');
  });
});

describe('seleção', () => {
  it('applyAdded seleciona o item novo e abre o painel pedido', () => {
    const ok = useEditor.getState().applyAdded(
      (p) => ({ project: setFades(p, p.main[0]!.id, sec(1), 0), id: p.main[0]!.id }),
      'main',
      { panel: 'volume' },
    );
    expect(ok).toBe(true);
    expect(useEditor.getState().selection).toEqual({ kind: 'main', id: present().main[0]!.id });
    expect(useEditor.getState().panel).toBe('volume');
  });

  it('desfazer limpa a seleção e fecha o painel', () => {
    useEditor.getState().applyAdded((p) => ({ project: setSpeed(p, p.main[0]!.id, 2, true), id: p.main[0]!.id }), 'main', { panel: 'speed' });
    useEditor.getState().undo();
    expect(useEditor.getState().selection).toBeNull();
    expect(useEditor.getState().panel).toBeNull();
  });
});
