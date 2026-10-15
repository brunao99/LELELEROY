jest.mock('react-native-reanimated', () => ({}));
jest.mock('react-native-gesture-handler', () => ({}));
jest.mock('react-native-worklets', () => ({ scheduleOnRN: () => {} }));
jest.mock('expo-haptics', () => ({ selectionAsync: () => Promise.resolve() }));

// eslint-disable-next-line import/first
import { fromFraction, magnetize, precisionFactor, toFraction } from '../Slider';

describe('barra deslizante', () => {
  it('perto da barra o arrasto é 1:1; afastando o dedo, fica mais fino', () => {
    expect(precisionFactor(10)).toBe(1);
    expect(precisionFactor(70)).toBeLessThan(1);
    expect(precisionFactor(200)).toBeLessThan(precisionFactor(70));
  });

  it('o ímã segura só bem perto do valor padrão', () => {
    expect(magnetize(0.505, 0.5)).toBe(0.5);
    expect(magnetize(0.53, 0.5)).toBe(0.53);
    expect(magnetize(0.505, null)).toBe(0.505);
  });

  it('converte fração ↔ valor (linear, log e passo)', () => {
    expect(fromFraction(0.5, 0, 100, 'linear', 1)).toBe(50);
    expect(fromFraction(1.2, 0, 100, 'linear', 0)).toBe(100);
    expect(toFraction(fromFraction(0.3, 0.2, 4, 'log', 0), 0.2, 4, 'log')).toBeCloseTo(0.3);
    expect(fromFraction(0.333, 0, 10, 'linear', 0.5)).toBe(3.5);
  });
});
