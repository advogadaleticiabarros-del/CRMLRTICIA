# 00c · Dashboard (Cockpit e demais painéis)

**Área:** Visão geral · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 22/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

A tela `#dashboard` é a primeira coisa que se vê ao abrir o CRM — 8 painéis em abas (Cockpit, Comercial, Processos, Processual, Agenda, Financeiro, Produção, Parceria), cada um puxando de endpoints próprios em `/api/dashboards/*`. O Cockpit é o painel-mãe (dinheiro + prazos + intimações + agenda do dia num só lugar); os outros 7 são recortes gerenciais por área. Este documento nasceu de uma auditoria completa pedida pela usuária em 22/09/2026, depois de um bug real: clicar no KPI "Inadimplência" sempre abria o Financeiro na Visão geral, sem filtro nenhum.

## Contexto

Consulte pra entender o que cada número do Dashboard significa de verdade (a conta por trás do rótulo), pra onde cada clique leva, ou se um problema que você notou já é conhecido.

## Os 8 painéis

Abas em `#dashboard` (papel `comercial` só vê Comercial e Agenda):

| Painel | Pra que serve |
|---|---|
| **Cockpit** | Painel-mãe — tudo que precisa de atenção hoje: dinheiro, prazos, intimações, movimentações a verificar, agenda do dia. |
| **Comercial** | Saúde do funil de vendas — leads, conversão, ticket médio, custo de aquisição por canal. |
| **Processos** (Monitoramento) | Saúde do monitoramento automático (DJEN/OAB) — quantos processos acompanhados, tribunais, movimentação recente. |
| **Processual** | Volume de processos ativos/suspensos/encerrados, peças pendentes, prazos e audiências próximas. |
| **Agenda** | Recorte "o que vence hoje" — prazos, compromissos e tarefas do dia, separado da Agenda completa. |
| **Financeiro** | Central de dinheiro — previsto × realizado, projeção de caixa, DRE, inadimplência, resultado por área. |
| **Produção** | Saúde da esteira de redação de peças — atrasados, pendências abertas, produtividade por pessoa. |
| **Parceria (protocolados)** | Fechamento mensal por parceiro — o que foi protocolado, pra reconciliar repasse. |

## Cockpit — o que cada número significa

Todo KPI do Cockpit tem um clique que leva pra algum lugar (`stat()`, `public/app.js`) — desde 22/09/2026, os que apontam pro Financeiro ou pro funil de Leads já abrem na aba/etapa certa (antes caíam sempre na tela padrão, sem filtro):

