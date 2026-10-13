# Bugs: Bobina

Encontrados construindo o app, por erro de build, teste ou leitura do código das
bibliotecas. Todos corrigidos antes de chegar a um aparelho. O que só dá para
confirmar no celular está em "A verificar".

### BUG-001: exportação podia gravar quadros incompletos

- Severidade: S1
- Fluxo: F01 (exportar)
- Build: antes do commit do motor
- Passos: exportar com @shopify/react-native-skia 2.6.2 (versão que o Expo escolhe)
- Esperado: cada quadro terminado antes de ir para o codificador
- Real: no Skia 2.6.2 `surface.flush()` não espera a GPU; a skia-video conta com `flush(true)` síncrono
- Evidência: `cpp/api/JsiSkSurface.h` do 2.6.2 chama `flushAndSubmit()` sem sincronizar; o 2.14 aceita `sync`
- Status: corrigido (Skia 2.14.0 fixado no package.json)

### BUG-002: o app não empacotava (legendas)

- Severidade: S1
- Fluxo: todos
- Passos: `npx expo export --platform android`
- Real: `Unable to resolve module buffer from node_modules/safe-buffer/index.js` (dependência do whisper.rn)
- Status: corrigido (pacote `buffer` instalado; o empacotamento passa)

### BUG-003: salvar na galeria quebraria no SDK 57

- Severidade: S2
- Fluxo: F01 (salvar)
- Real: `saveToLibraryAsync` do expo-media-library "will throw in runtime" no SDK 57 (tipos da biblioteca)
- Status: corrigido (usa `Asset.create`)

### BUG-004: vídeos em pé viravam projeto deitado no Android

- Severidade: S2
- Fluxo: F01-E1
- Real: o player da skia-video no Android sempre informa rotação 0 e às vezes 0×0; o formato "Original" sairia errado
- Evidência: `VideoPlayer.java` despacha `ready` com `{w, h, 0}`
- Status: corrigido (medidas e rotação lidas do primeiro quadro decodificado pelo mesmo motor)

### BUG-005: redução do preview distorceria vídeos girados no Android

- Severidade: S2
- Fluxo: F01-E1
- Real: a opção `resolution` é trocada de orientação pelo motor quando o vídeo tem rotação
- Status: corrigido (redução só no iOS)

### BUG-006: fades e volume acima de 100% não teriam efeito

- Severidade: S2
- Fluxo: F07
- Real: o motor só tem volume constante de 0 a 1
- Status: corrigido (áudio do clipe processado em WAV com fade e ganho; 5 testes)

### BUG-007: limite de decodificadores com muitos clipes

- Severidade: S2
- Fluxo: F01-E6
- Real: a skia-video abre um decodificador por vídeo, todos de uma vez; o Android limita
- Status: corrigido (janelas de no máximo 6 vídeos no preview e na exportação; 4 testes)

### BUG-008: preview gastando bateria parado

- Severidade: S3
- Real: o preview redesenhava todo quadro mesmo pausado
- Status: corrigido (parado, só redesenha 0,5 s depois de uma mudança)

### BUG-009: capa da tela inicial podia não carregar no Android

- Severidade: S3
- Real: `?v=` no fim de um `file://` atrapalha o carregamento
- Status: corrigido

### BUG-010: corrida ao trocar de motor no preview

- Severidade: S2
- Real: o quadro na thread de UI podia usar um decodificador já liberado
- Status: corrigido (troca e liberação na própria thread de UI)

## A verificar no aparelho

- Desempenho do preview com 3+ vídeos 1080p ao mesmo tempo (transição + sobreposição).
- Vídeos HDR (iPhone, Pixel): sem mapeamento de tom, podem sair lavados.
- Exportação 2K/4K em aparelhos médios.
- Legendas: tempo de transcrição com o modelo padrão num vídeo de 1 minuto.
- Projeto só com fotos: o relógio próprio do preview (sem vídeo para dar o tempo).
- Gestos da timeline dentro da rolagem (alças × rolar) no Android e no iOS.
- iOS inteiro: este ambiente não compila iOS (precisa de Mac ou EAS Build).

Resumo: 10 bugs, 0 abertos (S1: 2, S2: 6, S3: 2, todos corrigidos).
