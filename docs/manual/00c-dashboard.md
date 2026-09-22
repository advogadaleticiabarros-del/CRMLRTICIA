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

- **A receber até hoje / A receber (7 dias)** — soma de recebíveis pendentes (vencidos ou vencendo) somando 6 fontes: contratos de cliente, parcelamentos, audiências de correspondente, pagamentos do dativo, parcelas de acordo e prêmios de êxito. Sem filtro por usuária (deliberado). Clique → Financeiro, aba **A Receber**.
- **A pagar (7 dias)** — despesas + repasses + saídas de caixa vencendo em 7 dias. Clique → Financeiro, aba **Contas a Pagar** (que abre no mês corrente, não numa janela de 7 dias — ver "O que falta" abaixo).
- **Inadimplência** — soma do que já está vencido, mesmas 6 fontes do "A receber". Clique → Financeiro, aba **Inadimplência** — **atenção:** essa aba usa uma tabela separada (só parcelamentos, recalculada por um botão manual), então o valor lá pode não bater com o KPI. Ver "O que falta".
- **Tarefas pendentes** — contagem de tarefas não concluídas/canceladas. Clique → Prazos & Tarefas (tela cheia, sem filtro só nas pendentes).
- **Propostas em análise** — leads parados na etapa "Negociação" do funil comercial. Clique → funil de **Leads**, rola e destaca a coluna Negociação (corrigido em 22/09/2026 — antes ia pra tela de Propostas/honorários, entidade errada).
- **Total a protocolar / Protocolados no mês** — contagem de casos nas etapas pré-protocolo / contagem de "etapa_protocolado" na linha do tempo do mês. Clique → esteira de Produção (sem filtro nas etapas certas).

Painéis (listas com botão "Abrir →"): Prazos críticos (72h), Intimações a confirmar, Movimentações a verificar, Agenda de hoje. Cada item tem um botão "Resolver" — **importante entender o que isso faz de verdade**, ver "O que falta" abaixo.

## O que falta / achados da auditoria (22/09/2026)

1. **"Inadimplência" é calculada de 4 jeitos diferentes no sistema** — o KPI do Cockpit, o KPI do topo do Financeiro, o painel "Inteligência financeira → aging" (só 3 das 6 fontes) e a aba Inadimplência de verdade (só parcelamentos, numa tabela que só atualiza quando alguém clica "Recalcular agora"). Resultado prático: dá pra clicar no KPI, chegar na aba certa (bug já corrigido), e ainda ver um número diferente do que motivou o clique. **Precisa de uma decisão de produto:** qual dessas 4 é a definição oficial, e as outras 3 telas passam a usar a mesma consulta.
2. **"Propostas em análise" apontava pra tela errada** — contava leads parados no funil, mas levava pra tela de Propostas (honorários/parcelas), sem relação nenhuma. Corrigido em 22/09/2026: agora vai pro funil de Leads e destaca a coluna certa.
3. **"Resolver" nos painéis do Cockpit é uma soneca de 1 dia, não uma resolução real** — grava só "resolvido hoje" numa tabela própria; no dia seguinte o item volta, a não ser que a origem dele (prazo, intimação) também tenha sido fechada por outro fluxo de verdade. **"Movimentações a verificar" é o pior caso: não existe NENHUMA outra tela no sistema pra fechar esse tipo de item de vez** — ele volta pra sempre até alguém decidir agir nele de outra forma (não existe hoje).
4. **Dados calculados no backend, nunca mostrados na tela** — os painéis Processual e Agenda calculam listas inteiras (prazos vencidos, reuniões futuras, audiências, processos por fase) que a tela nunca lê. Parece funcionalidade que começou e não foi terminada.
5. **Duas contas idênticas mantidas em dois arquivos** — "Total a protocolar" (Cockpit) e "Peças pendentes" (Processual) são a mesma consulta SQL copiada em dois lugares — qualquer mudança na lista de etapas precisa ser feita nos dois ou eles desalinham.
6. **KPIs de data aproximada não filtram por data ao chegar no destino** — "A receber até hoje" e "A receber (7 dias)" levam pro mesmo lugar (aba A Receber sem filtro de data aplicado), então não dá pra distinguir um do outro só chegando lá; "A pagar (7 dias)" cai no mês inteiro, não numa janela de 7 dias.
7. **Painéis Comercial, Processos (Monitoramento), Processual, Agenda e Financeiro não têm nenhum clique** — todo número é só leitura, sem link pra investigar mais fundo (diferente do Cockpit e da Produção).

Nenhum desses 5 primeiros itens tem solução implementada ainda — são decisões de produto ou correções que dependem de prioridade. Itens 2 já corrigido; itens 1, 3, 4, 5, 6, 7 aguardando decisão de prioridade da Dra. Letícia.

## FAQ

**Por que às vezes o número de "inadimplência" que vejo num lugar não bate com outro lugar do sistema?** Porque hoje existem 4 contas diferentes pra "inadimplência" (ver item 1 acima) — não é bug de cálculo isolado, é falta de uma definição única compartilhada entre as telas.

**"Resolver" no Cockpit apaga o item de vez?** Não — some só até meia-noite (horário de Brasília). Volta no dia seguinte se a causa raiz (o prazo, a intimação, a movimentação) continuar sem ser tratada de verdade na tela de origem.

## Links relacionados
- [Cobrança e parcelas](08-cobranca.md) — telas de Financeiro que os KPIs do Cockpit abrem
- [Leads e comercial](02-leads.md) — funil que "Propostas em análise" abre
- [Monitoramento automático](10-monitoramento.md) — origem das "Movimentações a verificar"
- [Runbook](14-runbook.md) — o bug de roteamento corrigido em 22/09/2026

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 22/09/2026 | Claude | Criação do documento — auditoria completa dos 8 painéis a pedido da Dra. Letícia, depois do bug do KPI de Inadimplência |

---
◀ [Fluxograma do sistema](00b-fluxograma.md) · [Visão geral](00-visao-geral.md) · Próximo: [Clientes e cadastro](01-clientes.md) ▶
