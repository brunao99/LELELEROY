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

### BUG-011: limpar os caches quebrava projetos com velocidade ou fade

- Severidade: S2
- Fluxo: F17 (configurações) depois F01 (abrir e exportar)
- Passos: aplicar 2x num clipe, esperar o processamento, ir em Configurações > Limpar caches, abrir o projeto
- Esperado: o editor refaz as cópias, como o aviso promete
- Real: o projeto ainda apontava para `baked/` e `rendered/`, que tinham sido apagadas; a prévia e a exportação tentariam abrir arquivos inexistentes
- Evidência: `clearCaches()` em `settings.tsx` apaga as pastas; `pruneBakes`/`bakeFileExists` existiam mas ninguém chamava
- Status: corrigido (ao abrir, `reconcileFiles` esquece o que sumiu e o editor refaz; 3 testes)

### BUG-012: cópias aceleradas e áudios processados nunca eram apagados

- Severidade: S3
- Passos: trocar a velocidade de um clipe várias vezes
- Real: cada velocidade deixava um MP4 em `baked/` para sempre
- Status: corrigido (ao abrir o editor, `unusedCaches` apaga o que nenhum clipe usa; 2 testes)

### BUG-013: exportar durante o processamento gravava o mesmo arquivo duas vezes

- Severidade: S2
- Fluxo: F01 (exportar)
- Passos: mudar a velocidade de um clipe e tocar em Exportar antes de terminar "Aplicando velocidade"
- Esperado: um processamento só
- Real: o editor (por baixo) e a exportação processavam a mesma cópia ao mesmo tempo, no mesmo arquivo; um podia apagar o arquivo do outro no meio e a exportação usar um vídeo pela metade
- Status: corrigido (a exportação pausa o editor, espera o que está rodando e aproveita o resultado; 3 testes)

### BUG-014: a resolução escolhida na exportação voltava ao valor antigo

- Severidade: S3
- Passos: em Exportar, trocar 1080p por 720p, voltar ao editor, editar algo, abrir Exportar de novo
- Real: o salvamento automático do editor gravava por cima a configuração antiga
- Status: corrigido (a escolha também vai para o projeto aberto no editor)

### BUG-015: o app fechava ao abrir um vídeo para editar (Android)

- Severidade: S1
- Fluxo: F01 (criar projeto)
- Build: APK 0.1.0 nº 1, Samsung (One UI)
- Passos: Novo projeto, escolher um vídeo
- Esperado: o editor abre com o vídeo
- Real: "o app Bobina apresenta falhas contínuas"
- Causa: a leitura do primeiro quadro rodava o extrator da skia-video numa thread sem contexto OpenGL; no Android ele lança "Skia context is not initialized" fora do tratamento de erros
- Evidência: `EGLUtils.getCurrentContextOrThrows()` em `VideoCompositionFramesExtractorSync.start()`; a exportação e a velocidade criavam a superfície antes, a leitura não
- Status: corrigido (superfície do Skia antes de ler; a prévia também garante o contexto e mostra erro em vez de fechar). Confirmado pelo usuário no APK nº 3.
- Também: tela de erro com "Compartilhar erro" para qualquer erro que fecharia o app.

## A verificar no aparelho

- Desempenho do preview com 3+ vídeos 1080p ao mesmo tempo (transição + sobreposição).
- Vídeos HDR (iPhone, Pixel, Samsung com HDR10+): o motor entrega o quadro sem conversão de cor (Android: MediaCodec direto numa textura; iOS: AVAssetReader em BGRA sem `AVVideoColorPropertiesKey`). Devem sair lavados. Teste: gravar 5 s em HDR, importar e comparar com a galeria.
- Mídia ausente: apagar um arquivo de `media/` de um projeto (só dá com acesso à pasta do app) e conferir aviso, clipe marcado e Substituir.
- Exportação 2K/4K em aparelhos médios.
- Legendas: tempo de transcrição com o modelo padrão num vídeo de 1 minuto.
- Projeto só com fotos: o relógio próprio do preview (sem vídeo para dar o tempo).
- Gestos da timeline dentro da rolagem (alças × rolar) no Android e no iOS.
- iOS inteiro: este ambiente não compila iOS (precisa de Mac ou EAS Build).

Resumo: 15 bugs, 0 abertos (S1: 3, S2: 8, S3: 4, todos corrigidos). BUG-011 a 014 apareceram na revisão final do código.

### BUG-016: legendas automáticas cortavam palavras e liam ruído como fala
- Severidade: S2
- Passos: gerar legendas de um vídeo com música, pausas ou barulho.
- Esperado: legendas com palavras inteiras, divididas em pausas e frases, sem texto inventado.
- Obtido: o Whisper recebia "no máximo 42 caracteres" e cortava no meio do token ("para ed" / "itar"); as legendas seguiam esses cortes; trechos de música viravam frases ("Legendas pela comunidade Amara.org") e o tempo das primeiras palavras caía segundos antes da fala.
- Evidência: áudio de teste de 37 s (fala sintética em pt-BR + música + estalos) transcrito com whisper.cpp aqui; a configuração antiga reproduz "ed|itar".
- Correção: patch no whisper.rn devolve tokens com tempo e probabilidade; detector de voz (Silero) e transcrição só dos trechos com fala, emendados, com os tempos devolvidos ao lugar; legendas montadas pelo app palavra por palavra (blocos por pausa/frase e quebras ótimas); filtros de marcas de som, frases inventadas, baixa confiança e laços. No mesmo áudio, o modelo "Preciso" acertou o texto inteiro com os tempos dentro de ~0,2 s.
- Status: corrigido (commit local, ainda não enviado)
