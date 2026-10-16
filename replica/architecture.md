# Arquitetura: Bobina (editor de vídeo mobile com os recursos centrais do CapCut)

"Bobina" é o nome de trabalho (ver `replica/brand.md`). Projeto pessoal: sem
conta, sem servidor, sem pagamentos. Tudo roda e fica no aparelho.

## Stack

| camada | escolha | por quê |
| --- | --- | --- |
| app | Expo SDK 57 (React Native 0.87, nova arquitetura) + TypeScript | um código para Android e iOS; o Expo cuida de build, permissões e módulos nativos |
| navegação | expo-router | rotas por arquivo, padrão do Expo |
| build | development build (expo-dev-client) + EAS Build ou `expo run:android` | as bibliotecas de vídeo têm código nativo, então o Expo Go não serve |
| desenho do vídeo | @shopify/react-native-skia 2.14 | GPU, filtros, texto (Paragraph), transformações; o mesmo código desenha o preview e a exportação |
| motor de vídeo | @azzapp/react-native-skia-video 0.10.1 | decodifica vários vídeos por quadro, toca o áudio em sincronia, mistura o áudio e exporta MP4 (H.264 + AAC) usando a **mesma** função `drawFrame` do preview |
| animação e gestos | react-native-reanimated 4 + react-native-worklets + react-native-gesture-handler | timeline a 60 fps rodando na thread de UI |
| estado | zustand + funções puras em `src/core` | o modelo e as operações são TypeScript puro, testável sem aparelho |
| desfazer/refazer | pilha de snapshots imutáveis | as operações devolvem um novo projeto; guardar o anterior custa pouco |
| armazenamento | expo-file-system: uma pasta por projeto com `project.json` e as mídias copiadas | sem banco: um projeto é um documento; ver "Esquema" |
| importar vídeo e foto | expo-image-picker (seletor do sistema, várias seleções em ordem) | Android Photo Picker e iOS PHPicker não pedem permissão de galeria |
| normalizar fotos | expo-image-manipulator | converte HEIC, corrige a orientação EXIF e limita o tamanho a 4096 px |
| importar áudio | expo-document-picker | arquivos de áudio do próprio usuário |
| narração | expo-audio (gravador) | grava m4a com o microfone |
| miniaturas da timeline | expo-video-thumbnails | um quadro por intervalo, em cache |
| decodificar áudio (PCM) | react-native-audio-api 0.13 (FFmpeg incluso) | `decodeAudioData(arquivo, taxa)` devolve PCM já reamostrado: serve para as legendas (16 kHz), a forma de onda e o áudio com velocidade |
| legendas automáticas | whisper.rn 0.7 + modelo Whisper ggml baixado no primeiro uso | roda no aparelho, funciona sem internet depois do download (o CapCut precisa de internet) |
| salvar e compartilhar | expo-media-library + expo-sharing | grava o MP4 na galeria e abre a folha de compartilhar do sistema |
| manter a tela ligada | expo-keep-awake | o iOS e o Android cortam a GPU em segundo plano; a exportação precisa da tela ligada |
| fontes do texto | fontes OFL (Google Fonts) empacotadas no app | nada das fontes do CapCut |
| testes | Jest (núcleo), `tsc --noEmit`, ESLint | o núcleo roda e é testado aqui; as telas precisam de aparelho |

Uma pasta de dados e nenhum serviço. A única chamada de rede do app é o download
do modelo do Whisper (Hugging Face, `ggerganov/whisper.cpp`).

## Esquema

Sem servidor, sem SQL e sem `user_id`. O dono de tudo é o próprio aparelho. Um
projeto é um arquivo JSON versionado (`schemaVersion`) gravado de forma atômica
(grava num arquivo temporário e depois troca).

```
<documentos>/projects/<projectId>/
  project.json          o projeto (tipos abaixo)
  media/<assetId>.<ext> cópias das mídias importadas (vídeo .mp4, foto .jpg, áudio .m4a/.mp3/.wav)
  baked/<assetId>@<speed>.mp4   vídeos com velocidade aplicada (cache, pode ser apagado)
  baked/<assetId>@<speed>.wav   o áudio desses vídeos (cache)
  thumbs/<assetId>/<n>.jpg      miniaturas (cache)
  peaks/<assetId>.json          forma de onda (cache)
<documentos>/models/ggml-<modelo>.bin   modelo do Whisper (compartilhado)
<documentos>/exports/<projectId>-<data>.mp4  saída antes de ir para a galeria
```

