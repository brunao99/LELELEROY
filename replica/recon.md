# Mapa de reconhecimento: CapCut (Android + iOS)

Escopo: editor de vídeo que trabalha só com a mídia do próprio usuário. Importar
vídeos, fotos e áudios do aparelho, montar na timeline, cortar, dividir, mudar a
velocidade, pôr texto, filtros, transições e legendas automáticas, e exportar um
MP4. Sem biblioteca de músicas, sem download de vídeos, sem modelos prontos, sem
IA além das legendas automáticas.
Para: projeto pessoal / estudo.
Data: 2026-10-13

## Fontes

| # | fonte | URL | notas |
| --- | --- | --- | --- |
| 1 | página do editor (desktop) | https://www.capcut.com/pt-br/tools/desktop-video-editor | lista de recursos: keyframes, roda de cores, legendas automáticas, proporção mantendo o assunto, exportação |
| 2 | App Store (EUA) | https://apps.apple.com/us/app/-/id1500855883 | recursos do app mobile; nota 4,6 (1,1 mi de avaliações); iOS 15+; 824,6 MB; versão 19.7.0; assinaturas de US$ 7,99 a 19,99/mês e US$ 89,99/ano |
| 3 | termos de uso | https://www.capcut.com/clause/terms-of-service | ver "Termos" abaixo |
| 4 | guia hooked.so (terceiro) | https://www.hooked.so/guides/how-to-use-capcut | novo projeto, alças de corte, dividir, texto, legendas, exportação (720p, 1080p, 2K, 4K), clipe final com a marca do CapCut |
| 5 | guia unifab (terceiro) | https://unifab.ai/resource/how-to-use-capcut.htm | Formato, Editar (espelhar, girar), Velocidade (Normal 0,1x a 100x, Curva, manter tom), Áudio (Sons, Extraído, Narração, Efeitos), Legendas automáticas (origem, idioma, edição em lote), Sobreposição, chroma key, o que precisa de internet |
| 6 | guia miracamp (terceiro) | https://www.miracamp.com/learn/capcut/how-to-add-text | painel de texto (estilo, tamanho, cor, contorno, sombra, animação de entrada, saída e loop), legendas automáticas |
| 7 | prints do app no celular do usuário | `replica/screens/` | **pendente**. Lista do que tirar em `screens/LEIA-ME.md` |

As fontes 4 a 6 são guias de terceiros e os nomes dos botões mudam entre versões.
Ainda não vimos o app ao vivo: os estados listados nas telas são os que as fontes
citam mais os obrigatórios de qualquer app mobile. Os prints da fonte 7 confirmam
ou corrigem.

### Termos

- A seção 5, item 2 proíbe engenharia reversa e descompilação, e também "determinar
  ou tentar determinar o código-fonte, algoritmos, métodos ou técnicas" do serviço.
  O item 9 proíbe scripts automatizados. Por isso **ninguém abre a pasta de
  instalação, os arquivos internos ou o tráfego de rede do CapCut**.
- A seção 9 diz que os materiais do CapCut (efeitos, filtros, fontes, figurinhas,
  músicas) só podem ser usados nos projetos do usuário dentro do CapCut. Nada disso
  entra no nosso app: os filtros, transições e estilos são feitos do zero e as
  fontes são abertas.
- Nenhuma cláusula proíbe criar um produto concorrente nem tirar prints do uso
  normal. Usar o app como usuário e fotografar as telas é permitido.

## Loop principal

Juntar clipes do próprio celular, cortar o que não presta, pôr texto, legenda e
música, e exportar um MP4 pronto para postar.

## Telas

