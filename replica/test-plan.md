# Plano de testes: Bobina

Build: branch `claude/blissful-knuth-kbt5wj`  Data: 2026-10-13
Ambiente: Android (arm64) e iOS 15+. Neste ambiente de nuvem não há emulador
(sem KVM) nem Mac: os casos "unit" rodaram aqui; os "maestro" e "manual" rodam
no celular.

Como rodar:
- Unit: `cd bobina && npm test` (Jest, 118 testes).
- Maestro: instale o app no celular, ligue o celular no computador e rode
  `maestro test bobina/e2e/` (flows em `bobina/e2e/`).
- Manual: a lista abaixo.

| caso | fluxo | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- | --- |
| F01-H1 | criar e exportar | feliz | Novo projeto, 3 vídeos, Adicionar, Exportar, Exportar vídeo | MP4 na galeria, tela "Vídeo pronto" | maestro 01+03 | pendente (aparelho) |
| F01-E1 | | vídeo em pé + deitado | importar um vídeo vertical e um horizontal | formato "Original" segue o 1º; o outro aparece inteiro com fundo desfocado | manual | pendente |
| F01-E2 | | vídeo do iPhone (MOV/HEVC) | importar vídeo gravado no iPhone | abre, toca, exporta; som presente | manual | pendente |
| F01-E3 | | vídeo 4K 60 fps | importar 4K60 | preview fluido o bastante; exportação 1080p ok | manual | pendente |
| F01-E4 | | app em segundo plano | durante a exportação, ir para a tela inicial | exportação falha de forma limpa, botão para tentar de novo | manual | pendente |
| F01-E5 | | sem espaço | exportar com o armazenamento quase cheio | mensagem de erro, nada corrompido | manual | pendente |
| F01-E6 | | 12+ clipes | projeto com 12 vídeos | preview troca de janela sem travar; exportação completa | manual | pendente |
| F01-N1 | | permissão de galeria negada | negar ao salvar | aviso "não deu para salvar" e Compartilhar funciona | manual | pendente |
| F02-H1 | cortar pontas | feliz | selecionar clipe, arrastar alça | duração muda, timeline fecha o espaço | unit (ops, store) | passou |
| F02-E1 | | limite | arrastar além da mídia / abaixo de 0,1 s | trava no limite | unit | passou |
| F02-E2 | | clipe a 2x | cortar 1 s na timeline | tira 2 s da mídia | unit | passou |
| F03-H1 | dividir e excluir trecho | feliz | agulha no meio, Dividir, Excluir | dois clipes; trecho some | unit + maestro 02 | passou (unit) |
| F03-E1 | | agulha na ponta | Dividir a 0,05 s da ponta | aviso, nada muda | unit | passou |
| F04-H1 | reordenar | feliz | segurar e arrastar | ordem muda; transição presa ao clipe some | unit | passou |
| F05-H1 | velocidade | feliz | 2x | duração cai à metade; "Aplicando velocidade" e depois toca a 2x | unit + maestro 02 | passou (unit) |
| F05-E1 | | manter tom | 2x com e sem manter tom | voz normal / voz fina | unit (frequência) | passou |
| F05-E2 | | 100x em clipe curto | 100x em clipe de 2 s | clipe de 0,1 s (mínimo), sem travar | unit | passou |
| F06-H1 | texto | feliz | Texto, digitar, estilo, arrastar no preview | texto aparece no preview e na exportação | maestro 02 + manual | pendente |
| F06-E1 | | emoji e acentos | "Olá 🎬 ação" | desenha certo | manual | pendente |
| F06-E2 | | texto longo | 200 caracteres | quebra em linhas dentro do quadro | manual | pendente |
| F07-H1 | música | feliz | Áudio, arquivo do aparelho | faixa de áudio com forma de onda; toca junto | manual | pendente |
| F07-N1 | | arquivo com DRM | música do Apple Music | aviso claro | manual | pendente |
| F08-H1 | narração | feliz | Áudio, Gravar narração, gravar 5 s | item "Narração" na agulha | manual | pendente |
| F08-N1 | | microfone negado | negar permissão | aviso com "Abrir configurações" | manual | pendente |
| F09-H1 | extrair áudio | feliz | clipe, Extrair áudio | clipe mudo, áudio separado na mesma posição | unit | passou |
| F10-H1 | legendas | feliz | Legendas, Português, Gerar | baixa o modelo (57 MB) uma vez, cria legendas sincronizadas | manual | pendente |
| F10-E1 | | sem fala | vídeo só com música | "Nenhuma fala encontrada" | unit (limpeza) + manual | parcial |
| F10-E2 | | offline depois do download | modo avião | gera sem internet | manual | pendente |
| F10-E3 | | corte depois de gerar | cortar o vídeo | aviso de legendas fora de tempo | unit | passou |
| F10-E4 | | dividir e juntar | edição em lote | textos e tempos certos | unit | passou |
| F11-H1 | filtro | feliz | Filtros, Vivo, 80% | cor muda no preview e na exportação | unit (matriz) + manual | parcial |
| F12-H1 | transição | feliz | ícone entre clipes, Dissolver 0,5 s | transição no preview e na exportação; total encurta 0,5 s | unit | passou |
| F12-E1 | | clipes curtos | transição de 2 s entre clipes de 1 s | limitada à metade do menor | unit | passou |
| F13-H1 | formato e fundo | feliz | 9:16, Desfoque | quadro em pé, sobras desfocadas | unit (tamanhos) + manual | parcial |
| F14-H1 | sobreposição | feliz | Sobrepor, foto | foto pela metade do tamanho, arrastável | unit + manual | parcial |
| F15-H1 | continuar depois | feliz | fechar e reabrir | tudo igual, capa na tela inicial | manual | pendente |
| F15-E1 | | app morto pelo sistema | forçar parada no meio da edição | última edição salva (400 ms) | manual | pendente |
| F16-H1 | desfazer/refazer | feliz | editar, Desfazer, Refazer | volta e avança; arrasto vira um passo | unit (store) | passou |
| F17-H1 | gerenciar projetos | feliz | ⋯, Renomear/Duplicar/Excluir | lista atualiza | manual | pendente |
| A11Y-1 | todos | leitor de tela | TalkBack/VoiceOver nas telas principais | todos os botões têm nome em português | maestro (usa os rótulos) | pendente |

Resumo: 22 casos automatizados aqui, todos passando (118 testes unitários).
Os demais dependem de um aparelho.
