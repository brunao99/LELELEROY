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

/**
 * Efeitos de vídeo, chroma key e recorte com laço num passo só, sobre a imagem
 * original (a correção de cor vem depois). `kind`: 0 nenhum, 1 glitch, 2
 * aberração cromática (RGB), 3 granulado (VHS), 4 pixelado, 5 flash. O chroma
 * key tira a cor escolhida (comparando só o tom, em YCbCr) e reduz o
 * "vazamento" dela nas bordas.
 *
 * Recorte: `mask` é a máscara 256x256 do quadro (no quadro em pé; `rot` diz como
 * a textura está girada). A borda é refeita na resolução do vídeo por
 * upsampling bilateral conjunto: cada célula da máscara pesa pela distância e
 * pela semelhança de cor entre o pixel e o centro da célula, então a borda gruda
 * no contorno real da imagem em vez de seguir a grade.
 */
export const FX_SKSL = `
uniform shader image;
uniform float2 size;
uniform float time;
uniform float kind;
uniform float amount;
uniform float keyOn;
uniform float2 keyCbCr;
uniform float similarity;
uniform float smoothness;
uniform shader mask;
uniform float maskOn;
uniform float maskSize;
uniform float rot;
uniform float invert;
uniform float feather;

float hash(float2 p) {
  return fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453);
}

float4 fetch(float2 p) {
  return float4(image.eval(p));
}

// Textura (pixels) -> quadro em pé (0..1), e o caminho de volta.
float2 toUpright(float2 p) {
  float2 t = p / size;
  if (rot < 0.5) return t;
  if (rot < 1.5) return float2(1.0 - t.y, t.x);
  if (rot < 2.5) return float2(1.0 - t.x, 1.0 - t.y);
  return float2(t.y, 1.0 - t.x);
}

float2 fromUpright(float2 u) {
  float2 t = u;
  if (rot > 0.5 && rot < 1.5) t = float2(u.y, 1.0 - u.x);
  else if (rot > 1.5 && rot < 2.5) t = float2(1.0 - u.x, 1.0 - u.y);
  else if (rot > 2.5) t = float2(1.0 - u.y, u.x);
  return t * size;
}

float cutoutAlpha(float2 p) {
  float3 guide = fetch(p).rgb;
  float2 m = toUpright(p) * maskSize - 0.5;
  float2 b = floor(m);
  float sigmaS = mix(1.0, 2.0, feather);
  float sigmaR = mix(0.2, 1.2, feather);
  float num = 0.0;
  float den = 0.0;
  for (int j = -1; j <= 2; j++) {
    for (int i = -1; i <= 2; i++) {
      float2 cell = b + float2(float(i), float(j));
      float2 q = clamp(cell, float2(0.0), float2(maskSize - 1.0));
      float2 d = m - cell;
      float ws = exp(-dot(d, d) / (2.0 * sigmaS * sigmaS));
      float3 dc = guide - fetch(fromUpright((q + 0.5) / maskSize)).rgb;
      float w = ws * exp(-dot(dc, dc) / (2.0 * sigmaR * sigmaR)) + 0.000001;
      num += w * float(mask.eval(q + 0.5).r);
      den += w;
    }
  }
  float w = mix(0.06, 0.5, feather);
  float a = smoothstep(0.5 - w, 0.5 + w, num / den);
  return invert > 0.5 ? 1.0 - a : a;
}

half4 main(float2 p) {
  float4 c;
  if (kind > 0.5 && kind < 1.5) {
    // Glitch: faixas horizontais que pulam de lado e cores separadas, mudando 12x por segundo.
    float step = floor(time * 12.0);
    float band = floor(p.y / max(1.0, size.y * 0.035));
    float r = hash(float2(band, step));
    float shift = r > 0.78 ? (hash(float2(step, band + 7.0)) - 0.5) * size.x * 0.14 * amount : 0.0;
    float split = size.x * 0.01 * amount * (0.4 + hash(float2(step, 3.0)));
    float2 q = p + float2(shift, 0.0);
    float4 base = fetch(q);
    c = float4(fetch(q + float2(split, 0.0)).r, base.g, fetch(q - float2(split, 0.0)).b, base.a);
  } else if (kind > 1.5 && kind < 2.5) {
    float s = size.x * 0.012 * amount;
    float4 base = fetch(p);
    c = float4(fetch(p + float2(s, 0.0)).r, base.g, fetch(p - float2(s, 0.0)).b, base.a);
  } else if (kind > 3.5 && kind < 4.5) {
    float cell = max(1.0, size.x * 0.05 * amount);
    c = fetch((floor(p / cell) + 0.5) * cell);
  } else {
    c = fetch(p);
  }
  if (kind > 2.5 && kind < 3.5) {
    // Granulado com linhas de TV antiga que rolam.
    float n = hash(p + float2(time * 61.0, time * 17.0)) - 0.5;
    float lines = 0.5 + 0.5 * sin(p.y * 1.7 + time * 30.0);
    float3 rgb = c.rgb + float3(n * 0.22 * amount) * c.a - float3(lines * 0.08 * amount) * c.a;
    c = float4(clamp(rgb, float3(0.0), float3(c.a)), c.a);
  }
  if (kind > 4.5 && kind < 5.5) {
    // Flash branco duas vezes por segundo.
    float f = pow(max(0.0, sin(time * 6.2831853 * 2.0)), 12.0) * amount;
    c = float4(mix(c.rgb, float3(c.a), f), c.a);
  }
  if (keyOn > 0.5) {
    float a = max(c.a, 0.0001);
    float3 rgb = c.rgb / a;
    float cb = -0.168736 * rgb.r - 0.331264 * rgb.g + 0.5 * rgb.b;
    float cr = 0.5 * rgb.r - 0.418688 * rgb.g - 0.081312 * rgb.b;
    float d = distance(float2(cb, cr), keyCbCr);
    float alpha = smoothstep(similarity, similarity + smoothness, d);
    // Vazamento: perto da cor tirada, a cor perde a saturação.
    float spill = 1.0 - smoothstep(similarity, similarity + smoothness + 0.12, d);
    float l = dot(rgb, float3(0.2126, 0.7152, 0.0722));
    rgb = mix(rgb, float3(l), spill * 0.7);
    float na = c.a * alpha;
    c = float4(rgb * na, na);
  }
  if (maskOn > 0.5) c *= cutoutAlpha(p);
  return half4(c);
}
`;

