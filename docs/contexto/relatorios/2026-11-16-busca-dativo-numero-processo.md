# 16/11/2026 — Busca do dativo pelo número do processo

## Pedido
Dra. Letícia: "Em dativos, coloque para pesquisar por número de processo também, com ou sem pontuação."

## Feito
- `src/services/buscaDativo.ts` (novo): `filtroBuscaDativo(termo)` monta o filtro SQL. Procura no nome do assistido e, se o termo tiver 4 dígitos ou mais, no número do processo comparando só os dígitos (tira `.`, `-`, `/`, espaço e `_` do valor gravado).
- `src/routes/dative.ts`: `GET /api/dative/cases` aceita o parâmetro `busca`. `assisted_name` continua aceito para não quebrar chamadas antigas.
- `public/app.js` (`datDemandas`): o campo virou "Buscar por assistido ou número do processo…" e envia `busca`.
- `tests/buscaDativo.test.mjs`: 6 testes novos.
- Documentação: `docs/manual/05-dativo.md` (seção "Buscar e filtrar demandas" e changelog) e `docs/contexto/ESTADO.md`.

## Verificado
- Build (`tsc`) sem erro.
- `npm run lint`: 0 erros (32 avisos que já existiam).
- `npm test`: 1461 testes, 0 falhas (os não contados como "pass" são os que pulam sem banco local).
- **Não verificado** no navegador nem no MySQL de produção: a consulta só de leitura na VPS foi bloqueada pela permissão desta sessão. O CI roda os testes com banco antes de publicar.

## Decisões e porquês
- Um campo só, em vez de um campo novo de processo: menos coisa na barra e a Dra. não precisa escolher onde digitar.
- Comparação por dígitos com `REPLACE` encadeado em vez de `REGEXP_REPLACE`: funciona em qualquer versão do MySQL.
- Mínimo de 4 dígitos para buscar no processo: com 1 a 3 dígitos quase todo processo bateria.
- Sem índice novo: a lista é por usuário e pequena; a busca por trecho já não usaria índice.

## Pendente
- A Dra. testar na tela de Demandas com um número formatado e outro sem pontuação.

## Próxima sessão
Se ela relatar que não achou, conferir como o número está gravado em `dative_cases.process_number` (pode haver outro separador). Skills: `diagnosing-bugs`, `verification-before-completion`.
