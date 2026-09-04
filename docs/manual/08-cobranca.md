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

## Painel de destaque (Financeiro → Visão geral)

O topo da tela mostra 4 números grandes, de relance, sem precisar rolar: **resultado do mês** (já realizado), **previsão fechada do mês**, **a receber nos próximos 30 dias** e **projeção acumulada de 90 dias**. Adicionado 04/09/2026 — os dados já existiam espalhados em blocos de KPI mais abaixo na mesma tela; isso só resume os 4 que mais importam pra decisão do dia a dia, antes de qualquer outro detalhe.

## Projeção de fluxo de caixa (30/60/90 dias)

Junta entradas previstas de todas as frentes — parcelas normais, avulsos, dativas, correspondente, honorários de êxito — menos saídas previstas (despesas e repasses) — numa projeção de 30, 60 e 90 dias.

## DRE (resultado do mês/ano)

Receita menos despesa, separado por mês e por ano — a despesa soma tanto lançamentos financeiros quanto a tela de Contas a Pagar, sempre filtrando só o que é **do escritório** (o sistema também guarda despesa pessoal/familiar à parte, e não deixa ela entrar na conta do negócio).

## Inadimplência e renegociação

O sistema calcula inadimplência automaticamente e permite renegociar uma parcela em atraso (gerando novas condições) sem perder o histórico da original.

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
| 03/09/2026 | Claude | Criação do documento |
| 04/09/2026 | Claude | Adicionado painel de destaque no topo da Visão Geral — resultado do mês, previsão, a receber 30d, projeção 90d |

---
◀ [Agenda](07-agenda.md) · [Visão geral](00-visao-geral.md) · Próximo: [Repasses e parcerias](09-repasses.md) ▶
