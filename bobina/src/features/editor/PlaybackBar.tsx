import { Maximize2, Pause, Play, Redo2, Undo2 } from 'lucide-react-native';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedProps, useDerivedValue } from 'react-native-reanimated';

import { formatTime } from '@/core/time';
import type { PreviewPlayer } from '@/engine/player';
import { useCanRedo, useCanUndo, useEditor } from '@/state/editor';
import { IconButton } from '@/ui/Button';
import { colors, space } from '@/ui/theme';
import { useEffect, useState } from 'react';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/** Tempo atual / total, play/pause, desfazer e refazer. */
export function PlaybackBar({ player, durationUs, onFullscreen }: { player: PreviewPlayer; durationUs: number; onFullscreen: () => void }) {
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const total = formatTime(durationUs);

  // O tempo é atualizado na thread de UI, sem renderizar o React a cada quadro.
  const label = useDerivedValue(() => `${formatTime(player.time.value * 1_000_000)} / ${total}`);
  const animatedProps = useAnimatedProps(() => ({ text: label.value, defaultValue: label.value }) as never);

  // O ícone de play/pause acompanha o estado (que muda na thread de UI).
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setPlaying(player.playing.value), 150);
    return () => clearInterval(id);
  }, [player.playing]);

  return (
    <View style={styles.bar}>
      <AnimatedTextInput
        editable={false}
        underlineColorAndroid="transparent"
        style={styles.time}
        animatedProps={animatedProps}
        accessibilityLabel="Tempo"
      />
      <IconButton icon={playing ? Pause : Play} label={playing ? 'Pausar' : 'Tocar'} onPress={player.toggle} size={26} />
      <View style={styles.right}>
        <IconButton icon={Maximize2} label="Tela cheia" onPress={onFullscreen} />
        <IconButton icon={Undo2} label="Desfazer" onPress={undo} disabled={!canUndo} />
        <IconButton icon={Redo2} label="Refazer" onPress={redo} disabled={!canRedo} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[2],
    backgroundColor: colors.bg,
  },
  time: {
    width: 144,
    color: colors.text,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    paddingHorizontal: space[2],
    paddingVertical: 0,
  },
  right: { flexDirection: 'row', width: 144, justifyContent: 'flex-end' },
});
