# 08 · Cobrança e parcelas

**Área:** Financeiro · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

Parcelamento automático, cobrança por Pix/cartão (Asaas) com baixa automática via webhook, conciliação bancária por importação de extrato OFX, projeção de caixa 30/60/90 dias e DRE separando negócio de despesa pessoal. Toda alteração de valor gera log de auditoria financeira.

## Contexto

Consulte pra entender como uma parcela é calculada, como a conciliação bancária decide se um crédito bate com uma cobrança, ou o que entra na projeção/DRE.

## Receitas e parcelas

Uma receita pode ser dividida em parcelas automaticamente: informa quantas parcelas e o intervalo entre elas (padrão 30 dias), o sistema calcula o valor de cada uma e as datas de vencimento sozinho. Cada alteração de valor, juros ou desconto numa parcela recalcula o valor final e fica registrada num **log de auditoria financeira** — quem mudou, quando e o valor antes/depois.

## Baixa (registrar recebimento)

Dar baixa numa parcela registra data de pagamento, valor efetivamente recebido, método e comprovante.

## Pix e cartão (Asaas)

Integração com o Asaas permite gerar cobrança por Pix/cartão e conciliar o recebimento automaticamente via webhook — quando o cliente paga, a parcela é baixada sozinha, sem precisar checar manualmente.

## Conciliação bancária

Dá pra importar o extrato do banco (arquivo OFX, exportado direto no site do banco) e o sistema casa cada crédito recebido com uma parcela: se já tinha baixa registrada perto da mesma data, marca como **conferido**; se achou uma parcela pendente com o mesmo valor, marca como **sugestão** de baixa esquecida; o que sobra fica listado como **sem correspondência**, pra revisão manual.

## Meta do mês

A Visão Geral mostra uma barra de progresso "Meta do mês" (recebido × meta, %, contratos fechados no mês) — vem de `GET /api/goals/current` (`src/services/goalsService.ts`), o mesmo motor usado pelo briefing matinal. A meta **sobe 10% sozinha** no mês seguinte sempre que a meta do mês anterior é batida (regime de caixa — conta o que foi *recebido*, não o que foi contratado); se você editar a meta manualmente em Configurações, isso é respeitado (`source='manual'`) até o próximo mês recalcular. Editar a meta em Configurações atualiza as duas fontes ao mesmo tempo (desde 22/09/2026 — antes só atualizava `office_settings`, e a Visão Geral e o briefing podiam mostrar percentuais diferentes pro mesmo dia).

## Painel de destaque (Financeiro → Visão geral)

O topo da tela mostra 4 números grandes, de relance, sem precisar rolar: **resultado do mês** (já realizado), **previsão fechada do mês**, **a receber nos próximos 30 dias** e **projeção acumulada de 90 dias**. Adicionado 04/09/2026 — os dados já existiam espalhados em blocos de KPI mais abaixo na mesma tela; isso só resume os 4 que mais importam pra decisão do dia a dia, antes de qualquer outro detalhe.

## Recebi um pagamento (desde 02/10/2026)

Atalho para lançar dinheiro que **já entrou**, em um passo: botão **+ Registrar → Recebi um pagamento** (quem pagou, valor, data, forma, referente a, comprovante opcional) ou, na conversa do WhatsApp, o botão **💸 É comprovante? Registrar** em cada foto/PDF recebido de um contato — a IA lê valor e data do comprovante e o cliente vem do telefone; você confere e registra. Vira receita + parcela **pagas** (aparece em Visão geral, relatórios e previsão) e o comprovante vai para Documentos do cliente (pasta Financeiro). Rota `POST /api/receitas/recebimento`; regras em `src/services/recebimentoRegras.ts` (testadas).

Motivo: em 02/10/2026 o financeiro tinha 0 lançamentos nos últimos 30 dias — os recebimentos não estavam sendo anotados no CRM.

## Acordos a registrar (desde 02/10/2026)

O sistema passou a ler acordo nas movimentações dos processos: "Homologação de Transação", "homologado acordo", "HOMOLOGO o acordo", "sentença homologatória de acordo", conciliação homologada (→ **homologado**) e "petição/termo de acordo", "as partes celebraram acordo" (→ **juntado**). Não confunde com "Homologação de Decisão de Juiz Leigo" (sentença) nem com "sem acordo"/conciliação infrutífera.

- Cada processo com acordo entra uma vez na fila **Financeiro → Acordos → 🤝 Acordos a registrar** e avisa a equipe no sino (com som).
- **Registrar** abre o cadastro rápido: cliente (quem você representa), parte contrária, valor total, entrada, nº de parcelas, 1º vencimento, % de honorários (30% sugerido), sucumbência e onde cai o dinheiro (direto ao cliente ou via escritório, gerando repasse). Entra como *Homologado* (ou *Proposto* se só foi juntado) e lança honorários/repasses no financeiro como o cadastro completo.
- **Não é acordo** tira o processo da fila. **Procurar nos processos** revarre os últimos 180 dias.
- Varredura inicial feita em 02/10/2026 (script `varrerAcordosDetectados`).

Regras em `src/services/deteccaoAcordo.ts` (testadas); fila em `acordosDetectados.ts`, tabela `acordos_detectados`.

## Previsão realista do mês (desde 30/09/2026)

Cartão em *Financeiro → Visão geral*, logo abaixo da meta:

- **Deve entrar até o fim do mês** = já recebido + (a receber no mês × taxa de recebimento). A taxa é quanto do valor que venceu nos últimos 90 dias (parcelas de clientes e de receitas) foi de fato pago — se nada venceu ainda, conta 100%.
- **Se todos pagarem** = cenário otimista (tudo que está previsto no mês).
- **Novos contratos (ponderado)** = propostas enviadas/em negociação × chance de fechar: a *Prob. fechamento (%)* do lead quando preenchida; senão, a taxa de aceite das propostas decididas nos últimos 6 meses (30% se ainda não há histórico). Fica fora da previsão do mês porque proposta aceita não vira caixa na hora.

