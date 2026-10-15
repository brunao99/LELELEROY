import { gatedRotation, snapRotation, snapScale, type RotationGate } from '../gestureMath';

describe('gestos do preview', () => {
  it('pinça com tremida não gira; girando de verdade, começa sem salto', () => {
    const gate: RotationGate = { engaged: false, offset: 0 };
    expect(gatedRotation(2, gate)).toBe(0);
    expect(gatedRotation(-3.5, gate)).toBe(0);
    expect(gatedRotation(5, gate)).toBe(1);
    expect(gatedRotation(10, gate)).toBe(6);
    expect(gatedRotation(2, gate)).toBe(-2);
  });

  it('o giro encaixa nos ângulos retos e o tamanho em 100%', () => {
    expect(snapRotation(88)).toEqual({ value: 90, snapped: true });
    expect(snapRotation(-182)).toEqual({ value: -180, snapped: true });
    expect(snapRotation(45)).toEqual({ value: 45, snapped: false });
    expect(snapScale(1.02)).toEqual({ value: 1, snapped: true });
    expect(snapScale(1.1)).toEqual({ value: 1.1, snapped: false });
  });
});
