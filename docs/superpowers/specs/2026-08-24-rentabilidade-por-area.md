# Rentabilidade por Área de Atuação — Spec

**Status:** Aprovada
**Parte de:** "BI & dashboards executivos" (categoria do Diagnóstico do Ecossistema, hoje em 65%) — sub-projeto 2 de 3 (funil / rentabilidade por área / custo por canal)

## Problema

A Dra. Letícia atua em Trabalhista, Família, Previdenciário, Cível, Consumidor e Gestante, mas decide "focar mais em X área" por intuição — não há hoje um número real de receita por área. `src/routes/dashboards/financeiro.ts:117-125` já calcula resultado por `cases.legal_area`, mas isso cobre só casos, não propostas fechadas sem caso vinculado, e o campo de área é inconsistente entre tabelas:

- `cases.legal_area` — ENUM fixo de 7 valores (`trabalhista, gestante, familia, civel, previdenciario, consumidor, outro`).
- `propostas.legal_area` — `VARCHAR(60)` texto livre, sem padronização.
- `leads.legal_area` — `VARCHAR(100)` texto livre, frequentemente vazio (`comercial.ts:33-36` já trata isso com `COALESCE(NULLIF(...),'(indefinida)')`).

## Decisões confirmadas

1. `propostas.legal_area` e `leads.legal_area` deixam de ser texto livre e passam a usar as mesmas 7 opções fixas de `cases.legal_area`.
2. Propostas/leads já existentes com texto livre não são migrados/reescritos automaticamente — ficam com o valor antigo até serem editados de novo pela usuária através do formulário (que passa a oferecer só a lista fixa).
3. O painel mostra, por área: receita total recebida, quantidade de casos, e receita média por caso.
4. Métrica de receita usa `installments` pagas (`status = 'pago'`), a mesma fonte que `dashboards/cliente.ts` e `dashboards/financeiro.ts` já usam — não uma fonte nova.

## Arquitetura

**Migration** (`migrations/1XX_padroniza_legal_area.sql` — número sequencial a definir no plano):
```sql
ALTER TABLE propostas
  MODIFY COLUMN legal_area ENUM('trabalhista','gestante','familia','civel','previdenciario','consumidor','outro') NULL;

ALTER TABLE leads
  MODIFY COLUMN legal_area ENUM('trabalhista','gestante','familia','civel','previdenciario','consumidor','outro') NULL;
```
Valores existentes que não baterem exatamente com o ENUM (ex: "Direito do Trabalho" digitado livre) viram `NULL` na conversão do MySQL — aceitável pela decisão 2 acima (não é migração de dados, é padronização de schema; dado antigo "estranho" vira vazio em vez de ser adivinhado).

**Backend**: novo endpoint `GET /api/dashboards/rentabilidade-area` (ou seção adicionada a `dashboards/financeiro.ts`, decisão de organização de arquivo fica para o plano). Query central:
```sql
SELECT
  c.legal_area,
  COUNT(DISTINCT c.id) AS total_casos,
  COALESCE(SUM(i.valor), 0) AS receita_total
FROM cases c
LEFT JOIN installments i ON i.case_id = c.id AND i.status = 'pago'
GROUP BY c.legal_area
```
Receita média por caso = `receita_total / total_casos` (proteger contra divisão por zero quando `total_casos = 0`).

**Frontend** (`public/app.js`): nova seção no painel Comercial (ou Financeiro — a decidir no plano, mas o dado de origem é `cases`, então tende a fazer mais sentido reaproveitar visualmente o padrão de `chartHBars`/`kpi` já usado em outros dashboards) mostrando barras horizontais por área com receita total, e um número menor de receita média por caso ao lado.

**Formulários existentes**: `propostaForm` e o formulário de lead em `public/app.js` trocam o campo de texto livre de área por um `<select>` com as mesmas 7 opções já usadas em `AREAS_OPT`/`AREAS` (app.js:3555, 5450) — reaproveitar essas constantes existentes em vez de criar uma terceira lista.

## Testes

- Migration: confirmar que o ENUM foi aplicado nas duas colunas e que valores fora da lista viram NULL (não erro).
- Query de rentabilidade: caso com receita paga aparece na área certa; caso sem nenhuma installment paga aparece com `receita_total = 0`, não erro; área sem nenhum caso não gera divisão por zero.
- Frontend: os dois formulários (proposta, lead) usam `<select>` em vez de texto livre; opções batem com `cases.legal_area`.

## Fora de escopo

- Migrar/reescrever valores de área já digitados livremente em propostas/leads existentes.
- Rentabilidade por advogado/responsável (só por área).
- Considerar receita de `financial_records` avulsos não ligados a um caso (só `installments` via `case_id`).