| ID | tela | como chegar | para que serve | componentes principais | estados | fontes |
| --- | --- | --- | --- | --- | --- | --- |
| S01 | Início (projetos) | abrir o app | ver, abrir e criar projetos | botão Novo projeto; cards de projeto (miniatura, nome, duração, data); menu ⋯ (renomear, duplicar, excluir) | vazio (primeiro uso), com projetos, carregando, projeto com mídia ausente | 4, 5 |
| S02 | Seletor de mídia | S01 › Novo projeto; S03 › + | escolher vídeos e fotos na ordem | abas Vídeos / Fotos; grade de miniaturas com duração; número de ordem ao selecionar; botão Adicionar (n) | sem permissão, permissão parcial (Android 14+, iOS "acesso limitado"), galeria vazia, carregando, arquivo na nuvem baixando, formato não suportado | 4, 5 |
| S03 | Editor | S02 › Adicionar; S01 › tocar projeto | montar o vídeo | barra superior (fechar, resolução, Exportar); preview (play/pause, tempo atual/total, desfazer/refazer, tela cheia); timeline (régua, agulha fixa no centro, faixa principal com miniaturas, faixas de texto, áudio, sobreposição e legendas, botão + no fim, silenciar áudio dos clipes, capa); barra de ferramentas (Editar, Áudio, Texto, Sobreposição, Filtros, Ajustar, Legendas, Formato, Fundo) | carregando miniaturas, reproduzindo, pausado, item selecionado, mídia ausente, salvando | 4, 5, 6 |
| S04 | Ferramentas do clipe | S03 › tocar clipe | editar um clipe | alças de corte nas pontas; barra: Dividir, Velocidade, Volume, Excluir, Duplicar, Editar, Extrair áudio, Filtros, Ajustar, Opacidade, Animação, Substituir, Congelar, Inverter | Dividir desativado com a agulha na borda, clipe muito curto | 4, 5 |
| S05 | Velocidade | S04 › Velocidade | mudar a velocidade | abas Normal / Curva; slider 0,1x a 100x; manter tom de voz; duração resultante; ✓ | — | 5 |
| S06 | Volume e fade | S04 ou S09 › Volume / Fade | volume e entrada/saída gradual | slider de volume; sliders de fade in e fade out; ✓ | clipe sem áudio (desativado) | 5 (inferido) |
| S07 | Texto | S03 › Texto › Adicionar texto | criar e editar texto | campo + teclado; Estilo (fonte, tamanho, cor, contorno, sombra, fundo, opacidade, alinhamento); Animação (entrada, saída, loop, velocidade); caixa na preview com alças (mover, girar/escalar, editar, excluir) | texto vazio, texto longo, emoji e acentos | 5, 6 |
| S08 | Adicionar áudio | S03 › Áudio | pôr som no projeto | Importar do aparelho; Extraído (de um vídeo); Narração. O CapCut tem também Sons e Efeitos, fora do escopo | sem permissão de microfone, gravando, formato não suportado, vídeo sem áudio | 5 |
| S09 | Ferramentas do áudio | S03 › tocar áudio | editar um áudio | forma de onda; alças de corte; barra: Volume, Fade, Dividir, Velocidade, Excluir, Duplicar | — | 5 |
| S10 | Filtros | S04 › Filtros ou S03 › Filtros | aplicar um visual pronto | grade de filtros com o quadro atual; slider de intensidade; aplicar a todos; ✓ | — | 1, 2 |
| S11 | Ajustar | S04 › Ajustar ou S03 › Ajustar | correção de cor manual | brilho, contraste, saturação, exposição, temperatura, matiz, nitidez, realces, sombras, vinheta; slider centrado em zero; redefinir; aplicar a todos | — | 1, 2 |
| S12 | Transições | S03 › ícone entre dois clipes | transição entre clipes | grade de transições; slider de duração; aplicar a todos; ✓ | clipes curtos limitam a duração máxima | 2 (inferido) |
| S13 | Formato | S03 › Formato | proporção do vídeo | 9:16, 16:9, 1:1, 4:3, 3:4, 4:5, Original | — | 5 |
| S14 | Fundo | S03 › Fundo | preencher as sobras do quadro | Cor; Desfoque (níveis); Imagem do aparelho | — | inferido, confirmar |
| S15 | Legendas automáticas | S03 › Texto › Legendas automáticas | gerar legendas pela fala | origem (áudio do vídeo, narração, ambos); idioma; substituir legendas atuais; Iniciar | sem fala detectada, gerando (progresso), erro, sem internet (no CapCut precisa), concluído | 4, 5, 6 |
| S16 | Edição em lote | S15 › concluído › Editar em lote | corrigir todas as legendas | lista com tempos; edição do texto na linha; dividir e juntar; excluir; estilo para todas | lista vazia | 5 |
| S17 | Exportar | S03 › resolução / Exportar | gerar o MP4 | resolução (720p, 1080p, 2K, 4K conforme o aparelho); fps (24 a 60, confirmar); tamanho estimado; Exportar; progresso (%, cancelar); concluído (salvo na galeria, compartilhar) | sem espaço, falha, cancelado, app em segundo plano | 4, 5 |
| S18 | Sobreposição | S03 › Sobreposição › Adicionar | vídeo ou foto por cima do principal | seletor de mídia (S02); caixa na preview; opacidade; mistura; chroma key | — | 5 |
| S19 | Editar (enquadramento) | S04 › Editar | girar, espelhar, recortar | Espelhar; Girar 90°; Recortar com proporções | — | 5 |
| S20 | Configurações | S01 › engrenagem | preferências | resolução padrão; limpar cache; licenças de código aberto | — | inferido |

