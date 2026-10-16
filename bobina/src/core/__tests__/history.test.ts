import { canRedo, canUndo, commit, endGesture, initHistory, redo, undo } from '../history';
import { renameProject } from '../ops';
import { projectWith } from './fixtures';

describe('histórico', () => {
  it('desfaz e refaz', () => {
    const p0 = projectWith(3);
    let h = initHistory(p0);
    const p1 = renameProject(p0, 'Um');
    h = commit(h, p1, { now: 0 });
    expect(canUndo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toBe(p0);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(p1);
  });

  it('não cria passo quando nada muda', () => {
    const p0 = projectWith(3);
    const h = initHistory(p0);
    expect(commit(h, p0)).toBe(h);
  });

  it('junta edições seguidas do mesmo gesto', () => {
    const p0 = projectWith(3);
    let h = initHistory(p0);
    h = commit(h, renameProject(p0, 'a'), { key: 'slider', now: 0 });
    h = commit(h, renameProject(h.present, 'ab'), { key: 'slider', now: 100 });
    h = commit(h, renameProject(h.present, 'abc'), { key: 'slider', now: 200 });
    expect(h.past).toHaveLength(1);
    expect(undo(h).present).toBe(p0);
  });

  it('separa gestos depois de endGesture ou de um tempo', () => {
    const p0 = projectWith(3);
    let h = initHistory(p0);
    h = commit(h, renameProject(p0, 'a'), { key: 'k', now: 0 });
    h = endGesture(h);
    h = commit(h, renameProject(h.present, 'b'), { key: 'k', now: 100 });
    h = commit(h, renameProject(h.present, 'c'), { key: 'k', now: 5_000 });
    expect(h.past).toHaveLength(3);
  });

  it('nova edição apaga o "refazer"', () => {
    const p0 = projectWith(3);
    let h = initHistory(p0);
    h = commit(h, renameProject(p0, 'a'), { now: 0 });
    h = undo(h);
    h = commit(h, renameProject(h.present, 'b'), { now: 10 });
    expect(canRedo(h)).toBe(false);
  });

  it('respeita o limite', () => {
    let h = initHistory(projectWith(1));
    for (let i = 0; i < 10; i++) h = commit(h, renameProject(h.present, `n${i}`), { now: i * 10_000, limit: 3 });
    expect(h.past).toHaveLength(3);
  });
});
