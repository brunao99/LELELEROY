/**
 * Toque com resposta física: encolhe 3% no instante em que o dedo encosta e
 * volta ao soltar (transição CSS do Reanimated, 120 ms, sem re-render por
 * quadro). Com "reduzir movimento" ligado, só escurece um pouco.
 */
import { useState, type ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

export interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function PressableScale({ children, style, onPressIn, onPressOut, ...rest }: PressableScaleProps) {
  const [pressed, setPressed] = useState(false);
  const reduced = useReducedMotion();
  return (
    <Pressable
      {...rest}
      pressRetentionOffset={16}
      onPressIn={(e) => {
        setPressed(true);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(false);
        onPressOut?.(e);
      }}
    >
      <Animated.View style={[styles.base, style, pressed && (reduced ? styles.dimmed : styles.pressed)]}>{children}</Animated.View>
    </Pressable>
  );
}

// Objeto simples (não StyleSheet.create): as propriedades de transição são do Reanimated.
const styles = {
  base: {
    transform: [{ scale: 1 }],
    opacity: 1,
    transitionProperty: ['transform', 'opacity'],
    transitionDuration: 120,
    transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
  },
  pressed: { transform: [{ scale: 0.97 }] },
  dimmed: { opacity: 0.8 },
} as const;