Tempos em **microssegundos inteiros** (`Micros`) para não acumular erro de ponto
flutuante. O motor de vídeo recebe segundos; a conversão acontece só na borda.

```ts
type Micros = number
type Ratio = '9:16' | '16:9' | '1:1' | '4:3' | '3:4' | '4:5' | 'original'

interface Project {
  schemaVersion: 1
  id: string; name: string; createdAt: number; updatedAt: number
  ratio: Ratio
  background: { kind: 'color'; color: string } | { kind: 'blur'; amount: number } | { kind: 'image'; assetId: string }
  exportSettings: { resolution: 720 | 1080 | 1440 | 2160; fps: 24 | 25 | 30 | 50 | 60 }
  muteMain: boolean
  assets: Record<string, MediaAsset>
  main: MainClip[]            // faixa principal "magnética": sem buracos, a ordem define a posição
  overlays: OverlayClip[]     // sobreposições, com início livre e camada (layer)
  texts: TextItem[]
  audios: AudioClip[]
  captions: { items: Caption[]; style: TextStyle; language: string | null }
  coverTime: Micros | null
}

interface MediaAsset { id; kind: 'video' | 'image' | 'audio'; file: string; duration: Micros;
  width; height; rotation: 0 | 90 | 180 | 270; hasAudio: boolean; originalName: string }

interface ClipBase { id; assetId; sourceIn: Micros; sourceOut: Micros; speed: number;
  keepPitch: boolean; volume: number /* 0..2 */; fadeIn: Micros; fadeOut: Micros }

interface Visual { transform: { x; y; scale; rotation }; crop: { x; y; w; h } /* 0..1 */;
  flipH; flipV; opacity /* 0..1 */; filter: { id: string; intensity: number } | null;
  adjust: Adjustments; animIn; animOut }

interface MainClip extends ClipBase, Visual { transitionOut: { kind; duration: Micros } | null;
  reversed: boolean; freezeAt?: Micros }
interface OverlayClip extends ClipBase, Visual { start: Micros; layer: number; blend: BlendMode }
interface AudioClip extends ClipBase { start: Micros; layer: number; source: 'import' | 'extract' | 'voiceover' }
interface TextItem { id; start; duration; layer; text; style: TextStyle; transform; animIn; animOut; animLoop }
interface Caption { id; start: Micros; end: Micros; text: string }
```

Regras que o modelo garante (e os testes cobrem):

- Duração de um clipe na timeline = `(sourceOut - sourceIn) / speed`, com mínimo de 100 ms.
- Posição de um clipe da faixa principal = soma das durações anteriores menos as
  transições (a transição sobrepõe o fim de um clipe ao começo do próximo).
- Transição ≤ metade do clipe mais curto dos dois lados.
- Em cada camada (overlay, texto, áudio) os itens não se sobrepõem; ao adicionar,
  o item vai para a primeira camada livre.
- `sourceIn`/`sourceOut` sempre dentro da duração da mídia.

## Módulos internos (no lugar de uma API)

Não há rotas HTTP. Cada fluxo chama funções puras de `src/core`:

| função | faz | fluxo |
| --- | --- | --- |
| `createProject(assets)` | projeto novo com os clipes em ordem | F01 |
| `trimClip(p, id, edge, delta)` | corta a ponta respeitando os limites | F02 |
| `splitAt(p, id, t)` | divide na agulha | F03 |
| `removeItem(p, id)` | exclui e fecha o espaço da faixa principal | F03 |
| `moveMainClip(p, id, index)` | reordena | F04 |
| `setSpeed(p, id, speed, keepPitch)` | velocidade; agenda o "bake" | F05 |
| `addText / updateText` | texto | F06 |
| `addAudio(p, asset, t, source)` | música, narração, áudio extraído | F07–F09 |
| `applyCaptions(p, segments, mode)` | legendas automáticas | F10 |
| `setFilter / setAdjust (allClips?)` | filtros e ajustes | F11 |
| `setTransition (all?)` | transições | F12 |
| `setRatio / setBackground` | formato e fundo | F13 |
| `addOverlay` | sobreposição | F14 |
| `buildComposition(p)` | projeto → itens do motor (vídeo e áudio, em segundos) | preview e exportação |
| `buildRenderPlan(p)` | projeto → o que desenhar em cada instante | preview e exportação |

