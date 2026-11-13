# 13/11/2026 — "AO DOUTO JUÍZO" em toda petição inicial

## Pedido
Jessica: "Regra de Ao Douto Juízo não foi mudada pq? AO JUÍZO DE UMA DAS VARAS CÍVEIS DA COMARCA DE CARIACICA/ES". Depois: "já subiu? é AO DOUTO".

## Causa
A regra de 30/10 (`2026-10-30-cabecalho-peca-trabalhista.md`) valia só para as áreas trabalhista e gestante. A peça de Cariacica é cível (ação contra banco), então saiu como a IA escreveu.

## Feito
- `src/services/enderecamentoPeca.ts`:
  - trabalhista: o cabeçalho fixo passa a "AO DOUTO JUÍZO DA ___ VARA DO TRABALHO DE (CIDADE) – (ESTADO)";
  - outras áreas: a regra entra no pedido à IA, e depois da redação a abertura da 1ª linha é trocada por "AO DOUTO JUÍZO", mantendo o juízo que a IA escreveu. Exemplos: "AO JUÍZO DE UMA DAS VARAS CÍVEIS…", "EXCELENTÍSSIMO SENHOR JUIZ DE DIREITO DA…", "EXMO. SR. DR. JUIZ FEDERAL DO…", "AO JUIZADO…", "À 2ª VARA…";
  - correção: a limpeza de markdown apagava o "___" da vara; agora só tira a marcação das pontas.
- `src/routes/ai.ts`: no Assistente de IA, a regra vale para o modelo "Petição Inicial" de qualquer área. Os outros modelos (contrato, parecer…) não mudam.
- Manual `docs/manual/06-documentos.md` (parágrafo + Changelog) e o espelho no Obsidian.

## Verificado
- `tests/enderecamentoPeca.test.mjs`: 13 testes, todos passam.
- `npm run build` sem erro; `npm run lint` com 0 erros; `npm test`: 1.366 testes, 0 falhas.
- **Não verificado em produção:** só aparece na próxima petição inicial gerada.

## Decisões e porquês
- Nas outras áreas, só a abertura é padronizada. O juízo competente (vara cível, juizado, Justiça Federal) continua sendo o que a IA escreveu, porque muda por área e por caso.
- Na trabalhista, a peça que vem sem endereçamento ganha o cabeçalho no topo. Nas outras áreas, se a 1ª linha não parecer endereçamento, o texto fica como veio, para não inventar o juízo.
- O "AO" também entrou no cabeçalho trabalhista, para seguir o "é AO DOUTO".

## Pendente
- Jessica: confirmar se o cabeçalho trabalhista com "AO" está certo (antes era "DOUTO JUÍZO DA…", sem o "AO").
- Jessica: dizer se a regra vale também para contestação e recurso. Hoje vale só para a petição inicial.

## Próxima sessão
Conferir a 1ª linha da próxima petição inicial cível gerada. Skills: `verification-before-completion`.
