import { Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';

import type { ColorMatrix, ShaderParams } from '@/core/color';

/**
 * Correção de cor completa num passo: matriz de cor (filtro + ajustes),
 * realces, sombras, nitidez e vinheta. Usado só quando algum ajuste não linear
 * está ligado; senão basta um ColorFilter de matriz.
 */
const GRADE_SKSL = `
uniform shader image;
uniform float2 size;
uniform float4x4 cm;
uniform float4 cmOffset;
uniform float highlights;
uniform float shadows;
uniform float sharpen;
uniform float vignette;

half4 main(float2 p) {
  half4 c = image.eval(p);
  if (sharpen > 0.0) {
    half4 n = image.eval(p + float2(1.0, 0.0)) + image.eval(p - float2(1.0, 0.0))
            + image.eval(p + float2(0.0, 1.0)) + image.eval(p - float2(0.0, 1.0));
    c = c + (c * 4.0 - n) * half(sharpen * 0.6);
  }
  float a = max(float(c.a), 0.0001);
  float3 rgb = float3(c.rgb) / a;
  float4 v = cm * float4(rgb, 1.0) + cmOffset;
  rgb = v.rgb;
  float l = dot(rgb, float3(0.2126, 0.7152, 0.0722));
  float hw = smoothstep(0.45, 1.0, l);
  float sw = 1.0 - smoothstep(0.0, 0.55, l);
  rgb += float3(highlights * 0.35 * hw + shadows * 0.35 * sw);
  float2 uv = p / size - 0.5;
  float d = length(uv) * 1.4142;
  rgb *= 1.0 - vignette * smoothstep(0.35, 1.0, d);
  rgb = clamp(rgb, 0.0, 1.0);
  return half4(half3(rgb * a), half(a));
}
`;

let cached: SkRuntimeEffect | null | undefined;

export function gradeEffect(): SkRuntimeEffect | null {
  if (cached === undefined) cached = Skia.RuntimeEffect.Make(GRADE_SKSL);
  return cached;
}

/**
 * Uniformes na ordem do shader. A matriz 4×4 vai por colunas (formato do SkSL);
 * a matriz de cor do projeto é 4×5 por linhas.
 */
export function gradeUniforms(width: number, height: number, matrix: ColorMatrix | null, params: ShaderParams): number[] {
  'worklet';
  const m = matrix ?? [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
  const columns: number[] = [];
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) columns.push(m[row * 5 + col]!);
  }
  return [
    width,
    height,
    ...columns,
    m[4]!,
    m[9]!,
    m[14]!,
    m[19]!,
    params.highlights,
    params.shadows,
    params.sharpen,
    params.vignette,
  ];
}
