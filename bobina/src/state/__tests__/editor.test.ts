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
import { bakeKey } from '@/core/composition';
// eslint-disable-next-line import/first
import { runBake } from '@/engine/bake';
// eslint-disable-next-line import/first
import { pauseBackgroundWork, useEditor } from '../editor';

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

describe('processamento em segundo plano', () => {
  const mockedBake = runBake as jest.MockedFunction<typeof runBake>;

  beforeEach(() => {
    mockedBake.mockReset();
    mockedBake.mockImplementation(async (project, request) => ({
      key: request.key,
      assetId: request.assetId,
      speed: request.speed,
      keepPitch: request.keepPitch,
      from: request.from,
      to: request.to,
      videoFile: 'baked/x.mp4',
      audioFile: 'baked/x.wav',
    }));
  });

  it('processa a velocidade nova depois de um tempo', async () => {
    const id = present().main[0]!.id;
    useEditor.getState().apply((p) => setSpeed(p, id, 2, false));
    await jest.advanceTimersByTimeAsync(1000);
    expect(mockedBake).toHaveBeenCalledTimes(1);
    expect(present().bakes[bakeKey(present().main[0]!.assetId, 2, false)]?.videoFile).toBe('baked/x.mp4');
  });

  it('não processa a velocidade de uma mídia ausente', async () => {
    const p = projectWith(10);
    useEditor.getState().open(setSpeed(p, p.main[0]!.id, 2, false), [p.main[0]!.assetId]);
    await jest.advanceTimersByTimeAsync(2000);
    expect(mockedBake).not.toHaveBeenCalled();
  });

  it('pausado durante a exportação, não processa; ao retomar, processa', async () => {
    const resume = await pauseBackgroundWork();
    const id = present().main[0]!.id;
    useEditor.getState().apply((p) => setSpeed(p, id, 2, false));
    await jest.advanceTimersByTimeAsync(2000);
    expect(mockedBake).not.toHaveBeenCalled();
    resume();
    await jest.advanceTimersByTimeAsync(1000);
    expect(mockedBake).toHaveBeenCalledTimes(1);
  });

  it('a pausa espera o processamento em andamento terminar', async () => {
    let finish: () => void = () => {};
    mockedBake.mockImplementationOnce(
      (project, request) =>
        new Promise((resolve) => {
          finish = () =>
            resolve({ ...request, from: request.from, to: request.to, videoFile: 'baked/y.mp4', audioFile: 'baked/y.wav' });
        }),
    );
    const id = present().main[0]!.id;
    useEditor.getState().apply((p) => setSpeed(p, id, 3, false));
    await jest.advanceTimersByTimeAsync(800);
    expect(mockedBake).toHaveBeenCalledTimes(1);
    let paused = false;
    const pausing = pauseBackgroundWork().then((resume) => {
      paused = true;
      return resume;
    });
    await jest.advanceTimersByTimeAsync(300);
    expect(paused).toBe(false);
    finish();
    await jest.advanceTimersByTimeAsync(300);
    expect(paused).toBe(true);
    (await pausing)();
  });
});