- **A receber até hoje / A receber (7 dias)** — soma de recebíveis pendentes (vencidos ou vencendo) somando 6 fontes: contratos de cliente, parcelamentos, audiências de correspondente, pagamentos do dativo, parcelas de acordo e prêmios de êxito. Sem filtro por usuária (deliberado). Clique → Financeiro, aba **A Receber** (ainda sem filtro de data pré-aplicado — ver "O que ainda falta").
- **A pagar (7 dias)** — despesas + repasses + saídas de caixa vencendo em 7 dias. Clique → Financeiro, aba **Contas a Pagar** (ainda abre no mês corrente, não numa janela de 7 dias — ver "O que ainda falta").
- **Inadimplência** — soma do que já está vencido, mesmas 6 fontes do "A receber", calculada por `getFinanceSummary()`. Clique → Financeiro, aba **Inadimplência** — essa aba mostra uma fila de cobrança **só de parcelas de cliente** (é a única fonte onde "renegociar"/"cobrança jurídica" fazem sentido), então pode ser um valor menor que o KPI — isso é esperado, não é mais uma divergência por bug (ver [Cobrança e parcelas](08-cobranca.md#inadimplência-e-renegociação)).
- **Tarefas pendentes** — contagem de tarefas não concluídas/canceladas. Clique → Prazos & Tarefas (tela cheia, sem filtro só nas pendentes).
- **Propostas em análise** — leads parados na etapa "Negociação" do funil comercial. Clique → funil de **Leads**, rola e destaca a coluna Negociação.
- **Total a protocolar / Protocolados no mês** — contagem de casos nas etapas pré-protocolo / contagem de "etapa_protocolado" na linha do tempo do mês. Clique → esteira de Produção (sem filtro nas etapas certas).

Painéis (listas com botão "Abrir →"): Prazos críticos (72h), Intimações a confirmar, Movimentações a verificar, Agenda de hoje. Cada item tem um botão "Resolver" — pra prazo/intimação/agenda é uma soneca de 1 dia (some até meia-noite, volta se a causa raiz não for tratada na tela de origem); pra **Movimentações a verificar**, "Resolver" agora fecha o alerta de vez (não existia mais nenhuma outra tela que fizesse isso).

## O que já foi corrigido (22/09/2026)

1. ~~"Inadimplência" calculada de 4 jeitos diferentes~~ — **Cockpit e o topo do Financeiro agora usam a mesma função** (`getFinanceSummary()`); o painel de aging (Inteligência financeira) passou a somar as mesmas 6 fontes, não só 3. A aba de fila de cobrança continua com escopo próprio de propósito (só parcelas de cliente — ver acima) e agora recalcula sozinha todo dia às 6h50, não só quando alguém clica "Recalcular agora".
2. ~~"Propostas em análise" apontava pra tela errada~~ — agora vai pro funil de Leads e destaca a coluna certa.
3. ~~"Movimentações a verificar" nunca fechava de vez~~ — "Resolver" agora marca `status='resolvido'` na tabela de origem (a coluna já existia, só nunca era escrita) — o item some pra sempre, não só até meia-noite.
4. ~~Dados calculados no backend, nunca mostrados na tela~~ — Processual ganhou as listas "Prazos vencidos" e "Processos por fase"; Agenda ganhou "Prazos vencidos" (explicando o KPI "Vencidos" que já existia sem lista nenhuma). `prazos_semana`, `reuniões futuras` e `audiências` (painel Agenda) foram deixados de fora de propósito — a tela já tem escopo de "hoje", exibi-los ali duplicaria a Agenda completa.
5. ~~Duas contas idênticas em dois arquivos~~ — "Total a protocolar" e "Peças pendentes" agora chamam a mesma função (`totalAProtocolarSql()`, `src/services/productionSla.ts`).

## O que ainda falta

6. **KPIs de data aproximada não filtram por data ao chegar no destino** — "A receber até hoje" e "A receber (7 dias)" levam pro mesmo lugar (aba A Receber sem filtro de data aplicado), então não dá pra distinguir um do outro só chegando lá; "A pagar (7 dias)" cai no mês inteiro, não numa janela de 7 dias.
7. **Painéis Comercial, Processos (Monitoramento), Processual, Agenda e Financeiro não têm nenhum clique** — todo número é só leitura, sem link pra investigar mais fundo (diferente do Cockpit e da Produção). Maior escopo — precisa decidir, painel por painel, pra onde cada número deveria levar.

## FAQ

**Por que o valor da aba Inadimplência é menor que o KPI "Inadimplência" do Cockpit?** Por design, não por bug: o KPI soma tudo que o escritório tem a receber e está vencido (6 fontes); a aba é só a fila de cobrança acionável de parcelas de cliente (a única fonte onde dá pra renegociar/escalar cobrança). Ver [Cobrança e parcelas](08-cobranca.md#inadimplência-e-renegociação).

**"Resolver" no Cockpit apaga o item de vez?** Depende do tipo: em "Movimentações a verificar", sim, desde 22/09/2026. Em prazo/intimação/agenda, não — some só até meia-noite (horário de Brasília) e volta se a causa raiz não for tratada de verdade na tela de origem (isso é intencional: esses já têm um fluxo de resolução real em outro lugar).

## Links relacionados
- [Cobrança e parcelas](08-cobranca.md) — telas de Financeiro que os KPIs do Cockpit abrem
- [Leads e comercial](02-leads.md) — funil que "Propostas em análise" abre
- [Monitoramento automático](10-monitoramento.md) — origem das "Movimentações a verificar"
- [Runbook](14-runbook.md) — o bug de roteamento corrigido em 22/09/2026

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 22/09/2026 | Claude | Criação do documento — auditoria completa dos 8 painéis a pedido da Dra. Letícia, depois do bug do KPI de Inadimplência |
| 22/09/2026 | Claude | Resolvidos 5 dos 7 achados: Inadimplência unificada (3 das 4 contas), Movimentações a verificar fecham de vez, Processual/Agenda ganham as listas que já eram calculadas, "Total a protocolar"/"Peças pendentes" compartilham a mesma consulta |

---
◀ [Fluxograma do sistema](00b-fluxograma.md) · [Visão geral](00-visao-geral.md) · Próximo: [Clientes e cadastro](01-clientes.md) ▶
