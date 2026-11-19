# 00c · Dashboard (Cockpit e demais painéis)

**Área:** Visão geral · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 22/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

A tela `#dashboard` é a primeira coisa que se vê ao abrir o CRM — 8 painéis em abas (Cockpit, Comercial, Processos, Processual, Agenda, Financeiro, Produção, Parceria), cada um puxando de endpoints próprios em `/api/dashboards/*`. O Cockpit é o painel-mãe (dinheiro + prazos + intimações + agenda do dia num só lugar); os outros 7 são recortes gerenciais por área. Este documento nasceu de uma auditoria completa pedida pela usuária em 22/09/2026, depois de um bug real: clicar no KPI "Inadimplência" sempre abria o Financeiro na Visão geral, sem filtro nenhum.

## Contexto

Consulte pra entender o que cada número do Dashboard significa de verdade (a conta por trás do rótulo), pra onde cada clique leva, ou se um problema que você notou já é conhecido.

## Pesquisar cliente (desde 18/10/2026)

No topo dos Dashboards, acima das abas, o campo "🔎 Pesquisar cliente" acha o cliente por nome, CPF, telefone ou número do processo e abre tudo dele: dativo, parceria ou próprio, processos, financeiro, acordos e repasses, movimentações, prazos, audiências, propostas, contratos e documentos. Detalhes em [01-clientes](01-clientes.md), "Visão completa do cliente".

## Os 9 painéis

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
| **Resultados** | "Resultado por processo" — taxa de sucesso, % obtido sobre o valor da causa, honorários recebidos/a receber por caso e provisão do que ainda deve entrar. Exporta CSV. |
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

## Resultados — como cada número é calculado (07/10/2026)

Fonte: `GET /api/dashboards/resultados` → regra pura `src/services/resultadoProcessos.ts` (testes em `tests/resultadoProcessos.test.mjs`). Entram os casos com número de processo (`cases.case_number`), exceto os recusados.

- **Taxa de sucesso** = casos com resultado `acordo`, `procedente` ou `procedente_parcial` ÷ todos os casos com `cases.resultado` preenchido. Defesa (cliente ré) conta.
- **Obtido sobre a causa (média)** = soma de `valor_obtido` ÷ soma de `valor_causa`, só nos casos de sucesso que têm os dois valores e em que a cliente é autora.
- **Honorários recebidos / a receber** = soma das receitas (`financial_records`, tipo receita, pago × pendente) ligadas ao caso, direto (`case_id`) ou pelo acordo do caso (`agreement_id`). Inclui entradas de parceria.
- **Provisão** (só casos em andamento) = valor da causa × taxa de sucesso × média obtida × honorário do caso. O honorário do caso é 30% se o caso é próprio; em parceria é a parte do escritório (`success_fee_percent` × (100 − `partner_split_percent`)%, ex.: Infinity Law = 15%). Ficam fora: **dativo** (o valor vem do arbitramento) e **defesa** (o ganho é economia). Caso sem valor da causa também fica fora, e o painel avisa quantos são.

## Painel da TV do escritório (desde 19/11/2026)

Endereço: **crm.advogadaleticiabarros.com.br/tv**. Página à parte do CRM, feita para ficar aberta numa TV do escritório e ser usada só com o controle remoto. Só mostra; não muda nada no sistema.

**Link curto para digitar na TV:** **is.gd/tvleticia** (leva a `/tv`; criado no encurtador is.gd em 19/11/2026, sem conta, não dá para editar nem apagar; a página continua pedindo o login do CRM).

**Como ligar na TV:** abra o navegador da TV e digite o link curto. Na primeira vez, aperte OK em "Ir para a tela de entrada" e entre com e-mail e senha (o mesmo login de sempre); depois de entrar, o CRM volta sozinho para o painel. A TV fica conectada e a sessão se renova sozinha enquanto o painel está aberto. Precisa de um usuário com acesso ao WhatsApp para o painel do WhatsApp aparecer.

**Os 4 painéis** (teclas 1 a 4, ou botões coloridos vermelho/verde/amarelo/azul):

| Painel | O que mostra |
|---|---|
| **1 · Painel geral** | Três colunas: agentes trabalhando agora (e quem está com erro), conversas do WhatsApp esperando resposta e o que precisa de atenção hoje, com a saúde do sistema. OK numa coluna abre o painel dela. |
| **2 · Escritório virtual** | A sala com todos os agentes, a cor do setor na borda e o status (verde pulsando = trabalhando agora; amarelo = em pausa; vermelho = com erro; cinza = desligado), o que cada um fez por último e há quanto tempo. No alto, a mesa da Dra. (itens esperando conferência). OK num agente abre a ficha com a descrição, os números e o histórico. |
| **3 · WhatsApp** | Conexão, recebidas e enviadas hoje, conversas esperando resposta (a mais antiga primeiro, com o tempo de espera em verde/amarelo/vermelho), maior espera, mensagens para aprovar e o movimento recente. Alerta se o WhatsApp cair ou se não chegar mensagem há mais de 6h em horário comercial. |
| **4 · Hoje** | A mesma lista do "Hoje" do CRM (prazos, audiências, conversas, parcelas…) e a saúde do sistema, com o "como resolver" do que estiver com problema. OK num item mostra o detalhe. |

**Controle remoto:** setas navegam; OK abre; Voltar (ou 0) abre e fecha o menu; canal +/− passa de painel; play/pausa liga ou desliga a rotação. O menu ("O que você quer ver?") escolhe o painel e tem os ajustes: rotação automática, modo discreto, atualizar agora e tela cheia. Funciona com as teclas de TVs LG (webOS) e Samsung (Tizen), com o mouse do controle e com teclado.

**Rotação automática:** se ligada, troca de painel a cada 30 segundos. Ao mexer no controle, a rotação espera 3 minutos. Janela aberta sem uso fecha sozinha em 4 minutos.

**Modo discreto do WhatsApp (padrão):** a TV fica à vista de clientes, então o painel mostra só o primeiro nome e a inicial do sobrenome, sem o texto das mensagens. OK no botão do painel mostra nomes completos e o começo da mensagem por 2 minutos e volta ao discreto sozinho. O telefone nunca vai para a TV.

**Atualização:** agentes e WhatsApp a cada 30 segundos; "Hoje" a cada 2 minutos; a página recarrega sozinha a cada 6 horas (pega a versão nova do CRM). Sem internet, aparece o aviso "Sem conexão com o CRM" e os últimos dados continuam na tela.

**Código:** `public/tv.html` e `public/tv.js` (JavaScript sem recursos novos, para navegador de TV antigo); dados de `GET /api/escritorio`, `GET /api/escritorio/agente/:id`, `GET /api/hoje` e `GET /api/tv/whatsapp` (`src/routes/tv.ts`, regras em `src/services/painelTv.ts`, testes em `tests/painelTv.test.mjs`).

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
| 07/10/2026 | Claude | Novo painel **Resultados** ("Resultado por processo"): taxa de sucesso, % obtido, honorários por caso e provisão |
| 19/11/2026 | Claude | Novo **Painel da TV** (`/tv`): painel geral, escritório virtual, WhatsApp (modo discreto) e hoje, usado pelo controle remoto, com menu e rotação automática |
| 19/11/2026 | Claude | Link curto **is.gd/tvleticia** e volta automática para o painel depois de entrar no CRM pela TV |

---
◀ [Fluxograma do sistema](00b-fluxograma.md) · [Visão geral](00-visao-geral.md) · Próximo: [Clientes e cadastro](01-clientes.md) ▶
