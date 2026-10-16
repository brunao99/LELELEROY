/**
 * A transição do toque passa pela mesma validação que o Reanimated faz no
 * aparelho (uma curva em texto "cubic-bezier(...)" fechava o app).
 */
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'View' },
  useReducedMotion: () => false,
  // A curva de verdade, sem inicializar o motor nativo.
  cubicBezier: jest.requireActual('react-native-reanimated/lib/module/css/easing').cubicBezier,
}));

// O validador que o Reanimated usa no aparelho (arquivo interno, sem tipos).
const { normalizeCSSTransitionProperties } = jest.requireActual('react-native-reanimated/lib/module/css/native/normalization/transition/config') as {
  normalizeCSSTransitionProperties: (config: object) => unknown;
};

// eslint-disable-next-line import/first
import { pressStyles } from '../PressableScale';

it('a transição do toque é aceita pelo Reanimated', () => {
  const { transitionProperty, transitionDuration, transitionTimingFunction } = pressStyles.base;
  expect(() => normalizeCSSTransitionProperties({ transitionProperty, transitionDuration, transitionTimingFunction })).not.toThrow();
});

it('a curva em texto seria recusada (o erro que apareceu no celular)', () => {
  expect(() =>
    normalizeCSSTransitionProperties({ transitionProperty: 'transform', transitionDuration: 120, transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)' }),
  ).toThrow(/Invalid predefined timing function/);
});
