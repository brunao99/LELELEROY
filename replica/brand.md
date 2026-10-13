# Marca: Ledit's

Em 2026-10-13 o nome mudou de Bobina para **Ledit's**, escolha do dono do projeto.
O identificador interno continua `com.brunao99.bobina` (trocar faria o Android
tratar como outro app e apagaria os projetos ao reinstalar). As checagens de marca
abaixo valem para o nome novo e continuam "a rodar".

Projeto pessoal. A marca existe para o app ter identidade própria e não
confundir com o CapCut, não para vender. Se um dia virar produto, rode as
checagens marcadas como "a rodar" antes de gastar dinheiro com o nome.

## Nome

**Bobina**: o rolo onde o filme fica enrolado. Curto, em português, fácil de
falar e de escrever depois de ouvir uma vez, e não parece "CapCut" nem no som,
nem na escrita, nem no sentido (não usa "cut", "cap" nem "corte").

Outras opções consideradas: Rolo, Fita, Cena, Quadro, Takes. Ficou Bobina porque
é a mais distinta e combina com o ícone.

## Checagens

| checagem | onde | resultado |
| --- | --- | --- |
| marca no Brasil | INPI (busca de marcas, classes 9 e 42) | a rodar |
| marca nos EUA | tmsearch.uspto.gov | a rodar |
| marca na UE | TMview | a rodar |
| domínio | bobina.app / bobina.com.br | a rodar |
| lojas | buscar "Bobina" na App Store e no Google Play | a rodar |
| redes | @bobina no Instagram, TikTok, X | a rodar |

Nenhuma foi rodada: o app não vai para as lojas por enquanto. Antes de publicar,
um advogado de marcas deve fazer a busca de verdade.

## Paleta

Escura (padrão de editores de vídeo) com destaque âmbar `#ffb547`, de outra
família de cor que a do CapCut. Papéis e valores em `replica/design/tokens.json`;
contraste conferido com `contrast.py`: 23 pares, 0 falhas AA.

## Logo

Ideia: uma bobina de filme com a ponta da fita saindo, em âmbar sobre fundo
escuro. Desenho próprio, feito em código (`make_icons.py` gerou os arquivos em
`bobina/assets/`): ícone 1024 sem transparência, ícone adaptativo do Android
(frente, fundo e monocromático), splash e favicon. Funciona em 16 px porque é
uma forma só, sem detalhes finos. Não usa formas, cores nem truques de letra do
logo do CapCut.

## Voz

Três palavras: **direta** (não seca), **calma** (não lenta), **útil** (não
mandona).

| faça | não faça |
| --- | --- |
| "Ponha a agulha sobre um clipe." | "Erro: nenhum clipe selecionado." |
| "Não dá para dividir aqui: ponha a agulha dentro do item, longe das pontas." | "Operação inválida." |
| "Mantenha o Bobina aberto até terminar." | "NÃO FECHE O APP!!!" |
| "Tudo acontece no seu celular." | "Tecnologia de IA de ponta." |
| "Vídeo pronto" | "Parabéns! Seu vídeo incrível está pronto!" |

Os textos das telas foram escritos do zero nessa voz.

## Varredura

```bash
python3 .claude/skills/replica-brand/sweep.py bobina --avoid "CapCut,ByteDance,Jianying" --domains capcut.com,bytedance.com
```

Resultado em 2026-10-13: limpo (um comentário de código citava o nome e foi trocado).
