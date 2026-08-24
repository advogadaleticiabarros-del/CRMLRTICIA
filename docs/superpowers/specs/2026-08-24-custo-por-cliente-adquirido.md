# Custo por Cliente Adquirido, por Canal — Spec

**Status:** Aprovada
**Parte de:** "BI & dashboards executivos" (categoria do Diagnóstico do Ecossistema, hoje em 65%) — sub-projeto 3 de 3 (funil / rentabilidade por área / custo por canal)

## Problema

O sistema já rastreia de onde vem cada lead (`leads.utm_source/utm_medium/utm_campaign`, normalizado por `src/services/leadChannel.ts` em canais como "Meta Ads", "Google Ads", "Indicação", "Instagram (orgânico)" etc.), mas não sabe quanto foi gasto em cada canal — não há integração com Meta Ads API/Google Ads API, e não existe hoje nenhuma tabela de custo/investimento em marketing. A Dra. Letícia decide se vale continuar pagando anúncio sem saber o custo real por cliente conquistado.

## Decisões confirmadas

1. O gasto por canal é lançado manualmente pela usuária (mês + canal + valor) — não há integração automática com plataformas de anúncio.
2. A tela de lançamento fica dentro do painel Comercial (mesmo lugar onde ela já vê a origem dos leads).
3. Canais orgânicos (sem gasto, ex: Indicação, WhatsApp, Site direto) aparecem no painel com custo R$ 0 — não são omitidos da comparação, o R$ 0 reforça visualmente que são os canais mais baratos.

## Arquitetura

**Migration** (`migrations/1XX_gasto_marketing_canal.sql` — número sequencial a definir no plano):
```sql
CREATE TABLE gasto_marketing (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mes_referencia DATE NOT NULL,        -- sempre dia 1 do mês (ex: 2026-08-01)
  canal VARCHAR(60) NOT NULL,          -- mesmos valores normalizados de leadChannel.ts
  valor DECIMAL(10,2) NOT NULL,
  created_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_mes_canal (mes_referencia, canal)
);
```
`UNIQUE KEY` garante um único lançamento por mês+canal — lançar de novo atualiza (`ON DUPLICATE KEY UPDATE`), evitando duplicidade acidental.

**Backend**:
- `POST /api/dashboards/gasto-marketing` — upsert de um lançamento (`mes_referencia`, `canal`, `valor`).
- `GET /api/dashboards/gasto-marketing?mes=2026-08` — lista os lançamentos do mês (para a tela mostrar o que já foi preenchido).
- `GET /api/dashboards/custo-aquisicao?mes=2026-08` — cálculo principal:
```sql
SELECT
  canal_normalizado,
  COUNT(*) AS clientes_adquiridos
FROM leads
WHERE status = 'fechada'
  AND DATE_FORMAT(updated_at, '%Y-%m') = ?
GROUP BY canal_normalizado
```
(usa a mesma normalização de `leadChannel.ts` já aplicada em `comercial.ts`, para bater com os nomes de canal usados em `gasto_marketing.canal`). Depois, junta com `gasto_marketing` do mesmo mês: `custo_por_cliente = gasto / clientes_adquiridos` (quando `clientes_adquiridos = 0`, mostra o gasto total sem dividir, sinalizando "nenhum cliente fechado ainda esse mês" em vez de erro/infinito). Canais que aparecem em `leads` mas não têm lançamento em `gasto_marketing` entram com `gasto = 0`.

**Frontend** (`public/app.js`, painel Comercial): duas peças novas.
1. Formulário simples de lançamento: seletor de mês, lista de canais (reaproveitar a lista de `leadChannel.ts`, exposta via API ou replicada como constante do frontend — decisão de implementação no plano) com campo de valor ao lado de cada um, botão salvar.
2. Lista/tabela de resultado: canal, gasto do mês, clientes adquiridos, custo por cliente — ordenada do mais caro para o mais barato (ou do mais barato pro mais caro — a decidir visualmente no plano, mas com R$ 0 dos canais orgânicos sempre visível, não escondido).

## Testes

- Migration: `UNIQUE KEY` impede duplicidade; upsert atualiza valor existente em vez de criar linha nova.
- Cálculo de custo por cliente: canal com gasto e clientes gera divisão correta; canal sem gasto (`gasto_marketing` vazio para ele) aparece com R$ 0; canal com gasto mas zero clientes fechados no mês não gera erro de divisão por zero.
- Front: envio do formulário grava e a lista de resultado reflete o lançamento sem precisar recarregar a página inteira.

## Fora de escopo

- Qualquer integração automática com Meta Ads API/Google Ads API (puramente manual).
- Custo por cliente ao longo de vários meses acumulados (o cálculo é por mês; comparação histórica entre meses fica para uma iteração futura, não pedida aqui).
- Atribuição multi-touch (lead que passou por mais de um canal antes de fechar) — usa o canal de origem gravado no primeiro contato (`utm_source` original do lead), não um modelo de atribuição mais sofisticado.
