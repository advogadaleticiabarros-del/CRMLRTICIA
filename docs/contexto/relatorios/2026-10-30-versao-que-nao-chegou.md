# 30/10/2026 — Nova versão da peça que nunca chegou

## Pedido
Jessica: "eu havia pedido uma nova versão, mas ela não chegou".

## Diagnóstico
- Esperado: a versão nova aparece em alguns minutos, com aviso no sino.
- Encontrado: nada (sem versão, sem aviso).
- Causa: a geração vive na memória do processo do CRM. Houve 4 publicações entre 20:35 e 21:07 UTC (uma delas de outra sessão, "uma peça por banco"); cada uma reinicia o PM2 (`pm2 describe`: processo criado às 21:10:29 UTC, 14 reinícios). A geração em andamento morreu sem salvar nem avisar.
- Não verificado: o horário exato do pedido no banco (consulta à produção bloqueada pela permissão). Logs do PM2 lidos (só leitura).

## Feito
- `src/services/geracaoPeca.ts` (novo, deps injetadas): ponto único da geração para o botão "nova versão" e a etapa "Criação inicial": trava, registro enquanto gera, revisão automática (etapa), aviso no sino, `retomar()` no início do CRM (máx. 2 retomadas; depois, aviso para gerar de novo).
- `src/services/geracaoPecaMysql.ts`: banco, esteira, revisão e sino; `andamentoDaPeca` (trava ou registro, para a barra não achar que acabou no intervalo do reinício).
- Migration 174 `geracoes_peca_pendentes` (só tabela nova).
- `routes/cases.ts` e `routes/mesa.ts` usam o módulo; `src/index.ts` chama `retomar()` 20 s depois de iniciar (fora do e2e).
- Docs: runbook (incidente), manual 06, decision log, ESTADO; espelho do Obsidian.

## Verificado
- TDD: 10 testes novos em `tests/geracaoPeca.test.mjs` (inclui auditoria do SQL contra as migrations), vistos falhando antes.
- `npm run build` ok, lint 0 erros, `npm test`: 1.206 passaram, 0 falhas, 33 pulados (os de banco, que rodam no CI).
- Não verificado: uma retomada real em produção (aparece na próxima publicação que pegar uma geração no meio).

## Pendente
- **Jessica:** pedir de novo a versão que se perdeu (o pedido antigo não foi registrado).

## Próxima sessão
Na próxima publicação durante uma geração, conferir no log "📝 N geração(ões) de peça retomada(s)" e o aviso no sino.
