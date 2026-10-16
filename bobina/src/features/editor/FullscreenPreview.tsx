/**
 * Preview em tela cheia: o mesmo quadro do player, desenhado no tamanho da tela
 * (o player passa a renderizar nesse tamanho enquanto ela está aberta). Tocar
 * toca/pausa; o X ou o voltar do Android fecham.
 */
import { Canvas, Image } from '@shopify/react-native-skia';
import { X } from 'lucide-react-native';
import { useEffect } from 'react';
import { BackHandler, Pressable, StatusBar, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fitInside } from '@/core/geometry';
import type { PreviewPlayer } from '@/engine/player';
import { IconButton } from '@/ui/Button';
import { colors, space } from '@/ui/theme';

export function FullscreenPreview({
  player,
  aspect,
  durationUs,
  onSize,
  onClose,
}: {
  player: PreviewPlayer;
  aspect: number;
  durationUs: number;
  onSize: (size: { width: number; height: number }) => void;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const fit = fitInside(aspect, { width, height });

  useEffect(() => {
    onSize({ width: Math.round(fit.width), height: Math.round(fit.height) });
  }, [fit.width, fit.height, onSize]);

  // Registrado por último, o voltar do Android chega aqui antes do editor.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const duration = Math.max(1, durationUs / 1_000_000);
  const progress = useAnimatedStyle(() => ({ width: `${Math.min(100, (player.time.value / duration) * 100)}%` }));

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} accessibilityViewIsModal>
      <StatusBar hidden />
      <Pressable style={styles.stage} onPress={player.toggle} accessibilityRole="button" accessibilityLabel="Vídeo em tela cheia. Toque para tocar ou pausar.">
        <Canvas style={{ width: fit.width, height: fit.height }}>
          <Image image={player.frame} x={0} y={0} width={fit.width} height={fit.height} fit="fill" />
        </Canvas>
      </Pressable>
      <View style={[styles.close, { top: insets.top + space[2] }]}>
        <IconButton icon={X} label="Sair da tela cheia" onPress={onClose} />
      </View>
      <View style={[styles.track, { bottom: insets.bottom + space[3] }]} pointerEvents="none">
        <Animated.View style={[styles.fill, progress]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#000', zIndex: 50 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', right: space[2], borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)' },
  track: { position: 'absolute', left: space[4], right: space[4], height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  fill: { height: 3, backgroundColor: colors.accent },
});
