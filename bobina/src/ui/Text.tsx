import { Text as RNText, type TextProps, type TextStyle } from 'react-native';

import { colors, type as typeScale } from './theme';

type Variant = keyof typeof typeScale;
type Tone = 'default' | 'muted' | 'faint' | 'accent' | 'danger' | 'onAccent';

const TONES: Record<Tone, string> = {
  default: colors.text,
  muted: colors.textMuted,
  faint: colors.textFaint,
  accent: colors.accent,
  danger: colors.danger,
  onAccent: colors.onAccent,
};

export interface TxtProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
  weight?: TextStyle['fontWeight'];
  align?: TextStyle['textAlign'];
  /** Algarismos de largura fixa (tempos). */
  tabular?: boolean;
}

export function Txt({ variant = 'base', tone = 'default', weight, align, tabular, style, ...rest }: TxtProps) {
  return (
    <RNText
      {...rest}
      style={[
        typeScale[variant],
        { color: TONES[tone] },
        weight ? { fontWeight: weight } : null,
        align ? { textAlign: align } : null,
        tabular ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
    />
  );
}
