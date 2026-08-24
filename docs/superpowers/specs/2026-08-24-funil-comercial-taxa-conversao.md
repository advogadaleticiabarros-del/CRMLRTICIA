# Funil Comercial com Taxa de Conversão — Spec

**Status:** Aprovada
**Parte de:** "BI & dashboards executivos" (categoria do Diagnóstico do Ecossistema, hoje em 65%) — sub-projeto 1 de 3 (funil / rentabilidade por área / custo por canal)

## Problema

O painel Comercial (`dashComercial`, `public/app.js:3933-3959`) já desenha um funil visual com barras horizontais proporcionais ao volume de leads em cada etapa (`FUNNEL_ORDER`, 7 estágios: triagem → atendimento_inicial → reuniao → documentacao_pendente → proposta → proposta_em_analise → contrato_assinado). Mas mostra só volume absoluto — não há taxa de conversão entre etapas consecutivas. A Dra. Letícia não consegue ver onde exatamente os leads "somem" no caminho (ex: perde muita gente entre Atendimento e Reunião? Ou entre Proposta e Contrato?).

## Decisões confirmadas

1. A taxa de conversão entra no mesmo painel Comercial já existente, ao lado de cada barra do funil — não é um painel novo.
2. Leads com `status = 'perdida'` são separados do cálculo de conversão: aparecem como um contador à parte ("N perdidos no período"), não distorcem a % das etapas ativas.
3. Cálculo usa exclusivamente `leads.status` — nenhuma tabela nova, nenhuma migration.

## Arquitetura

**Backend** (`src/routes/dashboards/comercial.ts`): a rota `GET /api/dashboards/comercial` já devolve `leads_por_status` (contagem bruta por status, linhas 23-26). Adicionar um novo campo à resposta, `funil_conversao`, calculado a partir do mesmo `leads_por_status`:

```ts
// Ordem fixa das etapas ativas do funil (espelha FUNNEL_ORDER do frontend,
// mas sem 'perdida'/'fechada' — essas são desfechos, não etapas do funil).
const ETAPAS_FUNIL = [
  'triagem', 'atendimento_inicial', 'reuniao',
  'documentacao_pendente', 'proposta', 'proposta_em_analise', 'contrato_assinado',
];

function calcularFunilConversao(leadsPorStatus: Record<string, number>) {
  const etapas = ETAPAS_FUNIL.map((status, i) => {
    const volume = leadsPorStatus[status] || 0;
    const volumeAnterior = i === 0 ? volume : (leadsPorStatus[ETAPAS_FUNIL[i - 1]] || 0);
    const taxa = i === 0 || volumeAnterior === 0 ? null : Math.round((volume / volumeAnterior) * 1000) / 10;
    return { status, volume, taxa_conversao: taxa };
  });
  return { etapas, perdidos: leadsPorStatus['perdida'] || 0 };
}
```

Nota: a taxa de conversão aqui é etapa-a-etapa em volume acumulado no momento da consulta (quantos leads estão *hoje* em cada etapa, comparado à etapa anterior) — não é coorte histórica (não rastreia "dos leads que entraram em Triagem em janeiro, quantos chegaram a Contrato"). Isso é consistente com o que o `leads_por_status` atual já faz (contagem por status corrente) e evita a complexidade de rastrear coortes por data, que a spec não pediu.

**Frontend** (`public/app.js`, dentro de `dashComercial`): ao lado de cada barra do funil (`app.js:3937-3942`), adicionar o texto da taxa de conversão daquela etapa em relação à anterior (ex: "68%"), usando o campo `funil_conversao.etapas[i].taxa_conversao` vindo da API. A primeira etapa (triagem) não mostra taxa (não tem "anterior"). Abaixo do funil, um contador separado: "N leads perdidos no período".

## Testes

- Teste de unidade para `calcularFunilConversao`: volumes decrescentes geram taxas corretas; etapa com volume anterior zero não gera divisão por zero (retorna `null`); `perdida` nunca entra em `etapas`.
- Teste de regressão confirmando que `leads_por_status` (usado por outras partes do dashboard) continua sendo devolvido sem alteração — `funil_conversao` é aditivo, não substitui nada.

## Fora de escopo

- Funil por coorte histórica (rastrear uma safra específica de leads ao longo do tempo).
- Filtro de período customizável para o funil (usa o mesmo período que o resto do painel Comercial já usa hoje).
- Qualquer mudança em `FUNNEL_ORDER` ou nos status possíveis de `leads`.