Trabalhos em segundo plano (no aparelho, sem agenda): gerar miniaturas, gerar a
forma de onda, aplicar a velocidade (bake), transcrever (Whisper), exportar.

## As partes que mordem

- **Preview igual à exportação**: `drawProject(canvas, plano, t, quadros)` é um
  único worklet. O preview chama a cada quadro da tela; a exportação, a cada quadro
  do arquivo. Nenhum efeito pode existir só num dos dois.
- **Velocidade**: o motor toca cada item a 1x. Ao mudar a velocidade, o app gera
  uma cópia do vídeo já acelerada ("bake") com o próprio motor e um WAV do áudio
  (reamostrado ou, com "manter tom", esticado no tempo por um WSOLA em TypeScript).
  Leva alguns segundos e fica em cache por (mídia, velocidade).
- **Formatos de celular**: arquivos `.MOV` do iPhone são gravados como `.mp4` na
  cópia (é o mesmo formato ISO-BMFF; o decodificador de áudio escolhe o FFmpeg pela
  extensão). Rotação (90°/270°) vem em cada quadro e é aplicada no desenho. HEVC
  depende do aparelho. HDR pode sair lavado (sem mapeamento de tom na v1).
- **Limite de decodificadores**: o Android limita vídeos decodificando ao mesmo
  tempo (`getDecodingCapabilitiesFor`). O preview reduz a resolução dos itens
  (`resolution`) para caber; a exportação usa a resolução cheia.
- **Precisão de tempo**: microssegundos inteiros no modelo; segundos só no motor.
- **Salvamento**: a cada alteração, com 400 ms de espera, gravação atômica. O app
  pode ser morto pelo sistema a qualquer momento.
- **Mídia apagada**: como o app guarda cópias, apagar da galeria não quebra o
  projeto. O custo é espaço; a tela de configurações mostra quanto e limpa caches.
- **Segundo plano**: a exportação mantém a tela ligada e avisa para não sair do app.
  Se o app sair, a exportação falha de forma limpa e pode ser refeita.
- **Legendas**: o modelo (57 MB no padrão, 181 MB no "melhor") é baixado uma vez.
  Áudio decodificado a 16 kHz mono; segmentos curtos (`maxLen` 42 com tempos por
  token). Os tempos da legenda são da timeline; se o vídeo for cortado ou acelerado
  depois, o app avisa que as legendas podem ter saído de sincronia.
- **Biblioteca beta**: a skia-video avisa que é beta. O acesso a ela fica isolado
  em `src/engine`, para dar para trocar por Media3 (Android) e AVFoundation (iOS)
  sem mexer nas telas.
- **Sem aparelho aqui**: este ambiente compila e testa o núcleo e tenta gerar o APK
  Android; o iOS só compila num Mac ou no EAS Build.

## Ordem de construção

1. **Fatia vertical**: S01 → S02 → S03 (preview + timeline simples) → S17. Importar
   3 vídeos, tocar, exportar o MP4 para a galeria. Prova o motor.
2. **Must**: cortar, dividir, excluir, reordenar, desfazer (S03, S04); velocidade
   (S05); volume (S06); texto (S07); áudio próprio (S08, S09); legendas (S15, S16);
   filtros e ajustes (S10, S11); transições (S12); formato (S13); resolução e
   progresso da exportação (S17).
3. **Should**: duplicar, girar/espelhar/recortar (S19), fundo (S14), sobreposição
   (S18), narração, extrair áudio, fade, forma de onda, edição em lote, fps,
   compartilhar, gerenciar projetos.
4. **Could**: o resto da matriz, por ordem de pedido do usuário.
5. **Correções do replica-entrepreneur**: não se aplica por enquanto (projeto pessoal).
