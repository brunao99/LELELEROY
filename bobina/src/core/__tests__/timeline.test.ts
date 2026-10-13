import { setTransition, setSpeed } from '../ops';
import { sec } from '../time';
import {
  clipDuration,
  effectiveTransition,
  firstFreeLayer,
  insertIndexAt,
  layoutMain,
  mainDuration,
  mainSlotAt,
  projectDuration,
} from '../timeline';
import { projectWith } from './fixtures';

describe('clipDuration', () => {
  it('divide o trecho pela velocidade', () => {
    expect(clipDuration({ sourceIn: 0, sourceOut: sec(10), speed: 2 })).toBe(sec(5));
    expect(clipDuration({ sourceIn: sec(1), sourceOut: sec(3), speed: 0.5 })).toBe(sec(4));
  });

  it('nunca fica abaixo de 0,1 s', () => {
    expect(clipDuration({ sourceIn: 0, sourceOut: 10, speed: 1 })).toBe(100_000);
  });
});

describe('layoutMain', () => {
  it('coloca os clipes um depois do outro', () => {
    const slots = layoutMain(projectWith(3, 4, 5));
    expect(slots.map((s) => [s.start, s.end])).toEqual([
      [0, sec(3)],
      [sec(3), sec(7)],
      [sec(7), sec(12)],
    ]);
  });

  it('sobrepõe os clipes na transição e encurta o total', () => {
    let p = projectWith(3, 4);
    p = setTransition(p, p.main[0]!.id, { kind: 'dissolve', duration: sec(1) });
    const slots = layoutMain(p);
    expect(slots[1]!.start).toBe(sec(2));
    expect(slots[0]!.coreEnd).toBe(sec(2));
    expect(slots[1]!.transitionIn?.duration).toBe(sec(1));
    expect(mainDuration(p)).toBe(sec(6));
  });

  it('limita a transição à metade do clipe mais curto', () => {
    let p = projectWith(1, 10);
    p = setTransition(p, p.main[0]!.id, { kind: 'dissolve', duration: sec(3) });
    expect(layoutMain(p)[0]!.transitionOut?.duration).toBe(sec(0.5));
  });

  it('ignora transição curta demais', () => {
    expect(effectiveTransition({ kind: 'dissolve', duration: sec(2) }, sec(0.15), sec(5))).toBeNull();
  });

  it('acompanha a velocidade', () => {
    let p = projectWith(10, 2);
    p = setSpeed(p, p.main[0]!.id, 4, true);
    expect(layoutMain(p)[1]!.start).toBe(sec(2.5));
  });
});

describe('mainSlotAt', () => {
  it('acha o dono de cada instante, inclusive na transição', () => {
    let p = projectWith(3, 3);
    p = setTransition(p, p.main[0]!.id, { kind: 'dissolve', duration: sec(1) });
    const slots = layoutMain(p);
    expect(mainSlotAt(slots, 0)?.index).toBe(0);
    expect(mainSlotAt(slots, sec(1.9))?.index).toBe(0);
    expect(mainSlotAt(slots, sec(2))?.index).toBe(1);
    expect(mainSlotAt(slots, sec(4.9))).toBe(slots[1]);
    expect(mainSlotAt(slots, sec(5))).toBeUndefined();
  });
});

describe('insertIndexAt', () => {
  it('insere antes ou depois conforme a metade', () => {
    const p = projectWith(4, 4);
    expect(insertIndexAt(p, sec(1))).toBe(0);
    expect(insertIndexAt(p, sec(3))).toBe(1);
    expect(insertIndexAt(p, sec(7))).toBe(2);
    expect(insertIndexAt(p, sec(100))).toBe(2);
  });
});

describe('firstFreeLayer', () => {
  it('pula as camadas ocupadas', () => {
    const items = [
      { id: 'a', kind: 'text' as const, layer: 0, start: 0, duration: sec(3) },
      { id: 'b', kind: 'text' as const, layer: 1, start: sec(2), duration: sec(3) },
    ];
    expect(firstFreeLayer(items, sec(1), sec(2))).toBe(1);
    expect(firstFreeLayer(items, sec(2.5), sec(4))).toBe(2);
    expect(firstFreeLayer(items, sec(3), sec(4))).toBe(0);
  });
});

describe('projectDuration', () => {
  it('vai até a última coisa visível', () => {
    const p = projectWith(3);
    const withText = {
      ...p,
      texts: [{ ...makeText(), start: sec(2), duration: sec(5) }],
    };
    expect(projectDuration(withText)).toBe(sec(7));
  });
});

function makeText() {
  return {
    kind: 'text' as const,
    id: 't1',
    start: 0,
    duration: sec(1),
    layer: 0,
    text: 'Oi',
    style: {
      font: 'inter' as const,
      size: 0.07,
      color: '#fff',
      align: 'center' as const,
      bold: false,
      italic: false,
      stroke: null,
      shadow: null,
      background: null,
      opacity: 1,
      letterSpacing: 0,
      lineHeight: 1.2,
    },
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    animIn: { kind: 'none' as const, duration: 0 },
    animOut: { kind: 'none' as const, duration: 0 },
    animLoop: 'none' as const,
  };
}
