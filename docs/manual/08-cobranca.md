# 08 · Cobrança e parcelas

Tudo que envolve receber (e projetar) o dinheiro do escritório.

## Receitas e parcelas

Uma receita pode ser dividida em parcelas automaticamente: informa quantas parcelas e o intervalo entre elas (padrão 30 dias), o sistema calcula o valor de cada uma e as datas de vencimento sozinho. Cada alteração de valor, juros ou desconto numa parcela recalcula o valor final e fica registrada num **log de auditoria financeira** — quem mudou, quando e o valor antes/depois.

## Baixa (registrar recebimento)

Dar baixa numa parcela registra data de pagamento, valor efetivamente recebido, método e comprovante.

## Pix e cartão (Asaas)

Integração com o Asaas permite gerar cobrança por Pix/cartão e conciliar o recebimento automaticamente via webhook — quando o cliente paga, a parcela é baixada sozinha, sem precisar checar manualmente.

## Conciliação bancária

Dá pra importar o extrato do banco (arquivo OFX, exportado direto no site do banco) e o sistema casa cada crédito recebido com uma parcela: se já tinha baixa registrada perto da mesma data, marca como **conferido**; se achou uma parcela pendente com o mesmo valor, marca como **sugestão** de baixa esquecida; o que sobra fica listado como **sem correspondência**, pra revisão manual.

## Projeção de fluxo de caixa (30/60/90 dias)

Junta entradas previstas de todas as frentes — parcelas normais, avulsos, dativas, correspondente, honorários de êxito — menos saídas previstas (despesas e repasses) — numa projeção de 30, 60 e 90 dias.

## DRE (resultado do mês/ano)

Receita menos despesa, separado por mês e por ano — a despesa soma tanto lançamentos financeiros quanto a tela de Contas a Pagar, sempre filtrando só o que é **do escritório** (o sistema também guarda despesa pessoal/familiar à parte, e não deixa ela entrar na conta do negócio).

## Inadimplência e renegociação

O sistema calcula inadimplência automaticamente e permite renegociar uma parcela em atraso (gerando novas condições) sem perder o histórico da original.

---
◀ [Agenda](07-agenda.md) · [Visão geral](00-visao-geral.md) · Próximo: Repasses e parcerias ▶
