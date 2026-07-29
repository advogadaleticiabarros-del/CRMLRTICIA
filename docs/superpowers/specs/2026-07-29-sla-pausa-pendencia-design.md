# SLA da produção pausa durante pendência aberta — design

## Contexto

O contador de "dias parado"/SLA da esteira de produção (`cases.production_started_at`
até hoje) roda sem parar, mesmo quando o caso está travado esperando
documento do cliente. Isso pune o escritório no SLA por um atraso que não é
dele. A Dra. Letícia pediu: quando há um alerta de pendência aberto
("não temos documentos suficientes"), o relógio do SLA deve pausar.

Já existe a estrutura de dados certa pra isso: `production_notes` com
`kind='pendencia'`, `resolved` (0/1) e `resolved_at`. Cada pendência aberta
tem um início (`created_at`) e um fim (`resolved_at`, ou "ainda aberta" se
`resolved_at` for `NULL`).

Achados 5 lugares que calculam esse número hoje, todos com a mesma fórmula
simples (`DATEDIFF(NOW(), production_started_at)`), sem descontar pausa:

1. `src/routes/cases.ts:70` — Kanban da esteira (`sla_days` por card)
2. `src/routes/dashboards/producao.ts` — contagem de atrasados + lista "parados há mais tempo"
3. `src/routes/controladoria.ts:52` — dias do caso mais antigo por etapa (gargalos)
4. `src/routes/partner-portal.ts:40` — casos do parceiro (portal do parceiro)
5. `src/routes/partners.ts:129` — casos do parceiro (visão interna)

## Decisão de escopo (confirmada)

- Vale para os 5 lugares (consistência total — o mesmo caso não pode mostrar
  SLA diferente dependendo de onde se olha, inclusive pro parceiro).
- Além do número de dias já vir descontado, mostrar um selo **"⏸ Pausado"**
  onde o caso tem pendência aberta *agora* (não resolvida).

## 1) Fórmula (cálculo único, reutilizado nos 5 lugares)

Novo arquivo `src/services/productionSla.ts`, exportando funções que montam
o fragmento SQL (não um valor calculado em TS — os 5 lugares fazem tudo em
SQL direto, então o cálculo tem que viver como SQL reutilizável):

```sql
-- dias pausados = soma da duração de cada pendência (aberta ou já resolvida)
(SELECT COALESCE(SUM(DATEDIFF(COALESCE(pn.resolved_at, NOW()), pn.created_at)), 0)
   FROM production_notes pn
  WHERE pn.case_id = <id do caso> AND pn.kind = 'pendencia')

-- dias efetivos = dias corridos desde o início da produção, menos os pausados
GREATEST(0, DATEDIFF(NOW(), <production_started_at>) - <dias pausados>)
```

`GREATEST(0, ...)` evita número negativo no caso raro de a pendência ter
sido aberta e ainda não resolvida por mais tempo que o próprio SLA corrido
(não deveria acontecer, mas é uma proteção barata).

## 2) Aplicação nos 5 lugares

Cada um troca `DATEDIFF(NOW(), c.production_started_at)` (ou equivalente
sem alias) pela fórmula de dias efetivos acima, interpolando o case_id e a
coluna de início corretos pra cada query. Nos 2 lugares que ainda não têm
a subconsulta de `pendencias` (contagem de pendências abertas) —
`partner-portal.ts` e `partners.ts` — ela é adicionada, no mesmo padrão já
usado em `cases.ts`/`producao.ts`:

```sql
(SELECT COUNT(*) FROM production_notes pn
  WHERE pn.case_id = c.id AND pn.kind = 'pendencia' AND pn.resolved = 0) AS pendencias
```

`producao.ts`'s consulta de "atrasados" (contagem, sem alias de tabela) e
`controladoria.ts`'s consulta de "gargalos" (`MAX(...)` agregado, sem alias)
usam a mesma fórmula, referenciando `cases.id`/`cases.production_started_at`
diretamente (não precisam de alias pra funcionar em MySQL).

## 3) Selo "⏸ Pausado" no front-end

Nas 5 telas correspondentes (`public/app.js` — quadro Kanban, Dashboard de
Produção, Controladoria; e a tela do parceiro em `public/partner-portal.html`
ou equivalente), onde o número de dias é mostrado, um selo aparece ao lado
quando `pendencias > 0`:

```html
${row.pendencias > 0 ? '<span class="badge pausado">⏸ Pausado</span>' : ''}
```

Reaproveita o `pendencias` que várias dessas telas já recebem da API (e que
passa a ser adicionado nas duas que não tinham). Precisa de uma classe CSS
`.badge.pausado` nova (cor neutra/azulada, para não confundir com o
vermelho de "atrasado" nem o dourado de "a receber").

## Fora de escopo (YAGNI)

- Não altera `production_started_at` nem o valor de `SLA_DIAS` (continua 10).
- Não distingue tipos de pendência (documento faltando vs. outro motivo) —
  toda pendência aberta pausa o relógio, do jeito que o sistema já
  categoriza hoje.
- Não adiciona histórico/relatório de "quanto tempo cada caso ficou
  pausado" — só o desconto no número já existente.
