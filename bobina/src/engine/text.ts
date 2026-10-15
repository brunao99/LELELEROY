/**
 * Texto do vídeo: monta os parágrafos do Skia (preenchimento e contorno) no
 * espaço de desenho do projeto. Roda na thread de JS; o desenho só pinta.
 */
import {
  FontSlant,
  PaintStyle,
  Skia,
  StrokeJoin,
  TextAlign,
  type SkParagraph,
  type SkTextStyle,
  type SkTypefaceFontProvider,
} from '@shopify/react-native-skia';

import type { TextStyle } from '@/core/types';

import { fontInfo } from './fonts';

export interface TextParts {
  fill: SkParagraph;
  stroke: SkParagraph | null;
  /** Caixa do texto (unidades de desenho). */
  width: number;
  height: number;
  /** Margem do fundo em volta do texto. */
  padding: number;
  fontSize: number;
}

const ALIGN: Record<TextStyle['align'], TextAlign> = {
  left: TextAlign.Left,
  center: TextAlign.Center,
  right: TextAlign.Right,
};

function skTextStyle(style: TextStyle, fontSize: number, withShadow: boolean): SkTextStyle {
  const font = fontInfo(style.font);
  const weight = style.bold ? 700 : 400;
  const textStyle: SkTextStyle = {
    color: Skia.Color(style.color),
    fontFamilies: [font.family],
    fontSize,
    letterSpacing: style.letterSpacing * fontSize,
    heightMultiplier: style.lineHeight,
    fontStyle: { weight, slant: style.italic ? FontSlant.Italic : FontSlant.Upright },
  };
  if (font.variable) textStyle.fontVariations = [{ axis: 'wght', value: weight }];
  if (withShadow && style.shadow) {
    textStyle.shadows = [
      {
        color: Skia.Color(style.shadow.color),
        offset: { x: style.shadow.dx * fontSize, y: style.shadow.dy * fontSize },
        blurRadius: style.shadow.blur * fontSize,
      },
    ];
  }
  return textStyle;
}

function build(
  text: string,
  style: TextStyle,
  fontSize: number,
  provider: SkTypefaceFontProvider,
  width: number,
  strokePaint: ReturnType<typeof Skia.Paint> | null,
): SkParagraph {
  const builder = Skia.ParagraphBuilder.Make({ textAlign: ALIGN[style.align] }, provider);
  const textStyle = skTextStyle(style, fontSize, strokePaint === null);
  if (strokePaint) builder.pushStyle(textStyle, strokePaint);
  else builder.pushStyle(textStyle);
  builder.addText(text);
  builder.pop();
  const paragraph = builder.build();
  paragraph.layout(width);
  return paragraph;
}

/**
 * Monta o texto. `shortSide` é o lado menor do quadro (o tamanho da letra é uma
 * fração dele) e `maxWidth` a largura máxima de uma linha. Com `balance`, as
 * linhas saem com larguras parecidas (usado nas legendas).
 */
export function buildTextParts(
  text: string,
  style: TextStyle,
  shortSide: number,
  maxWidth: number,
  provider: SkTypefaceFontProvider,
  balance = false,
): TextParts {
  const fontSize = Math.max(4, style.size * shortSide);
  const content = text.length > 0 ? text : ' ';
  // Primeiro mede com a largura máxima, depois refaz com a largura da linha mais
  // longa: assim a caixa abraça o texto e o alinhamento funciona em várias linhas.
  const probe = build(content, style, fontSize, provider, maxWidth, null);
  let layoutWidth = maxWidth;
  const lines = probe.getLineMetrics().length;
  if (balance && lines >= 2) {
    // Linhas equilibradas: a menor largura que ainda dá o mesmo número de linhas.
    // Evita uma palavra sozinha na última linha.
    let lo = maxWidth / (lines + 1);
    let hi = maxWidth;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      probe.layout(mid);
      if (probe.getLineMetrics().length > lines) lo = mid;
      else hi = mid;
    }
    probe.layout(hi);
    layoutWidth = hi;
  }
  const width = Math.min(layoutWidth, Math.ceil(probe.getLongestLine()) + 2);
  const fill = build(content, style, fontSize, provider, width, null);
  let stroke: SkParagraph | null = null;
  if (style.stroke && style.stroke.width > 0) {
    const paint = Skia.Paint();
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(style.stroke.width * fontSize);
    paint.setStrokeJoin(StrokeJoin.Round);
    paint.setColor(Skia.Color(style.stroke.color));
    paint.setAntiAlias(true);
    stroke = build(content, style, fontSize, provider, width, paint);
  }
  return { fill, stroke, width, height: fill.getHeight(), padding: fontSize * 0.25, fontSize };
}