## Fluxos

Os toques contam só o caminho feliz, com valores padrão.

```
F01 Criar um vídeo e exportar (loop principal)
    S01 -> S02 -> S03 -> S17
    toques: 6 com 3 clipes (Novo projeto, 3 clipes, Adicionar, Exportar)
    edge: permissão negada ou parcial; vídeo HEVC, HDR ou 60 fps; vertical e
          horizontal misturados; vídeo do iCloud ainda não baixado; app em
          segundo plano durante a exportação; sem espaço; arquivo de origem
          apagado depois

F02 Cortar as pontas de um clipe
    S03 -> S04 (arrastar alça)
    toques: 1 + arrasto
    edge: corte abaixo da duração mínima; clipe com velocidade alterada; desfazer

F03 Remover um trecho do meio
    S03 -> S04 (Dividir, Dividir, tocar trecho, Excluir)
    toques: 5 + 2 arrastos da timeline
    edge: agulha na borda do clipe; trecho com transição; os clipes seguintes
          fecham o espaço; textos em outras faixas não se mexem (confirmar)

F04 Reordenar clipes
    S03 (segurar e arrastar)
    toques: 1 gesto
    edge: arrastar até a borda (rolagem automática); transições presas ao clipe

F05 Mudar a velocidade
    S03 -> S04 -> S05
    toques: 4 (clipe, Velocidade, slider, ✓)
    edge: 100x num clipe curto (menos de um quadro); manter tom ligado e
          desligado; legendas e textos depois do clipe

F06 Adicionar texto
    S03 -> S07
    toques: 3 + digitação (Texto, Adicionar texto, ✓); arrastar na preview e
            esticar na timeline
    edge: texto longo; quebra de linha; emoji e acentos; texto fora da área
          depois de trocar o formato

F07 Pôr uma música própria
    S03 -> S08 -> seletor de arquivos -> S03
    toques: 4 (Áudio, Importar, arquivo, Usar)
    edge: formato não suportado; áudio mais longo que o vídeo; arquivo com DRM
          (Apple Music e Spotify não liberam)

F08 Gravar narração
    S03 -> S08
    toques: 4 (Áudio, Narração, segurar e soltar, ✓)
    edge: microfone negado; ligação durante a gravação; fone Bluetooth (atraso)

F09 Extrair o áudio de um vídeo
    S03 -> S08 -> S02
    toques: 4 (Áudio, Extraído, vídeo, Importar)
    edge: vídeo sem trilha de áudio

F10 Gerar e corrigir legendas automáticas
    S03 -> S15 -> S16
    toques: 3 + espera (Texto, Legendas automáticas, Iniciar); corrigir: 3 +
            digitação
    edge: vídeo sem fala; música alta por cima da voz; dois idiomas; sem
          internet; vídeo longo; clipe silenciado; cortar ou acelerar o vídeo
          depois de gerar (legendas saem de sincronia? confirmar); gerar de novo
          substitui as anteriores

F11 Aplicar filtro
    S03 -> S04 -> S10
    toques: 4 (clipe, Filtros, filtro, ✓); +1 para aplicar a todos

F12 Adicionar transição
    S03 -> S12
    toques: 3 (ícone entre clipes, transição, ✓); +1 para aplicar a todos
    edge: clipes mais curtos que a transição; transição entre foto e vídeo

F13 Mudar formato e fundo
    S03 -> S13 -> S14
    toques: 6 (Formato, 9:16, ✓, Fundo, Desfoque, ✓)
    edge: textos e sobreposições fora da área nova

F14 Sobrepor um vídeo (picture-in-picture)
    S03 -> S18 -> S02 -> S03
    toques: 4 + gesto (Sobreposição, Adicionar, mídia, Adicionar)
    edge: sobreposição maior que o vídeo principal; vários vídeos tocando juntos
          (limite de decodificadores no aparelho)

F15 Fechar e continuar depois
    S03 -> S01 -> S03
    toques: 2 (fechar, tocar projeto)
    edge: app morto pelo sistema no meio da edição; mídia apagada da galeria;
          projeto criado numa versão antiga do app

F16 Desfazer e refazer
    S03
    toques: 1
    edge: desfazer depois de reabrir o projeto; desfazer durante a reprodução

F17 Gerenciar projetos
    S01
    toques: 3 (⋯, ação, confirmar)
    edge: excluir projeto aberto; nome vazio ou repetido
```

