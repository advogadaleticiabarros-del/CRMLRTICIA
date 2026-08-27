# Excluir contrato de teste (com motivo e reversão financeira) — design

## Contexto

A tela de Contratos hoje só tem "Abrir/Editar" — não existe nenhuma rota
`DELETE` em `contracts.ts`. A usuária encontrou um contrato de teste
("Contrato — Jessica", `id=6`, valor R$0,00) que precisa remover, e pediu
um botão que peça o motivo e garanta que nada fique "sobrando" na
contabilidade — nem o caso na esteira de produção, nem parcelas/lançamentos
vinculados.

Investigação em produção (2026-08-27) mostrou que este contrato específico
está ligado a um caso já existente (`cases.id=59`, "Processo — Jessica",
`separacao_documentos`) mas **sem nenhuma parcela ou lançamento financeiro**
ainda — o vínculo `case_id` não estava preenchido nas propostas relacionadas
(mesmo bug corrigido em `docs/superpowers/specs/2026-08-27-aceite-publico-caso-parcelas-design.md`).
O design abaixo cobre o caso geral, não só este exemplo: contratos futuros
podem ter parcelas pendentes ou até pagas vinculadas.

## 1) Escopo da exclusão

Ao excluir um contrato, o sistema remove o "pacote completo do processo de
teste":

- o **contrato** em si (`contracts`);
- o(s) **caso(s)** vinculado(s) na esteira de produção (`cases`);
- **parcelas pendentes** vinculadas a esse(s) caso(s) (`installments` com
  `status != 'pago'`);
- **lançamentos financeiros pendentes** vinculados (`financial_records`
  com `status != 'pago'`, `case_id` nesse conjunto).

Como não existe FK direta `contracts → cases`, a vinculação é feita pelo
mesmo `client_id` (e `lead_id`, quando presente) do contrato — reunindo os
casos criados a partir da mesma proposta/lead que gerou o contrato.

## 2) Trava de segurança: dinheiro já recebido bloqueia a exclusão

Antes de apagar qualquer coisa, o sistema verifica se há **qualquer**
`installments.status = 'pago'` ou `financial_records.status = 'pago'`
vinculado aos casos identificados. Se houver, a exclusão é recusada com uma
mensagem clara — não há como excluir de forma automática um processo que já
recebeu dinheiro de verdade; isso exige ajuste manual (estorno) antes.

## 3) Motivo obrigatório, registrado antes de apagar

A rota exige um campo `motivo` (texto, mínimo 5 caracteres) no corpo da
requisição. Antes de qualquer `DELETE`, grava um evento em
`client_timeline` (via `logTimeline`, já usado em `documents.ts`) com
`event_type: 'contrato_excluido'` e a descrição incluindo o motivo digitado
e quem excluiu. Como `client_timeline.contract_id`/`case_id` não têm FK
(só `client_id` tem `ON DELETE CASCADE`), o registro sobrevive à exclusão
do contrato e do caso, permanecendo visível na ficha do cliente.

## 4) Backend — `DELETE /api/contracts/:id`

Corpo: `{ motivo: string }`.

Sequência, dentro de uma transação:

1. Busca o contrato (`client_id`, `lead_id`, `title`).
2. Identifica os casos vinculados: `cases` com o mesmo `client_id` (e,
   quando `lead_id` do contrato existir, prioriza casos criados a partir
   da mesma proposta — mas na ausência de vínculo direto, todos os casos
   ativos desse cliente entram no escopo, já que o objetivo é "zerar o
   processo de teste" desse cliente).
3. Verifica a trava do item 2 — aborta com HTTP 409 se houver parcela ou
   lançamento pago.
4. Registra o motivo em `client_timeline` (item 3).
5. Apaga `installments` pendentes desses casos, `financial_records`
   pendentes desses casos, os `cases`, e por fim o `contract`.
6. Não altera a `proposta` de origem (ela perde a referência ao caso
   apagado, mas continua existindo — evita reabrir inconsistência maior
   nesse fluxo já frágil).

## 5) Frontend — botão "Excluir" na lista de Contratos

Na linha de cada contrato (`public/app.js`, tela de Contratos), ao lado de
"Abrir/Editar", adiciona um botão "Excluir". Ao clicar, abre um
mini-formulário: campo de texto obrigatório para o motivo, com um aviso
explícito do que será removido junto (contrato + caso da esteira +
parcelas pendentes). Ao confirmar, chama `DELETE /api/contracts/:id` com o
motivo; em caso de sucesso, toast + recarrega a lista; em caso de bloqueio
(409, parcela paga), mostra a mensagem de erro do servidor.

## Fora de escopo

- Não implementa soft-delete/cancelamento reversível — a exclusão é
  definitiva (registrada só via timeline, não via um registro que pode ser
  restaurado).
- Não altera a proposta de origem além de deixar de referenciar o caso
  apagado.
- Não cobre exclusão em lote (múltiplos contratos de uma vez).
