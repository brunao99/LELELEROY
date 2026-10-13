# Bobina

Editor de vídeo para Android e iOS com os recursos centrais do CapCut, feito do
zero (nada do código, dos efeitos, das fontes ou das músicas do CapCut).
Projeto pessoal: sem conta, sem servidor; tudo fica no celular.

## O que faz

- Projetos com vídeos e fotos do aparelho, salvos sozinhos, com desfazer/refazer.
- Timeline com miniaturas, agulha no centro, pinça para zoom, alças para cortar,
  dividir, excluir, duplicar, segurar e arrastar para reordenar, ímã com vibração.
- Velocidade de 0,1x a 100x (com ou sem manter o tom da voz).
- Texto com 8 fontes abertas, cor, contorno, sombra, fundo e animações.
- Áudio: música do aparelho, narração pelo microfone, som extraído de vídeos,
  volume até 200%, entrada e saída graduais, forma de onda.
- Legendas automáticas que rodam no celular (Whisper), em 7 idiomas, com edição
  em lote e estilo único para todas.
- 12 filtros, ajustes de cor (incluindo realces, sombras, nitidez e vinheta),
  12 transições, sobreposição com modos de mistura, girar/espelhar/recortar,
  proporções 9:16, 16:9, 1:1, 4:3, 3:4, 4:5 e fundo com cor, desfoque ou imagem.
- Exporta MP4 (H.264 + AAC) de 720p a 4K, 24 a 60 fps, salva na galeria e
  compartilha.

## Rodar no celular

O app usa bibliotecas com código nativo (Skia, motor de vídeo, Whisper), então o
**Expo Go não serve**: é preciso um build próprio.

### Android, sem computador potente: EAS Build (nuvem)

```bash
npm install
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile preview
```

No fim, o EAS mostra um link/QR code para baixar o APK no celular.

### Android, no computador (Android Studio instalado)

```bash
npm install
npx expo run:android --variant release
```

### iOS

Precisa de um Mac com Xcode (`npx expo run:ios`) ou do EAS Build
(`--platform ios`), que pede uma conta Apple Developer para instalar no iPhone.

## Desenvolver

```bash
npm install
npx expo run:android      # build de desenvolvimento + Metro
npm test                  # 129 testes do núcleo e do estado
npm run typecheck         # tsc --noEmit
npm run lint              # ESLint (Expo)
```

Testes de ponta a ponta no aparelho: [Maestro](https://maestro.mobile.dev),
`maestro test e2e/`.

## Organização

```
src/core      modelo, operações de edição, histórico, composição, cor, áudio (TypeScript puro, testado)
src/engine    desenho dos quadros (Skia), preview, exportação, velocidade, legendas, miniaturas
src/storage   projetos e mídias no disco
src/state     estado do editor (zustand)
src/features  telas do editor, timeline, painéis
src/ui        componentes do sistema visual (tokens em src/ui/theme.ts)
src/app       rotas (expo-router)
e2e           flows do Maestro
```

Planejamento e decisões: `../replica/` (`recon.md`, `architecture.md`,
`design/`, `test-plan.md`, `bugs.md`, `parity.md`).

## Limitações conhecidas

- A velocidade e os fades são processados em segundo plano depois da edição
  (alguns segundos): o motor de vídeo toca tudo a 1x com volume constante.
- Vídeos HDR podem sair com as cores lavadas (sem mapeamento de tom).
- A exportação para se o app for para segundo plano.
- O motor de vídeo (@azzapp/react-native-skia-video) ainda é beta.

## Licenças

Fontes: Inter, Montserrat, Bebas Neue, Oswald, Lobster, Pacifico (SIL OFL 1.1),
Roboto Slab, Permanent Marker (Apache 2.0) — textos em `assets/fonts/licenses/`.
Ícones: Lucide (ISC). Modelos de fala: whisper.cpp (MIT).
