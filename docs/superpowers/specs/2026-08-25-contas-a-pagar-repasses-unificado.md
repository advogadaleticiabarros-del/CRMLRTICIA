# Contas a Pagar — incluir repasses a parceiros — Design

## Contexto

A usuária reportou que a aba Financeiro → "Contas a Pagar" está incorreta: "nenhuma movimentação está sendo calculada, apenas o que eu registrei manual ali, precisa ser centralizado, as informações estão soltas em meu financeiro".

**Causa raiz confirmada por leitura direta do código**: `GET /api/cashflow` (`src/routes/cashflow.ts:31-47`) consulta **exclusivamente** `cashflow_entries` — uma tabela puramente de lançamentos manuais (`migrations/016_cashflow.sql` + `052`, sem coluna de origem/sync, sem trigger). Nenhuma outra fonte de saída de dinheiro do sistema (`repasses`, `financial_records` tipo despesa) entra nessa consulta.

**O que já existe e resolve parte do problema**: a aba "Visão geral" (`finVisaoGeral` → `GET /api/financial/summary` → `getFinanceSummary()` em `src/services/financeSummary.ts`) já une `financial_records`(despesa) + `cashflow_entries`(saída) + `repasses` nos KPIs agregados (`despesa_prevista`, `despesa_paga`) — mas repasses aparece como card resumido separado (`saidas.repasses`), não misturado na lista detalhada linha-a-linha que "Contas a Pagar" mostra.

`financial_records` tipo='despesa' está **vazia em produção** (confirmado no comentário de `financeSummary.ts:97`) — não é uma fonte real hoje, só uma tabela legada mantida por compatibilidade. Repasses é a única fonte de saída real, fora de `cashflow_entries`, que tem dinheiro de verdade.

## Decisão 1 — Escopo: só repasses, não financial_records

`financial_records`(despesa) fica de fora desta mudança — está vazia em produção, incluí-la seria trabalho sem efeito prático hoje. Se voltar a ser usada no futuro, é uma extensão direta do mesmo padrão (mais um braço no `UNION`), não uma mudança de arquitetura.

## Decisão 2 — Backend: UNION em `GET /api/cashflow`, não uma rota nova

Quando `type=saida`, a rota some os resultados de `cashflow_entries` com os de `repasses` (status `pendente`/`processando`), reaproveitando exatamente o filtro de status que `financeSummary.ts:115-119` já usa. `type=entrada` não muda — repasses são sempre saída (dinheiro que o escritório deve a terceiros), nunca entrada.

Cada linha de repasse é normalizada para o mesmo formato que o frontend já espera de `cashflow_entries`, com dois campos extras que o frontend usa para diferenciar:

```json
{
  "id": "repasse:42",
  "type": "saida",
  "category": "repasse_parceiro",
  "description": "Repasse a João Silva — indicação (Proc. 0001234-56...)",
  "amount": 300.00,
  "due_date": "2026-08-30",
  "status": "previsto",
  "escopo": "empresa",
  "pagador": null,
  "banco": null,
  "installment_total": 1
}
```

- `id` vira uma string prefixada (`repasse:42`) para nunca colidir com um `id` numérico real de `cashflow_entries` — os botões de ação do frontend (Decisão 4) checam esse prefixo antes de chamar qualquer endpoint de escrita.
- `status`: `repasses.status IN ('pendente','processando')` vira `previsto` (mesmo vocabulário de `cashflow_entries.status`); a query já filtra por esses dois status, nunca traz `repassado`/`cancelado` — mesmo comportamento de "Contas a Pagar" hoje, que só lista o que ainda não foi pago (a opção "Ver pagas" já existe e continua funcionando **apenas para `cashflow_entries`** — repasses já pagos (`repassado`) não entram nesta tela em nenhum estado, porque a tela de Repasses é o lugar certo pra ver o histórico completo).
- `category`: `'repasse_parceiro'`, uma categoria nova e fixa (não vem de `repasses.tipo`, que é sobre o motivo do repasse, não uma categoria financeira) — vira o nome do grupo/card "Repasses a parceiros" na lista.
- `escopo`: sempre `'empresa'` (repasse a parceiro nunca é uma despesa pessoal).
- `pagador`/`banco`: sempre `null` — repasses não têm esses campos, e não fazem sentido para eles.

Query real, adicionada em `src/routes/cashflow.ts` dentro do handler de `GET /`, condicional a `type === 'saida'` e (quando presente) `escopo !== 'pessoal'` — executada como uma segunda `db.query()` separada, não um `UNION` SQL literal, e os dois resultados são concatenados em JavaScript antes de `res.json(rows)`. Colunas explícitas em `NULL`/valor fixo para bater exatamente com o formato que o frontend espera de uma linha de `cashflow_entries`:

