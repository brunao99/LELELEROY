# Paridade: Bobina × CapCut (celular)

Data: 2026-10-13. Branch `claude/blissful-knuth-kbt5wj`.

```bash
python3 .claude/skills/replica-diff/parity.py replica/features.csv
```

## Placar

| medida | valor |
| --- | --- |
| recursos (ponderado: must 3, should 2, could 1; parcial vale metade) | **88,2 / 100** |
| must-haves feitos | **36 de 37** (falta HDR, parcial) |
| linhas contadas | 90 (12 deixadas de fora de propósito, abaixo) |
| layout (prints lado a lado) | não medido: sem prints do original nem do app rodando |

**Importante:** é uma pontuação de código. Cada linha marcada `yes` está
implementada e, onde dá, coberta por teste unitário (129 testes passando), mas
nada rodou num celular ainda. Este ambiente não tem emulador (sem KVM) nem Mac.
O número vale como "o que foi construído", não como "o que foi visto
funcionando".

## Por área, da mais fraca para a mais forte

| área | nota | recursos |
| --- | --- | --- |
| efeitos | 0,0 | 1 |
| configurações | 50,0 | 1 |
| velocidade | 71,4 | 4 |
| sobreposição | 75,0 | 3 |
| clipe | 78,3 | 14 |
| filtros | 83,3 | 6 |
| formato | 83,3 | 3 |
| importação | 84,6 | 5 |
| exportação | 87,5 | 8 |
| áudio | 90,5 | 10 |
| editor | 91,7 | 10 |
| texto | 94,7 | 8 |
| legendas | 94,7 | 8 |
| projetos | 100,0 | 6 |
| transições | 100,0 | 3 |

As áreas fracas são feitas só de recursos "could" (efeitos de vídeo, curvas de
velocidade, chroma key, keyframes). O núcleo (projetos, timeline, cortes,
texto, áudio, legendas, transições, exportação) está completo.

## O que falta, na ordem de construir

1. **[must] HDR sem mapeamento de tom** (importação). Vídeos HDR (padrão no
   iPhone 12 em diante; opcional em Pixel e Samsung) devem sair com as cores
   lavadas. Causa, lida no código aberto do motor: no Android o MediaCodec
   decodifica direto numa textura sem pedir conversão para SDR; no iOS o
   AVAssetReader entrega BGRA sem `AVVideoColorPropertiesKey`. Não foi feito
   às cegas porque o resultado depende do aparelho (o iOS pode já converter;
   alguns Android convertem no decodificador). Plano: detectar a curva do
   vídeo na importação (caixa `colr` do MP4/MOV: PQ = 16, HLG = 18), guardar no
   `MediaAsset` e converter no shader de cor (curva → luz linear → compressão
   dos realces → BT.2020 para BT.709 → sRGB), só depois de confirmar num
   aparelho como o quadro chega.
2. [could] Congelar quadro.
3. [could] Escolher a capa do vídeo (o modelo já tem `coverTime`; falta a tela).
4. [could] Preview em tela cheia.
5. [could] Reproduzir ao contrário.
6. [could] Keyframes, máscaras, chroma key, curvas de velocidade, efeitos de
   vídeo, roda de cores, filtro como camada, destaque palavra por palavra,
   importar fonte, marcar batidas, redução de ruído, estabilização,
   reenquadrar automático, câmera lenta por fluxo óptico, exportar em HDR,
   exportar em segundo plano.
7. [could, parcial] Configurações: falta a resolução padrão para projetos
   novos (hoje fica salva por projeto). Pré-visualizar mídia antes de
   adicionar: o seletor do sistema já mostra.

## Deixado de fora de propósito (não conta no placar)

| recurso | motivo |
| --- | --- |
| Biblioteca de músicas e efeitos sonoros | conteúdo licenciado do CapCut (termos, seção 9) e decisão sua |
| Banco de vídeos e fotos para baixar | conteúdo licenciado e decisão sua |
| Modelos (templates), figurinhas, efeitos e modelos de texto do CapCut | materiais do CapCut (termos, seção 9) |
| IA generativa, remover fundo, voz por IA, texto para fala | fora do escopo escolhido (só legendas automáticas) |
| Conta, login, nuvem, assinatura Pro | projeto pessoal, sem servidor |
| Compartilhar direto no TikTok | integração de parceiro; usa a folha de compartilhar do sistema |
| Câmera com efeitos | o foco é editar |
| Clipe final com a marca do CapCut | é a marca deles |

## Diferenças de comportamento

Comparando os fluxos do mapa (`recon.md`, fontes públicas) com o que o Bobina faz.

| fluxo | CapCut | Bobina | decisão |
| --- | --- | --- | --- |
| F01 criar e exportar | 6 toques: o botão de exportar já começa | 7 toques: a tela de exportar mostra resolução, fps e tamanho antes | manter (um toque a mais, sem surpresa no tamanho do arquivo) |
| F05 velocidade | aplica na hora na prévia | prévia a 1x por alguns segundos ("Aplicando velocidade"), depois toca na velocidade certa | manter por ora: o motor só toca a 1x; resolver exige código nativo |
| F07 fades e volume acima de 100% | na hora | processados em segundo plano, como a velocidade | manter (mesmo motivo) |
| F10 legendas | transcrição na nuvem, exige conta | no celular (Whisper), funciona sem internet depois de baixar o modelo (57 MB) | manter: privacidade e sem servidor |
| F15 mídia apagada da galeria | a confirmar no app | o projeto guarda uma cópia; apagar da galeria não afeta | manter (gasta mais espaço; Configurações mostra quanto) |
| F01 exportação em segundo plano | a confirmar | sair do app interrompe; a tela fica ligada durante a exportação | corrigir depois (could) |
| F01 final do vídeo | clipe com a marca do CapCut | nada é acrescentado | manter |

## Veredito

- Pela regra do Replica: **ainda não publicável**, porque 1 must-have (HDR)
  está parcial. Nenhum bug S1 ou S2 aberto (14 encontrados, 14 corrigidos;
  `bugs.md`).
- Para o objetivo do projeto (uso pessoal e estudo): **pronto para testar no
  celular**. O próximo passo de verdade é instalar o APK e passar pela lista
  "A verificar no aparelho" de `bugs.md`; HDR entra na mesma rodada.
- "Melhor que o original" não se aplica: a etapa de concorrência
  (replica-entrepreneur) não rodou, porque o app não vai ser vendido.

## As 5 próximas coisas a construir

1. Instalar no celular e rodar os flows do Maestro (`bobina/e2e/`).
2. HDR para SDR, guiado pelo teste no aparelho (item 1 da lista acima).
3. Tela para escolher a capa do vídeo.
4. Congelar quadro (vira um clipe de foto com o quadro atual).
5. Preview em tela cheia.

Layout: quando houver prints, salve os do CapCut em `replica/screens/` e os do
Bobina em `replica/clone-screens/` (mesmo celular, mesmo estado) e rode
`python3 .claude/skills/replica-diff/imgdiff.py replica/screens/S07.png replica/clone-screens/S07.png --out replica/diffs/S07.png`.
