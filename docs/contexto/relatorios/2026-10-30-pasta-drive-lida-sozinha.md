# 30/10/2026: pasta do Drive do caso lida sozinha

## Pedido
A Jessica atualizou a pasta do Drive de um cliente com documentos novos. Na Mesa do caso, "Ler a pasta" ficou em "Lendo…" e o caso continuou com 0 documentos. Depois ela perguntou: "essa pasta é criada sozinha quando eu trago o caso do e-mail; por que o endereço não fica fixado e os documentos não vêm sozinhos, a não ser que eu inclua algo e peça num botão para atualizar?"

## Feito
- **Diagnóstico:** o log do nginx na VPS mostrou `upstream timed out` em `POST /api/cases/115/analisar-documentos` às 19:55. Pelo código, havia quatro causas:
  1. a rota lia cada arquivo com IA antes de responder (mais de 60 s);
  2. `listDriveFolderFiles` devolvia lista vazia em qualquer erro do Google;
  3. na confirmação do e-mail, os anexos iam para "CRM Jurídico - Anexos → Cliente → Caso" (conta do Gmail da parceria), mas o card recebia outra pasta, criada vazia por `createProductionFolder` com a conta Google da agenda;
  4. subpastas eram ignoradas e só o botão lia a pasta.
- **Módulo novo `src/services/pastaDrive.ts`** (dependências injetadas): lista a pasta com as subpastas, traz só o que é novo, um arquivo com falha não trava os outros, e a falha do Google vira mensagem com o que fazer.
- `importDriveFolder` (`peticaoBuilder.ts`) passou a usar o módulo e devolve `{ novos, erro }`. `analyzeCaseDrive` repassa `erroDrive`.
- `POST /api/cases/:id/analisar-documentos` roda em segundo plano e avisa no sino. Botão da Mesa renomeado para "Atualizar da pasta"; o painel antigo da produção (`app.js`) também.
- Cron `producao:pastas-drive` (25 e 55 de cada hora, 7h–21h): casos em produção antes do protocolo, com pasta, recebem os arquivos novos.
- Confirmação do e-mail (`emailIntake.ts`): grava em cada caso a pasta de `getOrCreateCaseFolderUrl` (a mesma dos anexos, da conta que lê), sem sobrescrever pasta já gravada.
- Manual (`06-documentos.md`), runbook e espelho no Obsidian atualizados.

## Verificado
- `npm run build` sem erro; `npm run lint` com 0 erros; `npm test`: 1.206 testes, 0 falhas (7 novos em `tests/pastaDrive.test.mjs`).
- Não verificado em produção: a leitura do banco de produção foi negada pela permissão da sessão. O resultado do caso 115 vai aparecer no sino depois do deploy.

## Decisões
- Uma pasta por caso (a do "CRM Jurídico - Anexos"), e não uma por cliente: se vários casos apontassem para a mesma pasta, cada um importaria os mesmos arquivos.
- Casos antigos mantêm a pasta que já têm. Se o sino disser "não está compartilhada", basta compartilhar uma vez com a conta Google do CRM.
- A leitura automática não avisa no sino quando acha arquivo novo (só registra no log), para não encher o sino a cada 30 min.

## Pendente
- Conferir no sino o resultado de "Atualizar da pasta" no caso 115 (Valmirio) e, se pedir, compartilhar a pasta.
- `createProductionFolder` continua em uso no cadastro manual de parceria (`partners.ts`) e no script `createMissingDriveFolders.ts`, com a conta da agenda. Avaliar se deve seguir a mesma pasta da conta do Gmail.

## Próxima sessão
- Se aparecer `[pasta-drive] caso N` no log do PM2, ler a mensagem: ela diz se é compartilhamento, permissão ou conexão expirada.
