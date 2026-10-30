# 30/10/2026 — Critério dos juros confirmado

## Pedido
A Jessica respondeu à pendência aberta desde 28/10 (juros desde cada desconto ou desde a citação): "sim, sempre juros atualizados".

## Feito
- Registrado como decisão: juros de mora e correção monetária contam desde cada desconto (Súmulas 43 e 54/STJ), nunca desde a citação. Planilha, demonstrativo e valor da causa saem sempre atualizados até a data-base.
- `docs/manual/17-decision-log.md` (entrada nova + changelog), `docs/manual/06-documentos.md` (nota no critério + changelog), `docs/contexto/ESTADO.md` (pendência fechada). Espelho do Obsidian atualizado.

## Verificado
- Nenhuma mudança de código: `atualizarIndebito`/`CRITERIOS` em `src/services/planilhaCalculos.ts` já usam este critério (testes de 28/10 em `tests/planilhaCalculos.test.mjs`).

## Decisões
- Interpretação de "sempre juros atualizados" = manter o padrão atual (desde cada desconto), que é o que gera o valor mais atualizado.

## Pendente
- Continua: juntar o HISCON nos casos de consignado/RMC/RCC e gerar a primeira peça real com planilha e demonstrativo.

## Próxima sessão
Nada específico deste assunto.