let fxCached: SkRuntimeEffect | null | undefined;

export function fxEffect(): SkRuntimeEffect | null {
  if (fxCached === undefined) fxCached = Skia.RuntimeEffect.Make(FX_SKSL);
  return fxCached;
}

/**
 * Contorno do recorte enquanto ele é feito: uma linha de luz na borda da
 * máscara (probabilidade perto de 0,5), com um brilho que corre devagar. Só no
 * palco do laço, nunca na exportação.
 */
export const CUTOUT_EDGE_SKSL = `
uniform shader mask;
uniform float2 size;
uniform float maskSize;
uniform float time;
uniform float4 color;

float cell(float2 q) {
  return float(mask.eval(clamp(q, float2(0.0), float2(maskSize - 1.0)) + 0.5).r);
}

half4 main(float2 p) {
  float2 m = p / size * maskSize - 0.5;
  float2 b = floor(m);
  float2 f = m - b;
  float pr = mix(mix(cell(b), cell(b + float2(1.0, 0.0)), f.x), mix(cell(b + float2(0.0, 1.0)), cell(b + float2(1.0, 1.0)), f.x), f.y);
  float d = (pr - 0.5) / 0.2;
  float band = exp(-d * d);
  float wave = 0.6 + 0.4 * sin(time * 2.2 - (p.x + p.y) / max(size.x, size.y) * 16.0);
  float a = band * wave * color.a;
  return half4(half3(color.rgb * a), half(a));
}
`;

let edgeCached: SkRuntimeEffect | null | undefined;

export function cutoutEdgeEffect(): SkRuntimeEffect | null {
  if (edgeCached === undefined) edgeCached = Skia.RuntimeEffect.Make(CUTOUT_EDGE_SKSL);
  return edgeCached;
}
