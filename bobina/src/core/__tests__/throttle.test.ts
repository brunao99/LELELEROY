import { throttle } from '../throttle';

describe('throttle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('chama na hora, segura os seguintes e sempre entrega o último', () => {
    let t = 0;
    const calls: number[] = [];
    const f = throttle((v: number) => calls.push(v), 70, () => t);
    f(1);
    t = 10;
    f(2);
    t = 20;
    f(3);
    expect(calls).toEqual([1]);
    t = 70;
    jest.advanceTimersByTime(70);
    expect(calls).toEqual([1, 3]);
    t = 200;
    f(4);
    expect(calls).toEqual([1, 3, 4]);
  });

  it('flush entrega o pendente na hora; cancel descarta', () => {
    let t = 0;
    const calls: number[] = [];
    const f = throttle((v: number) => calls.push(v), 100, () => t);
    f(1);
    t = 5;
    f(2);
    f.flush();
    expect(calls).toEqual([1, 2]);
    t = 10;
    f(3);
    f.cancel();
    jest.advanceTimersByTime(200);
    expect(calls).toEqual([1, 2]);
  });
});