## Componentes

| componente | variantes | estados | usado em |
| --- | --- | --- | --- |
| Botão | primário (Exportar), secundário, ícone, ícone com rótulo (barra de ferramentas) | normal, pressionado, desativado, carregando | todas |
| Barra de ferramentas inferior | principal, clipe, texto, áudio; rola na horizontal | item desativado | S03, S04, S09 |
| Painel inferior (bottom sheet) | com abas, simples; ✓ para confirmar | aberto, fechando | S05 a S16, S19 |
| Slider | linear, logarítmico (velocidade), centrado em zero (ajustes) | arrastando, valor exibido, redefinir | S05, S06, S10, S11, S12 |
| Grade de miniaturas | mídia, filtros, transições | selecionado, número de ordem, carregando, duração | S02, S10, S12 |
| Player (preview) | normal, tela cheia | reproduzindo, pausado, carregando, mídia ausente | S03 |
| Timeline | régua com zoom (pinça), agulha central, faixa de vídeo (miniaturas), faixa de áudio (forma de onda), barras de texto e legenda, alças de corte, ícone de transição, selo de velocidade, ímã | selecionado, arrastando, reordenando | S03 |
| Caixa de transformação | texto, sobreposição, clipe | selecionado, guias de alinhamento ao centro | S03, S07, S18 |
| Seletor de cor | paleta | selecionado | S07, S14 |
| Lista de fontes | prévia da fonte | selecionada, baixando | S07 |
| Abas (segmented control) | — | ativa | S02, S05, S07, S14 |
| Card de projeto | — | normal, mídia ausente | S01 |
| Menu de ações | ⋯ do projeto | — | S01 |
| Diálogo de confirmação | excluir, substituir legendas | — | S01, S15 |
| Toast | informação, erro | — | S03, S17 |
| Barra de progresso | exportação, legendas | andando, falhou, cancelado | S15, S17 |
| Estado vazio | início, galeria | — | S01, S02 |
| Pedido de permissão | galeria, microfone | antes de pedir, negado (abrir Configurações) | S02, S08 |

## Modelo de dados inferido

Vem do que as telas mostram. O formato interno do CapCut não é estudado (ver Termos).