Endpoint `GET /api/dashboards/financeiro/previsao-ponderada`; regras em `src/services/previsaoPonderada.ts` (testadas).

## Projeção de fluxo de caixa (30/60/90 dias)

Junta entradas previstas de todas as frentes — parcelas normais, avulsos, dativas, correspondente, honorários de êxito — menos saídas previstas (despesas e repasses) — numa projeção de 30, 60 e 90 dias.

## DRE (resultado do mês/ano)

Receita menos despesa, separado por mês e por ano — a despesa soma tanto lançamentos financeiros quanto a tela de Contas a Pagar, sempre filtrando só o que é **do escritório** (o sistema também guarda despesa pessoal/familiar à parte, e não deixa ela entrar na conta do negócio).

## Inadimplência e renegociação

O sistema calcula inadimplência automaticamente e permite renegociar uma parcela em atraso (gerando novas condições) sem perder o histórico da original.

**Duas coisas diferentes com o mesmo nome (desde 22/09/2026 unificadas onde faziam sentido):**
- **"Inadimplência" (número, no Cockpit e no topo do Financeiro)** — total vencido somando as 6 fontes de receita do escritório (clientes/contratos, parcelas de proposta, dativo, correspondente, parcerias, êxitos). Vem de `getFinanceSummary()`, uma função só, usada nos dois lugares — antes cada tela calculava por conta própria e podiam divergir.
- **Aba "Inadimplência" (fila de cobrança acionável)** — só parcelas de **cliente** (`parcelas`), porque é a única fonte onde faz sentido "renegociar", escalar pra cobrança jurídica ou marcar tentativa de contato. Dativo, correspondente e parcerias entram no número total acima, mas não têm fila de cobrança própria — são recebíveis de outra natureza (Estado, terceiros), sem esse fluxo de negociação com cliente. Essa fila recalcula sozinha todo dia às 6h50 (antes só atualizava quando alguém clicava "Recalcular agora").

## A Receber: filtro do mês ou período (desde 07/10/2026)

Em **Financeiro › A Receber — todas as frentes** há o campo **Mês** (os últimos 12 meses, o mês atual e os próximos 6), além de **De/Até** para um período livre. Escolher o mês preenche De/Até; mexer em De/Até vira "Período personalizado".

**Qual data conta no período:**
- o que já foi **recebido** conta pela **data em que o dinheiro entrou**. Ex.: alvará que vencia em setembro e caiu em 02/10 entra em outubro;
- o que está **a receber** conta pelo **vencimento**;
- item sem data (ex.: dativo sem previsão) só aparece em "Todo o período".

**Os quatro cards do topo** (Total programado, Já recebido, A receber, Vencido) passam a seguir o **período, a origem e a busca** e mostram o período no título. A **situação** (A receber / Recebidos / Vencidos) filtra só a lista, porque os próprios cards já separam essas situações. Antes, os cards eram sempre de todos os tempos.

O filtro roda no servidor: `GET /api/financial/a-receber?mes=AAAA-MM` (ou `de`/`ate`), `status`, `fonte`, `busca`. Regras em `src/services/aReceberFiltro.ts` (testes em `tests/aReceberFiltro.test.mjs`).

## FAQ

**A despesa pessoal da família aparece no resultado do escritório?** Não deveria — o sistema guarda despesa pessoal/familiar separada por escopo, e o DRE do escritório filtra só `escopo='empresa'`.

**Preciso importar o extrato toda semana pra conciliação funcionar?** Não é automático — é uma ferramenta sob demanda: você importa o OFX quando quiser conferir, não roda sozinha.

**Renegociar uma parcela apaga a parcela original?** Não — gera novas condições mantendo o histórico da parcela original, pra auditoria.

## Links relacionados
- [Clientes e cadastro](01-clientes.md) — cada parcela pertence a um cliente
- [Repasses e parcerias](09-repasses.md) — saídas que entram na projeção de caixa
- [Dativo](05-dativo.md) — financeiro do dativo é separado deste

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 07/10/2026 | Claude | A Receber: filtro de mês/período, cards seguindo o período; corrigido card Vencido que mostrava R$ 0,00 |
| 02/10/2026 | Claude | "Recebi um pagamento" pelo botão + e pelo comprovante no WhatsApp |
| 02/10/2026 | Claude | Acordos detectados nas movimentações + cadastro rápido de acordo |
| 30/09/2026 | Claude | Previsão realista do mês (taxa histórica de recebimento) e pipeline de propostas ponderado |
| 03/09/2026 | Claude | Criação do documento |
| 04/09/2026 | Claude | Adicionado painel de destaque no topo da Visão Geral — resultado do mês, previsão, a receber 30d, projeção 90d |
| 22/09/2026 | Claude | Unificadas as 3 contas de "Inadimplência" que podiam divergir (Cockpit, topo do Financeiro, aging) — todas usam `getFinanceSummary()`; a 4ª (fila de cobrança) mantém escopo próprio (só parcelas de cliente) de propósito, e recalcula sozinha todo dia às 6h50 |
| 23/09/2026 | Claude | "Meta do mês" da Visão Geral unificada com o motor real (`getGoalProgress()`) — antes calculava do zero a partir de `office_settings` + projeção de caixa, podendo divergir do que o briefing matinal mostrava para o mesmo dia |

---
◀ [Agenda](07-agenda.md) · [Visão geral](00-visao-geral.md) · Próximo: [Repasses e parcerias](09-repasses.md) ▶
