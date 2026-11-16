# Kanban por fase nas Demandas dativas — 16/11/2026

## Pedido
"Em Demandas, quero lista do jeito que já está, e quero kanban por fase."

## Feito
- Aba Advocacia Dativa → Demandas: seletor **Lista | Kanban por fase** no fim da barra de filtros (`datDemandas`, `public/app.js`).
- Lista: sem nenhuma mudança.
- Kanban: uma coluna por fase de `DATIVE_STATUS` (8 fases do caminho do pagamento); Indeferida e Recusada só aparecem quando têm demanda; status desconhecido cai em "Sem fase". Topo da coluna: quantidade e soma do estimado. Card: assistido, comarca, assunto, nº do processo, protocolo do e-Flow, valor; clique abre a ficha.
- Os dois modos usam a mesma consulta e os mesmos filtros (etapa, busca, comarca, protocolo, período).
- Escolha lembrada em `localStorage` (`dcase_vista`), com try/catch.
- Estilo: `.dcase-vistas` e `.dcase-kanban` em `public/styles.css`, reaproveitando `.dat-quadro`.

## Verificado
- `tests/dativoKanbanFases.test.mjs` (5 testes): falhou antes, passa depois.
- `npm run build` ok; `npm run lint` 0 erros; `npm test`: 1 falha, que é do trabalho em andamento de outra sessão (`tests/dativoMoverCard.test.mjs`, rota `PATCH /cases/:id/etapa`), não deste commit.
- Sintaxe do `app.js` que vai no commit conferida com `node --check`.
- **Não verificado no navegador** (sem banco local).

## Decisões
- Sem arrastar card neste kanban: a fase avança pelos campos da ficha, e outra sessão está criando o arrastar (com rota própria) no quadro da Projeção. Dá para levar para cá depois.
- No kanban o Exportar CSV/PDF não acha tabela; para exportar, voltar à lista.

## Pendente
- Conferir na tela em produção.

## Próxima sessão
- Se pedirem arrastar no kanban das Demandas, reaproveitar a rota `PATCH /api/dative/cases/:id/etapa` da outra sessão quando ela estiver publicada.