```
Project      id, name, created_at, updated_at, aspect_ratio, canvas (cor | desfoque | imagem),
             export_resolution, export_fps, cover_time, thumbnail
             evidência: S01, S13, S14, S17, F15
             confiança: alta

MediaAsset   id, project_id, kind (video | image | audio), uri, duration, width, height,
             rotation, fps, has_audio, missing (bool)
             evidência: S02, S08, aviso de mídia ausente (inferido)
             confiança: alta (missing é palpite)

Track        id, project_id, kind (main | overlay | text | audio | caption), order, muted
             evidência: S03 (faixas separadas, silenciar áudio dos clipes)
             confiança: alta

Clip         id, track_id, asset_id, timeline_start, source_in, source_out, speed,
             keep_pitch, volume, fade_in, fade_out, transform (x, y, scale, rotation),
             crop, flip, opacity, filter (id, intensity), adjustments (mapa de valores),
             reversed, animation_in, animation_out
             evidência: S04, S05, S06, S10, S11, S19
             confiança: alta; duração na timeline = (source_out - source_in) / speed

Transition   id, clip_id (sai deste clipe para o seguinte), kind, duration
             evidência: S12
             confiança: alta

TextItem     id, track_id, timeline_start, duration, content, font, size, color, stroke,
             shadow, background, align, transform, animation_in, animation_out, animation_loop
             evidência: S07
             confiança: alta

Caption      id, track_id, start, end, text, language, words (texto e tempo de cada palavra)
             evidência: S15, S16
             confiança: média; words é palpite (só se houver destaque palavra por palavra)

CaptionStyle id, project_id, mesmos campos de estilo de TextItem
             evidência: S16 ("estilo para todas")
             confiança: média

AudioClip    usa Clip com asset de áudio; source (importado | extraído | narração)
             evidência: S08, S09
             confiança: alta

ExportJob    id, project_id, resolution, fps, status (rodando | concluído | falhou | cancelado),
             progress, output_uri
             evidência: S17
             confiança: alta
```

Relações: Project 1-n Track, Project 1-n MediaAsset, Track 1-n Clip, Clip n-1 MediaAsset,
Clip 1-0..1 Transition, Track 1-n TextItem, Track 1-n Caption, Project 1-1 CaptionStyle,
Project 1-n ExportJob.

Sem User: o app é pessoal, sem conta e sem servidor. Tudo fica no aparelho. O
desfazer/refazer é um histórico em memória por projeto.

## Matriz de recursos

Ver `features.csv`. Must: 37, should: 26, could: 27, skip: 12.

## Fora do escopo

- **Biblioteca de músicas e efeitos sonoros**: conteúdo licenciado do CapCut (seção 9) e decisão do usuário.
- **Banco de vídeos e fotos para baixar**: conteúdo licenciado e decisão do usuário.
- **Modelos (templates)**: conteúdo e rede de criadores do CapCut.
- **Efeitos, figurinhas, fontes e filtros do CapCut**: materiais deles. Os nossos são feitos do zero.
- **IA**: vídeo por texto (Seedance, Veo), avatar, dublagem, voz por IA, texto para fala, remover fundo, upscaler. Só as legendas automáticas entram.
- **Conta, login e espaço na nuvem**: projeto pessoal, sem servidor.
- **Compartilhar direto no TikTok**: integração de parceiro. Usamos a folha de compartilhar do sistema.
- **Câmera com efeitos e maquiagem**: o foco é editar.
- **Assinatura Pro e o clipe final com a marca do CapCut**: não se aplicam.

## Tamanho

Telas 20, fluxos 17, entidades 10.

Partes difíceis:

1. **Preview em tempo real** de várias faixas (vídeo, sobreposição, texto, filtros,
   transições) a 30 fps no celular. Precisa de decodificação de vídeo e GPU nativas;
   React Native sozinho não faz isso.
2. **Exportar igual ao preview.** O MP4 tem que sair idêntico ao que se vê. O ideal
   é o mesmo motor fazer os dois.
3. **Legendas automáticas.** Reconhecimento de fala no aparelho ou num serviço com
   chave própria, e manter os tempos certos depois de cortes e mudanças de velocidade.
   No CapCut isso exige internet (fonte 5).
4. **Timeline fluida**: pinça para zoom, alças, segurar para reordenar e ímã a 60 fps.
5. **Mídia de celular real**: HEVC, HDR, rotação, taxa de quadros variável, acesso
   parcial à galeria no Android e no iOS, arquivos que ainda estão no iCloud.
6. **Aparelhos fracos**: memória e o limite de vídeos decodificados ao mesmo tempo.

Tamanho: **L** (um trimestre de trabalho constante) para o núcleo: F01 a F07, F10,
F15 e F16. Tentar a matriz inteira vira XL. Não há promessa de clone perfeito.
