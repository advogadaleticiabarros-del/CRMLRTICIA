# 13/11/2026 — Prazo certo das intimações + relatório diário

## Pedido
A Dra. Letícia mandou o print do e-mail do Égide (relatório das intimações de 13/11, com PDF, CSV e recorte anexos) e perguntou: "por que o meu não é assim, por que não conseguimos contar os prazos direito... por que as atualizações dos processos não chegam dessa forma para mim? De fácil entendimento, com prazo correto e contando e me dando a data final?". Depois: "faça o que for necessário".

## Feito
- **Diagnóstico** (com o código do próprio CRM e as 4 publicações de 13/11):
  - o prazo saía por palavra-chave (`src/utils/deteccaoPrazo.ts`): a sentença do JEF virou "apelação, 15 dias", termo 07/12, quando o certo é recurso inominado, 10 dias, termo 01/12;
  - homologação de cálculos e ata de julgamento viravam "15 dias";
  - a contagem partia da disponibilização;
  - a data só aparecia depois de confirmar;
  - não havia relatório.
- `src/services/prazoIntimacao.ts` (novo): regra única do prazo da intimação.
  - O tipo de justiça define o recurso (tabela `recursosCabiveis` do Leitor); o prazo escrito na decisão vale.
  - Atos sem prazo não viram prazo; texto ambíguo vai para "revisão humana", com o motivo.
  - Conta da publicação e devolve a data limite, o "protocolar até" (um dia útil antes) e a explicação da contagem.
- `src/utils/prazoUtil.ts`: `proximoDiaUtil`, `diaUtilAnterior`.
- `src/services/monitoringService.ts` (`detectDeadline`): DJEN e e-mail usam a regra nova e gravam `due_date`, `protocolar_ate` e `analise` na hora. `start_date` passou a ser a publicação. A tarefa "Analisar…" vence no "protocolar até".
- `migrations/178_prazo_intimacao_relatorio.sql`: colunas novas em `detected_deadlines` e a tabela `relatorio_intimacoes_envios`.
- `src/services/relatorioIntimacoes.ts` (montagem: HTML, texto de WhatsApp, CSV, PDF do relatório e do recorte) e `src/services/relatorioIntimacoesJob.ts` (banco, resumo pela IA, e-mail e WhatsApp da equipe).
- Rotina `intimacoes:relatorio-diario` às 7h25 (`src/crons/index.ts`). Rotas de admin `GET /api/relatorio-intimacoes/previa` e `POST /api/relatorio-intimacoes/enviar`.
- `public/app.js`: o cartão "Prazos detectados" e a confirmação mostram a data limite, o protocolar até, os alertas e a explicação. A data é formatada sem `new Date()`, para não perder um dia por causa do fuso.
- `src/services/aiAssistant.ts`: o prompt do Estagiário não fala mais em "0 dias" quando o prazo não foi identificado.
- Documentação: manual 04 e 10, runbook, decision log (e o espelho do Obsidian), `docs/api/rotas.md`, ESTADO.md.

## Verificado
- `tsc` sem erros; lint com 0 erros (32 avisos que já existiam); build OK.
- `npm test`: 1418 testes, 1384 passaram, 0 falhas. Os pulados precisam de banco e rodam no CI.
- 19 testes novos: `tests/prazoIntimacao.test.mjs` (os 4 casos reais de 13/11, mais Trabalho, rito comum, recesso, prazo escrito, horas, contrarrazões e atos sem prazo) e `tests/relatorioIntimacoes.test.mjs`. Este último conta as páginas do PDF, porque o rodapé gerava 2 páginas em branco e isso foi corrigido.
- PDF de exemplo gerado com nomes fictícios e conferido visualmente.
- **Não verificado em produção:** não houve permissão para consultar o banco da VPS. O primeiro relatório real sai às 7h25 do próximo dia com publicação nova. Também não está confirmado se o e-mail (Resend ou SMTP) está configurado na VPS.

## Decisões e porquês
- **Duas datas:** a data limite legal (CPC, art. 224, §§2º e 3º: publicação no 1º dia útil após a disponibilização) e o "protocolar até", um dia útil antes. O Égide conta a partir da disponibilização e entrega a data equivalente ao "protocolar até" (Valci: Égide 30/11, limite legal 01/12).
- **Prazo e data por regra fixa, nunca pela IA.** A IA só resume o "do que se trata".
- **Homologação de cálculos e citação vão para "revisão humana"**, sem data. É mais seguro que um padrão de 15 dias.
- **WhatsApp só para os números da equipe** (os mesmos dos avisos de prazo). Nada vai para cliente.

## Pendente
- Jessica ou Dra.: conferir se chegou o primeiro relatório (e-mail e WhatsApp). Se só o WhatsApp chegar, configurar `RESEND_API_KEY` ou SMTP no `.env` da VPS.
- Prazos detectados antes de 13/11 continuam no formato antigo, com `start_date` = disponibilização. Ao confirmar, a data sai um dia útil antes, do lado seguro.
- Feriados municipais e suspensões decretadas pelo tribunal ainda não entram na conta (aviso no relatório).

## Continuação: "não chegou nenhum e-mail"
- **Causa:** a rotina foi publicada às 11h46 de 13/11, e o envio automático é às 7h25, então ainda não tinha rodado. Além disso, a falha do e-mail era silenciosa: quando não há `RESEND_API_KEY` nem SMTP, `sendEmail` só devolve `skipped`.
- **Feito:** `motivoFalhaEmail` em `relatorioIntimacoes.ts` (teste novo). O job grava o motivo no resumo da rotina e no log, e acrescenta um aviso ao WhatsApp do relatório. Runbook e manual 04 atualizados, com o espelho.
- **Verificado:** 6/6 testes do relatório passam; tsc e lint sem erros. As 2 falhas do `npm test` são de `escritorioVirtual`, em alterações não commitadas de outra sessão, fora deste commit.
- **Não verificado:** a configuração de e-mail da VPS (a leitura do servidor foi negada pela permissão).

## Próxima sessão
Abrir `GET /api/relatorio-intimacoes/previa?dias=3` logado como admin e comparar com o próximo e-mail do Égide. Se algum ato sair errado, acrescentar a regra em `decidir()` (`prazoIntimacao.ts`) com um teste. Skills: `tdd`, `diagnosing-bugs`, `verification-before-completion`.
