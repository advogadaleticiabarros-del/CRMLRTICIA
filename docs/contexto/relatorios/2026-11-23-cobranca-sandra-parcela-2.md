# 23/11/2026 — Nova cobrança da Sandra (parcela 2/4), com valor do dia e consequências do contrato

## Pedido
1. "Envie uma nova cobrança Sandra Mara Peres Pereira com o valor atualizado para pagamento hoje." Logo depois: "me dê a mensagem aqui diretamente" (só o texto, sem enviar).
2. Ajustes no texto: "coloque o total de dias em aberto e consequência do não pagamento"; tirar a frase "Os atos necessários para evitar prejuízo grave ao seu processo continuam sendo feitos"; acrescentar o Pix (chave `<REMOVIDO>`, Nubank, Dra. Leticia Elias Barros).
3. "Envie para a Sandra estruturado para que saia certinho" (autorização de envio).

## Feito
- Valor calculado em produção, só com consulta, pelas funções do sistema (`encargosContrato.ts`, `textoCobrancaCliente`) e pelo contrato nº 12 (multa de 2% + juros de 1% a.m. + IPCA, pro rata die). Parcela `parcelas.id = 17`, venceu em 16/11/2026, 7 dias de atraso: R$ 566,66 + IPCA R$ 0,19 + multa R$ 11,34 + juros R$ 1,32 = **R$ 579,51**.
- Consequências tiradas da Cláusula Quinta do contrato nº 12 (assinado): suspensão dos atos não urgentes depois de 30 dias (a partir de 16/12/2026) e cobrança, inclusive judicial (título executivo), com possível renúncia ao mandato.
- Envio pelo fluxo de aprovação, como em 17/11 e 19/11: rascunho `atendente_rascunhos.id = 199` (agente `cobranca`, criado por `prepararParaAprovacao`, com o envio `texto_pix` e a chave CPF), enviado por `enviarRascunho`, com o registro "equipe, autorizado no Claude Code". O script recalculava o valor na hora e não enviava se o total não fosse R$ 579,51.
- Nenhuma mudança de código.

## Verificado
- Rascunho 199: status `enviada` às 14h03 (Brasília) de 23/11.
- `whatsapp_messages`: saíram o texto (id 11690) e o botão de Pix (id 11692) para a Sandra.
- Parcelas 3/4 (16/12/2026) e 4/4 (16/01/2027) em aberto e em dia. A 1/4 e a entrada estão pagas.

## Decisões e porquês
- O link do portal saiu do texto: o portal só lista as parcelas de proposta (`installments`), não as de contrato (pendência de 17/11). No lugar dele entrou a chave Pix do escritório, no texto e no botão de copiar.
- O IPCA de novembro ainda não foi publicado, então foi usado o último índice (estimado, diferença de centavos).

## Pendente
- Se ela pagar em outro dia, o valor muda (juros e IPCA diários): recalcular antes de dar baixa.
- No dia 16/12/2026 vencem a parcela 3/4 e o prazo de 30 dias de atraso da 2/4.
- Continua aberto, de 17/11: o portal não mostra as parcelas de contrato.

## Próxima sessão
Ver se a Sandra respondeu ou mandou o comprovante (WhatsApp do escritório). Se pagou, dar baixa na `parcelas.id = 17` pelo valor efetivamente pago. Nenhuma skill especializada é necessária.
