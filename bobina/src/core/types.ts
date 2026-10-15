/**
 * Modelo de dados do Bobina.
 *
 * Tempos são microssegundos inteiros (`Micros`). Posições e escalas visuais são
 * relativas ao quadro do projeto, para valer em qualquer resolução de saída.
 */

export type Micros = number;

export type Ratio = '9:16' | '16:9' | '1:1' | '4:3' | '3:4' | '4:5' | 'original';

export type AssetKind = 'video' | 'image' | 'audio';

export type Rotation = 0 | 90 | 180 | 270;

export interface MediaAsset {
  id: string;
  kind: AssetKind;
  /** Caminho relativo à pasta do projeto, por exemplo `media/abc.mp4`. */
  file: string;
  /** Duração da mídia. Fotos têm duração 0 (podem durar o quanto quiser na timeline). */
  duration: Micros;
  /** Dimensões do arquivo, antes da rotação. Zero para áudio. */
  width: number;
  height: number;
  /** Rotação que o vídeo pede ao ser exibido (metadado do celular). */
  rotation: Rotation;
  hasAudio: boolean;
  originalName: string;
}

/** Posição (fração do quadro a partir do centro, +x direita, +y baixo), escala (1 = cabe no quadro) e rotação em graus. */
export interface Transform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

/** Recorte normalizado (0..1) sobre a imagem já girada. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Ajustes manuais. Faixa −100..100, exceto nitidez e vinheta (0..100). */
export interface Adjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
  sharpen: number;
  vignette: number;
}

export interface FilterRef {
  id: string;
  /** 0..1 */
  intensity: number;
}

export type AnimKind =
  | 'none'
  | 'fade'
  | 'zoomIn'
  | 'zoomOut'
  | 'slideUp'
  | 'slideDown'
  | 'slideLeft'
  | 'slideRight'
  | 'spin'
  | 'pop';

export interface Anim {
  kind: AnimKind;
  duration: Micros;
}

export type LoopAnimKind = 'none' | 'pulse' | 'float' | 'blink' | 'wiggle';

export type BlendKind = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'add';

export interface Visual {
  transform: Transform;
  crop: Crop;
  flipH: boolean;
  flipV: boolean;
  /** 0..1 */
  opacity: number;
  filter: FilterRef | null;
  adjust: Adjustments;
  animIn: Anim;
  animOut: Anim;
}

export interface AudioProps {
  /** 0..2 (acima de 1 o som é amplificado no WAV processado) */
  volume: number;
  fadeIn: Micros;
  fadeOut: Micros;
}

export interface ClipBase extends AudioProps {
  id: string;
  assetId: string;
  /** Trecho usado da mídia, em tempo da mídia. */
  sourceIn: Micros;
  sourceOut: Micros;
  /** 0.1..100 */
  speed: number;
  /** Manter o tom de voz quando a velocidade muda. */
  keepPitch: boolean;
}

export type TransitionKind =
  | 'dissolve'
  | 'fadeBlack'
  | 'fadeWhite'
  | 'slideLeft'
  | 'slideRight'
  | 'slideUp'
  | 'slideDown'
  | 'zoomIn'
  | 'zoomOut'
  | 'wipeLeft'
  | 'wipeRight'
  | 'circle';

export interface Transition {
  kind: TransitionKind;
  duration: Micros;
}

export interface MainClip extends ClipBase, Visual {
  kind: 'main';
  /** Transição para o próximo clipe. Sempre `null` no último clipe. */
  transitionOut: Transition | null;
}

export interface OverlayClip extends ClipBase, Visual {
  kind: 'overlay';
  start: Micros;
  layer: number;
  blend: BlendKind;
}

export type AudioSource = 'import' | 'extract' | 'voiceover';

export interface AudioClip extends ClipBase {
  kind: 'audio';
  start: Micros;
  layer: number;
  source: AudioSource;
  name: string;
}

export type FontId =
  | 'inter'
  | 'montserrat'
  | 'bebas'
  | 'oswald'
  | 'robotoSlab'
  | 'lobster'
  | 'pacifico'
  | 'marker';

export interface TextStyle {
  font: FontId;
  /** Tamanho da letra como fração do lado menor do quadro. */
  size: number;
  color: string;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  italic: boolean;
  /** Largura do contorno como fração do tamanho da letra. */
  stroke: { color: string; width: number } | null;
  shadow: { color: string; blur: number; dx: number; dy: number } | null;
  background: { color: string; opacity: number; radius: number } | null;
  /** 0..1 */
  opacity: number;
  /** Em frações do tamanho da letra. */
  letterSpacing: number;
  lineHeight: number;
}

export interface TextItem {
  kind: 'text';
  id: string;
  start: Micros;
  duration: Micros;
  layer: number;
  text: string;
  style: TextStyle;
  transform: Transform;
  animIn: Anim;
  animOut: Anim;
  animLoop: LoopAnimKind;
}

/** Uma palavra falada, com o tempo dela na timeline. */
export interface CaptionWord {
  text: string;
  start: Micros;
  end: Micros;
}

export interface Caption {
  id: string;
  start: Micros;
  end: Micros;
  text: string;
  /**
   * Palavras com tempo, da transcrição automática. Quando existem, juntas com
   * espaço formam exatamente `text`; se o texto for reescrito, somem.
   */
  words?: CaptionWord[];
}

export type CaptionSource = 'video' | 'voiceover' | 'both';

export interface CaptionTrack {
  items: Caption[];
  style: TextStyle;
  /** Posição do centro da legenda, em fração do quadro a partir do centro. */
  position: { x: number; y: number };
  language: string | null;
  source: CaptionSource;
  /** Quando cortes ou mudanças de velocidade podem ter tirado as legendas de sincronia. */
  maybeOutOfSync: boolean;
}

export type Background =
  | { kind: 'color'; color: string }
  | { kind: 'blur'; amount: number }
  | { kind: 'image'; assetId: string };

export type ExportResolution = 720 | 1080 | 1440 | 2160;
export type ExportFps = 24 | 25 | 30 | 50 | 60;

export interface ExportSettings {
  resolution: ExportResolution;
  fps: ExportFps;
}

/** Cópia de um vídeo com a velocidade já aplicada (o motor toca tudo a 1x). */
export interface Bake {
  key: string;
  assetId: string;
  speed: number;
  keepPitch: boolean;
  /** Trecho da mídia original que a cópia cobre. */
  from: Micros;
  to: Micros;
  /** Caminhos relativos à pasta do projeto. */
  videoFile: string | null;
  audioFile: string | null;
}

/** Áudio de um clipe já processado (fades, e velocidade quando há fade), em WAV. */
export interface AudioRender {
  key: string;
  file: string;
}

export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  ratio: Ratio;
  background: Background;
  exportSettings: ExportSettings;
  muteMain: boolean;
  assets: Record<string, MediaAsset>;
  main: MainClip[];
  overlays: OverlayClip[];
  texts: TextItem[];
  audios: AudioClip[];
  captions: CaptionTrack;
  coverTime: Micros | null;
  bakes: Record<string, Bake>;
  audioRenders: Record<string, AudioRender>;
}

export type TimedItem = OverlayClip | AudioClip | TextItem;

export type ItemKind = 'main' | 'overlay' | 'audio' | 'text' | 'caption';

export interface ItemRef {
  kind: ItemKind;
  id: string;
}