```sql
SELECT CONCAT('repasse:', r.id) AS id, 'saida' AS type, 'repasse_parceiro' AS category,
       CONCAT('Repasse a ', r.parceiro, ' — ', r.descricao) AS description,
       r.valor AS amount, r.data_vencimento AS due_date, 'previsto' AS status,
       'empresa' AS escopo, NULL AS pagador, NULL AS banco, 1 AS installment_total,
       NULL AS installment_no, NULL AS recurrence_group
  FROM repasses r
 WHERE r.status IN ('pendente', 'processando')
   AND r.data_vencimento >= ? AND r.data_vencimento <= ?
```

Mesmos parâmetros `from`/`to` já usados na query de `cashflow_entries` — repasses respeita a mesma janela de mês selecionada na tela. Quando `escopo=pessoal` está na URL, a query de repasses simplesmente não roda (array vazio) — já que são sempre `'empresa'`, coerente com o significado do filtro.

## Decisão 3 — Frontend: repasses como grupo próprio na mesma lista

`finContasPagar` (`public/app.js:4944`) não precisa de nova UI — o agrupamento por `category` já existe (`groups[r.category]`), e `category: 'repasse_parceiro'` cai nele naturalmente. Só precisa de:
- Uma entrada em `GRUPO_PT` (o dicionário de rótulos de categoria) mapeando `repasse_parceiro` → `'Repasses a parceiros'`.
- `GRUPOS_DESPESA` (a ordem de exibição dos grupos) ganha essa categoria no fim da lista — repasses aparecem como o último grupo, depois das categorias manuais, sinalizando "isso é diferente do que você lançou".

Os KPIs do topo (`Saídas do mês`, `Pago`, `Em aberto`, `Vencido`) já somam `rows.forEach(...)` sem checar a origem — como as linhas de repasse chegam misturadas no mesmo array `rows` do `GET /api/cashflow?type=saida`, elas entram automaticamente no total. **Isso é o núcleo do que resolve "centralizar"**: o número de "Saídas do mês" passa a refletir o dinheiro real que sai do escritório, não só o que foi digitado manualmente.

## Decisão 4 — Ações: repasses são somente-leitura aqui, com link pra tela própria

Repasses já têm seu próprio fluxo de mudança de status na aba "Repasses" (`finRepasses`, mesma tela Financeiro, aba adjacente) — não existe endpoint em `cashflow.ts` que altere `repasses.status`, e não deveria existir um (duplicaria a lógica de negócio que já vive em `finRepasses`/sua rota correspondente).

Na linha de repasse dentro de "Contas a Pagar": os botões **Pagar/Editar/Excluir não aparecem** (o `id` prefixado `repasse:` é detectado no frontend, que renderiza um botão diferente no lugar deles: **"Ver em Repasses"**, que só troca a aba ativa da mesma tela Financeiro para `repasses` — sem navegação de página, sem F5, já que `tabs.repasses` já existe no mesmo roteador de abas (`app.js:1431`).

Justificativa: colocar Pagar/Editar/Excluir funcionando ali exigiria duplicar toda a lógica de mudança de status de repasse (que envolve `data_repasse`, histórico, e possivelmente notificação ao parceiro) dentro de `cashflow.ts` — risco de dessincronizar duas fontes de verdade para a mesma linha. Um link para o lugar certo é mais simples e não introduz um segundo caminho de escrita para o mesmo dado.

## Global Constraints

- `financial_records`(despesa) explicitamente fora de escopo (vazia em produção — ver Decisão 1).
- `repasses` só entra quando `type=saida`; nunca em `type=entrada`.
- Só `status IN ('pendente','processando')` — nunca `repassado`/`cancelado` (equivalente ao "Ver pagas" desligado hoje; repasses pagos continuam só na aba própria de Repasses).
- `escopo` de repasse é sempre `'empresa'` — nunca aparece sob o filtro "Pessoal".
- `id` de linha de repasse é a string `repasse:{id}`, nunca um número puro — usado pelo frontend para decidir se mostra os botões de ação normais ou o link "Ver em Repasses".
- Nenhum endpoint novo de escrita para `repasses` dentro de `cashflow.ts` — a mudança de status de repasse continua exclusivamente na aba/rota de Repasses já existente.
- Sem testes automatizados de frontend no projeto — a mudança de UI é validada com checklist visual manual.
