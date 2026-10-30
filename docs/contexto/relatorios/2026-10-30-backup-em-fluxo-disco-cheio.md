# 30/10/2026: backup em fluxo (disco cheio, CRM morto por falta de memória)

## Pedido
A Jessica pediu ajuda para verificar o alarme "Disco do servidor do CRM em 89% (10,1 GB livres de 96 GB)", seguindo o runbook (14-runbook.md, "Disco do servidor cheio").

## Feito
- Diagnóstico na VPS:
  - `/tmp` com 21 GB: 23 arquivos `crm-backup-*.sql` de cerca de 925 MB, todos em claro.
  - Build Cache do Docker em 44,6 GB (42 GB podem sair).
  - `journalctl -k` mostra 9 "Out of memory: Killed process … node /home/crmapp/app/dist/index.js" (cerca de 4,2 GB) entre 29 e 30/10, nos horários do backup e da recuperação.
  - O último backup local bom é `crm-backup-2026-10-28T22-00-00`.
- Causa: o backup lia o dump inteiro na memória, depois comprimia, cifrava e conferia (várias cópias de cerca de 1 GB). A VPS tem 8 GB e nenhum swap. O processo era morto antes do `finally`, que apagaria o .sql.
- Código:
  - `src/utils/crypto.ts`: `cifrarArquivoEmFluxo` (gzip mais AES-GCM direto para o arquivo, mesmo formato `CRMENC1|iv|tag|cifra`; a etiqueta é gravada no fim, no lugar reservado) e `abrirBackupEmFluxo`.
  - `src/services/backupService.ts`:
    - o dump vira `~/backups-crm/.parcial-<nome>`;
    - `verificarArquivoBackup(caminho)` confere o arquivo lendo do disco;
    - depois ele é renomeado para backup local, e o MEGA o envia lendo do disco por stream;
    - `limparSobrasDeTentativas()` apaga .sql órfãos e parciais no começo de cada backup.
  - Testes: `tests/backupFluxo.test.mjs` (4 testes).
- Documentação: `docs/manual/14-runbook.md` (incidente "segunda vez" e changelog) e `docs/contexto/ESTADO.md`.

## Verificado
- Testes de backup, criptografia e regras: 30 passaram, 0 falharam. `npm test` completo: 1.132 passaram, 0 falharam. Lint: 0 erros (o único aviso já existia).
- Teste de carga local com dump falso de 904 MB: pico de 187 MB de memória, conferência aprovada, 6 s.
- Deploy `8b70e13`: testes e deploy OK (11:54 a 11:57 UTC).
- **Produção:** o backup `crm-backup-2026-10-30T12-00-00` (código novo) saiu com `m:1 l:1 v:1`, 457 MB de SQL e 126 tabelas, sem nenhum "Killed process". O envio por stream ao MEGA funcionou. Os .sql órfãos do /tmp sumiram (apagados pela `limparSobrasDeTentativas`), e o disco foi de 89% para 25% (72 GB livres).
- Com a autorização da Jessica, rodei `rm /tmp/crm-backup-*.sql` (já não havia nenhum) e `docker builder prune -f`. O cache já estava em 0 B: não ficou claro quem limpou antes, mas há atividade do Docker às 11:54 UTC.

## Decisões e porquês
- Mesmo formato de arquivo, para os backups antigos, a restauração e a prova continuarem funcionando sem migração.
- O arquivo nasce como `.parcial-`: um backup não conferido não entra na rotação nem vira o "mais recente".
- O local agora é gravado antes e o MEGA depois, em sequência, para os dois lerem o mesmo arquivo sem corrida. A falha de um continua não impedindo o outro.
- Descartado: swap ou mais RAM na VPS. Isso só adiaria o problema, porque o banco continua crescendo.

## Pendente
- Trocar a faxina semanal no crontab do root para `docker builder prune -f` sem `--filter until=168h`. Esse filtro não segurou o cache, que voltou a 44 GB em duas semanas. A edição remota foi barrada pela permissão do auto mode, mesmo com a autorização da Jessica.
- Passar `restoreService.ts` (prova mensal) para fluxo: ainda usa `downloadBuffer` e `decryptBuffer` com cerca de 1 GB na memória.

## Próxima sessão
Na VPS: `ls -la /home/crmapp/backups-crm | tail -3; ls /tmp/crm-backup-*.sql; journalctl -k --since today | grep "Killed process"; df -h /`. Skills: `diagnosing-bugs` e `tdd` para a prova de restauração.
