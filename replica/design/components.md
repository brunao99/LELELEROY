# Componentes do Bobina

Valores vêm de `tokens.json`. Nada de cor ou medida solta nos componentes.
Ícones: Lucide (ISC), via `lucide-react-native`. Nenhum ícone, ilustração ou
texto do CapCut.

Regras para todos:
- Área de toque mínima de 44 × 44 (`layout.touchMin`), mesmo quando o ícone é menor.
- Todo botão só com ícone tem `accessibilityLabel` em português.
- Estados desativados usam `opacity: .4` e `accessibilityState={{ disabled: true }}`.
- Feedback de toque: `Pressable` com fundo `surface-raised` ao pressionar.

```
Button
  variants  primary (accent / on-accent), secondary (surface-raised / text), ghost (transparente / text), danger (danger / text)
  sizes     sm 32, md 40, lg 48 de altura; padding horizontal space[4]
  states    normal, pressionado, desativado, carregando (spinner no lugar do ícone, rótulo mantido para o leitor de tela)
  tokens    radius md, type sm/600
  a11y      accessibilityRole="button"; carregando = accessibilityState.busy
  usado em  S01 (Novo projeto), S03 (Exportar), S15 (Iniciar), S17 (Exportar, Concluído)

ToolbarItem (ícone com rótulo)
  variants  normal, ativo (rótulo e ícone accent)
  states    normal, pressionado, desativado
  tokens    largura layout.toolbarItem, ícone 22, rótulo type.xs, cor text-muted
  a11y      role button, label = rótulo
  usado em  S03, S04, S09 (barra inferior), S08

Toolbar (barra inferior rolável)
  variants  principal, clipe, texto, áudio, legenda
  states    troca de modo com fade (motion.fast)
  tokens    altura layout.toolbar, fundo bg, borda superior border
  usado em  S03

BottomSheet (painel inferior)
  variants  simples, com abas; altura automática até 55% da tela
  partes    cabeçalho (título + ✓ confirmar), conteúdo, rodapé opcional ("Aplicar a todos")
  states    abrindo, aberto, fechando; arrastar para baixo fecha sem confirmar? Não: ✓ confirma, arrastar = cancelar
  tokens    fundo surface, radius lg no topo, shadow.sheet
  a11y      foco vai para o título ao abrir; botão ✓ com label "Confirmar"
  usado em  S05–S16, S19

Slider
  variants  linear, logarítmico (velocidade 0,1x–100x), centrado em zero (ajustes −100..100)
  states    parado, arrastando (valor em balão), desativado; duplo toque volta ao padrão
  tokens    trilho border, preenchido accent, polegar text 22px
  a11y      accessibilityRole="adjustable" com incrementos de 1 passo
  usado em  S05, S06, S07, S10, S11, S12, S14

SegmentedTabs (abas)
  states    ativa (sublinhado accent 2px, texto text), inativa (text-muted)
  usado em  S05, S07, S14, S15

ThumbGrid (grade de miniaturas)
  variants  filtros, transições, fontes
  states    normal, selecionado (borda accent 2px + selo), carregando (placeholder surface-raised)
  usado em  S07, S10, S12

Chip
  variants  proporções, idiomas, resoluções, fps
  states    normal (surface-raised), selecionado (accent / on-accent)
  usado em  S13, S15, S17

PreviewPlayer
  partes    tela Skia na proporção do projeto, fundo bg; barra com tempo atual / total (algarismos tabulares), play/pause, desfazer, refazer, tela cheia
  states    carregando (spinner), tocando, pausado, mídia ausente (aviso), erro do motor (mensagem + Tentar de novo)
  usado em  S03

TransformBox (caixa sobre o preview)
  partes    retângulo accent 1.5px; alças: excluir (sup. esq.), editar (sup. dir.), girar/escalar (inf. dir.), duplicar (inf. esq.)
  gestos    arrastar = mover; pinça = escalar; dois dedos girando = girar; imã no centro com guia tracejada e vibração leve
  usado em  S03, S07, S18

Timeline
  partes    Ruler (régua com marcas a cada intervalo, rótulos 00:05), Playhead (linha playhead 2px fixa no centro),
            TrackMain (miniaturas, altura trackMain), TrackRow (texto, áudio, legenda, sobreposição; altura trackSecondary),
            ClipView (cantos radius sm; selecionado = borda accent 2px + alças), TrimHandle (largura handleWidth, fundo accent, seta on-accent),
            TransitionButton (quadrado 22px entre clipes, ícone), SpeedBadge ("2.0x" sobre o clipe), Waveform (barras track-audio),
            AddButton (+ no fim da faixa principal), MuteToggle (à esquerda da faixa principal)
  gestos    arrastar = rolar o tempo; pinça = zoom (pxPerSecondMin..Max); tocar = selecionar; segurar e arrastar = reordenar;
            arrastar alça = cortar; imã na agulha e nas bordas (12 px) com vibração
  states    vazio (só o +), carregando miniaturas, item selecionado, arrastando, tocando (rola sozinha)
  a11y      cada ClipView tem label "Clipe 2, 4,5 segundos"; ações por accessibilityActions (dividir, excluir, mover)
  usado em  S03

ProjectCard
  partes    miniatura 16:9 (ou da proporção), nome, duração, data relativa, menu ⋯
  states    normal, pressionado, mídia ausente (selo)
  usado em  S01

ActionMenu (⋯)
  itens     Renomear, Duplicar, Excluir (danger)
  usado em  S01

ConfirmDialog
  variants  normal, destrutivo (botão danger)
  usado em  S01 (excluir), S15 (substituir legendas)

Toast
  variants  info (surface-raised), erro (danger à esquerda)
  states    entra de baixo, some em 2,5 s, pode ser tocado para fechar
  usado em  S03, S17

ProgressBar
  variants  determinada (%), indeterminada
  states    andando, concluído, falhou, cancelado
  usado em  S15, S17, aplicar velocidade

EmptyState
  partes    ícone Lucide 40px text-faint, título, texto, botão primário
  usado em  S01 (sem projetos), S16 (sem legendas)

PermissionPrompt
  partes    explica por que pede (microfone, galeria para salvar), botão Permitir; se negado, "Abrir Configurações"
  usado em  S08 (microfone), S17 (salvar na galeria)
```
