# 16/11/2026 — Busca por protocolo nos dativos

## Pedido
Jessica, logo depois de as demandas antigas ganharem o protocolo no campo próprio: "coloque um campo de pesquisa por protocolo".

## Feito
- `src/services/buscaDativo.ts`: nova função `filtroProtocoloDativo`.
  - O que foi digitado fica só com letras e números, em maiúsculas.
  - É comparado com `eflow_protocolo`, normalizado do mesmo jeito (sem hífen e sem espaço).
  - Acha o protocolo inteiro ou só um pedaço.
- `src/routes/dative.ts`: `GET /api/dative/cases` aceita o parâmetro `protocolo`.
- `public/app.js` (`datDemandas`): campo "Buscar por protocolo…" ao lado do de comarca. Usa a mesma espera de digitação dos outros campos e soma com os outros filtros.
- Teste: `tests/buscaProtocoloDativo.test.mjs` (5 casos).
- Manual: `docs/manual/05-dativo.md`, com cópia no espelho do Obsidian.

## Verificado
- Build ok; lint com 0 erros.
- `npm test`: 1466 testes, 0 falhas.
- A consulta SQL rodou no banco de produção, só leitura: "C35XPH" achou 1 demanda; "2026" achou as 7 com protocolo.
- `npm run docs:api` não mudou nada.
- **Não verificado no navegador.**

## Decisões e porquês
- Fiz um campo próprio, como foi pedido, em vez de juntar o protocolo à busca de assistido e processo. Assim o resultado não se mistura com nomes e números de processo.
- `%` e `_` digitados são descartados, para não virarem curinga no LIKE.

## Pendente
Nada desta tarefa. Os pendentes das fases antigas estão no relatório `2026-11-16-fases-dativos-antigos.md`.

## Próxima sessão
Abrir Advocacia Dativa → Demandas, digitar parte de um protocolo e conferir o filtro.
