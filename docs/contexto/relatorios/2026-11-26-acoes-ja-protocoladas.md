# 26/11/2026: ações já protocoladas que continuavam "em produção"

## Pedido
Jessica: verificar no TJES se alguma ação em produção já tinha sido protocolada; depois, cadastrar como Protocolado, completo, com a cobrança da parceria, os valores e as etiquetas, sem repetir o que já estivesse protocolado.

## Feito
- **Conferência:** ações em produção × processos do CRM (MNI do TJES e DJEN por OAB) × consulta direta ao DJEN (OAB da Dra., TJES, 25/10 a 26/11). As duas fontes deram o mesmo resultado.
- **9 casos movidos para Protocolado** (#110 a #115, #131, #134, #135) por script único na VPS, que segue o caminho do botão Protocolar (`PATCH /api/cases/:id/production-stage`):
  - número do processo e data do protocolo igual à data da distribuição;
  - processo ligado ao caso, registro em `production_notes`, linha do tempo;
  - etiquetas: Parceria + tese (EMPRESTIMO / RMC / RCC / INSS, BPC/LOAS) + juizado;
  - entrada da parceria por `ajustarEntradaParceria` (lança só a diferença);
  - aviso ao parceiro;
  - **sem** WhatsApp ao cliente (regra de 19/10).
- O script confere antes de gravar: mesmo cliente, réu nas partes, número ainda não usado em outro caso e caso ainda não protocolado com o mesmo número. Rodado duas vezes, a segunda não fez nada.
- **Bug corrigido:** `lerProcesso` (`src/services/mni/cliente.ts`) lia `valorCausa` só como atributo; no MNI 2.2 o valor vem como elemento. Teste em `tests/mniPartes.test.mjs`; incidente no runbook.

## Verificado
- Banco: 9 casos protocolados, cada um ligado ao seu processo; 3 lançamentos de entrada (vencimento 03/12); 9 avisos ao parceiro; 0 mensagens novas na fila do WhatsApp.
- Build, lint (0 erros) e testes: 1.672 aprovados, 0 falhas. CI e deploy aprovados.

## Não verificado
- **Valor da causa:** ainda vazio nos 9. Vem na rodada do MNI das 15h10. A permissão negou disparar a rodada à mão.
- O eproc (JFES) pode não mandar o valor do caso #131.
- A data de distribuição do #134 é deduzida (número seguinte ao do #135).

## Decisões
- A data do protocolo é a da distribuição no tribunal, não a de hoje, para o relatório mensal da parceria ficar certo.
- O valor calculado pelo CRM não foi preenchido: vale o do tribunal, e o MNI só grava no caso se o campo estiver vazio.

## Pendente
- Conferir `valor_causa` depois das 15h10.
- #111 tem dois réus e um deles também está no #115: a Dra. conferir.
- 9 clientes do acervo antigo da parceria sem entrada no CRM: a Jessica dizer se algum ainda deve.
- Qualquer caminho que marque Protocolado sem o botão (edição/cadastro direto) pula a entrada da parceria. Avaliar levar a regra para esses caminhos.

## Próxima sessão
`SELECT id, valor_causa FROM cases WHERE id IN (110,111,112,113,114,115,131,134,135)`.

## Adendo: entradas que faltavam (mesmo dia)
Jessica: "coloque no financeiro então". Os casos #45 e #55 (parceria) estavam como protocolados desde 23/09 sem passar pelo botão Protocolar: sem nota de etapa, sem linha do tempo, data à meia-noite. Por isso a entrada nunca foi lançada. Lançado por `ajustarEntradaParceria`: R$ 100 a receber em cada (lançamentos 110 e 111, vencimento 03/12), com registro na linha do tempo. Os 9 clientes do acervo antigo não foram mexidos (aguardam confirmação).
