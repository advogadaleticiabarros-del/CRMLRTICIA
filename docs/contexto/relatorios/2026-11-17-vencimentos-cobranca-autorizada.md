# 17/11/2026 — Vencimentos no WhatsApp do escritório e cobrança só com autorização

## Pedido
1. "Vamos enviar um lembrete de pagamento já calculando a multa e juros contratual atualizado para hoje" (parcela 2/4 de Honorários contratuais de Sandra Mara Peres Pereira, R$ 566,66).
2. No meio da tarefa: "Não envie cobranças automáticas, quero receber lembretes de vencimentos no WhatsApp, não estamos recebendo, e só pode enviar para o cliente se eu autorizar o envio da cobrança e sempre, sempre calcular os juros atualizados."

## Feito
- **Depois ("sempre calcule de acordo com cada contrato do cliente"):** `src/services/encargosContrato.ts` lê a cláusula de atraso do contrato de cada cliente e calcula multa, juros e IPCA (série 433 do BCB) pro rata die; usado em `vencimentosEscritorio.ts` e no portal (`src/routes/portal.ts`: valor atualizado e Pix). Campos de multa/juros saíram de Configurações (`public/app.js`). Testes: `tests/encargosContrato.test.mjs`.
- `src/services/vencimentosEscritorio.ts` (novo):
  - `calcularEncargos` aplica multa de 2% e juros de 1% ao mês pro rata die (cláusula de inadimplemento dos modelos em `contractTemplates.ts`).
  - `montarAvisoVencimentos` monta o WhatsApp ao escritório com as vencidas (já atualizadas), as de hoje e as dos próximos 3 dias.
  - `textoCobrancaCliente` monta a mensagem ao cliente.
  - `prepararCobranca` cria o rascunho em Mensagens para aprovar, uma vez por parcela, e recalcula o texto todo dia enquanto ele estiver pendente.
  - `avisarVencimentosEscritorio` é o job.
- `src/crons/index.ts`: job `financeiro:vencimentos-escritorio` às 8h e às 12h. Saiu a régua de e-mail ao cliente (`sendBillingReminders`).
- `src/services/whatsappQueue.ts`: não gera mais cobrança ao cliente.
- `src/services/uazapiInstance.ts`: o envio automático da fila ignora `context = 'cobranca'`.
- `src/services/aprovacaoMensagens.ts`: novo agente "Cobrança".
- Testes: `tests/vencimentosEscritorio.test.mjs` (9).
- Manual: `docs/manual/08-cobranca.md`, `14-runbook.md` e `17-decision-log.md`, copiados para o espelho no Obsidian.

## Verificado
- `npm run build` e `npm run lint` sem erros. `npm test`: 1.455 passaram, 0 falharam (os testes com banco rodam no CI).
- Consulta só de leitura em produção: a parcela da Sandra é `parcelas.id = 17`, vence em 16/11/2026, está `atrasado` e custa R$ 566,66. Em 17/11 são 1 dia de atraso, multa R$ 11,33, juros R$ 0,19, total **R$ 578,18**.
- Deploy `6a353f1` publicado (workflow com sucesso).
- Deploy `f39d8d5` (encargos por contrato) publicado. Conferido em produção, só leitura: os 13 contratos lidos certo (12 com multa 2% + juros 1% a.m. + IPCA; o nº 1 sem cláusula = sem encargos); IPCA disponível até 10/2026 (0,14%); Sandra pelo contrato nº 12 em 17/11 = R$ 578,21 (IPCA R$ 0,03 estimado pelo último índice).
- Atenção: durante a tarefa outra sessão trocou a pasta para o branch `design-system-3`; o commit `f39d8d5` foi feito nele (logo acima da `main`) e publicado na `main` por fast-forward, sem mexer no trabalho dela.
- Rascunho da Sandra criado em produção (`atendente_rascunhos.id = 166`) e, com a autorização da usuária ("pode enviar apenas essa cobrança"), enviado pelo fluxo da equipe (`enviarRascunho`): status `enviada` às 12h01 (Brasília) de 17/11. Só esse foi enviado.

## Decisões e porquês
- Sem cláusula de atraso no contrato = sem encargos (com alerta), em vez de um padrão que o contrato não prevê. Levantamento de 17/11: 13 contratos, 12 com multa 2% + juros 1% a.m. + IPCA, o nº 1 sem cláusula.
- IPCA: mês sem índice publicado usa o último; deflação não reduz o valor; multa e juros incidem sobre o valor corrigido.
- Os encargos seguem o **contrato** (2% + 1% a.m.), não as Configurações do escritório (`multa_percent=5`, `juros_mes_percent=2`), que o portal usa. A cobrança cita o contrato e, em relação de consumo, a multa é limitada a 2% (CDC, art. 52, §1º).
- Cobrança ao cliente usa a fila de aprovação já existente (`prepararParaAprovacao`), não a `whatsapp_queue`, que se envia sozinha.
- O rascunho é recalculado todo dia, e não na hora do envio, para não mexer no fluxo de envio aprovado, que tem trava de teste.
- Descartou o rascunho? Ele não volta, porque o marco fica em `sent_reminders` (`cobr_rascunho_<fonte>_<id>`).

## Pendente
- A cobrança da Sandra já enviada saiu com R$ 578,18 (sem IPCA); pelo contrato completo, hoje seriam R$ 578,21 (3 centavos de IPCA).
- O portal só lista parcelas de proposta (`installments`), não as de contrato (`parcelas`).
- A tela A Receber mostrou a parcela como 15/11, mas no banco ela vence em 16/11. Suspeita: o fuso ao formatar a data. Não investigado.
- Parcela `parcial` é cobrada pelo `valor_final` inteiro, não pelo saldo.
- Itens antigos de cobrança que ficaram pendentes na `whatsapp_queue` não saem mais. Ficam na fila até alguém descartar.

## Próxima sessão
Conferir em `job_runs` se `financeiro:vencimentos-escritorio` rodou às 8h de 18/11 e se a Jessica recebeu o WhatsApp. Skills: `diagnosing-bugs` se não chegar; `tdd` + `domain-modeling` para o IPCA.
