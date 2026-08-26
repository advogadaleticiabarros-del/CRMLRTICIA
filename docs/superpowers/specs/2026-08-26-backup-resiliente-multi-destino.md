# Backup resiliente multi-destino — Design

**Status:** aprovado pela usuária via brainstorming em 2026-08-26, decisões coletadas uma por vez.

## Contexto

O backup diário do CRM (dump completo do MySQL, cifrado com AES-256-GCM antes de sair da VPS — `src/utils/crypto.ts`) tem hoje **um único destino**: uma conta MEGA gratuita. Essa conta foi bloqueada pelo próprio MEGA (`EBLOCKED (-16): User blocked` — bloqueio típico de contas free quando o acesso vem sempre do mesmo IP de servidor, de forma automatizada, padrão exato de um cron diário). Os backups pararam de subir a partir do bloqueio, sem que ninguém percebesse até o alerta automático do sistema (`avisarAdmins` em `src/crons/runner.ts`) disparar.

O dump contém CPF, laudos médicos e conversas de clientes — dado sensível de saúde, categoria mais protegida pela LGPD (art. 11). Um único ponto de falha de destino apagando toda a proteção de backup, silenciosamente, é o risco central que este design elimina.

**Decisão já tomada e em andamento, fora do escopo deste spec**: a usuária criou uma conta MEGA nova, cadastrada como secrets `MEGA_EMAIL`/`MEGA_PASSWORD` no GitHub, gravados no `.env` da VPS pelo próprio workflow de deploy (`.github/workflows/deploy.yml`, commit `82ff4cc`) — mesmo mecanismo já usado para `OPENAI_API_KEY`. Este spec cobre o que vem depois: tornar o sistema de backup resiliente a esse tipo de falha acontecer de novo, com qualquer conta MEGA.

## Decisão 1 — Frequência: 3x ao dia (02h, 09h, 19h)

Hoje só há um `cron.schedule('0 2 * * *', ...)` (`src/crons/index.ts:221`). A usuária pediu explicitamente 3 execuções diárias: 02h (mantém — horário de menor uso do sistema), 09h e 19h (cobre o expediente, reduzindo a janela de perda de dados se algo acontecer no meio do dia). As 3 rodam a mesma rotina, cada uma como sua própria entrada de `job_runs` (nomeada `backup:diario`) — sem diferenciação por horário, já que o comportamento é idêntico.

## Decisão 2 — Um único dump por execução, reaproveitado nos 3 destinos

`runBackup()` hoje gera um `mysqldump`, cifra o resultado, e sobe pro MEGA. A versão nova gera o mesmo dump/buffer cifrado **uma vez** por execução e o entrega a 3 destinos:
1. Upload para o MEGA (como já funciona).
2. Gravação em arquivo na VPS, fora da pasta do app.
3. Fica disponível para download manual pelo botão do CRM (serve o arquivo do destino 2, não gera um terceiro).

Gerar um `mysqldump` só (em vez de um por destino) evita triplicar a carga no banco a cada execução — o dump já é a parte mais pesada da rotina.

## Decisão 3 — Destino local: fora de `~/app`, retenção de 14 arquivos

O workflow de deploy roda `git reset --hard origin/main` dentro de `~/app` a cada push (`.github/workflows/deploy.yml`) — qualquer arquivo salvo ali dentro seria apagado no próximo deploy. O destino local fica em `~/backups-crm` (fora da árvore do repositório), criado se não existir.

Retenção: **14 arquivos mais recentes** (rotação automática, mesmo padrão de nome `crm-backup-<timestamp>.sql.gz.enc` já usado no MEGA, ordenação lexicográfica pelo timestamp ISO no nome). Com 3 backups/dia isso cobre pouco mais de 4 dias de histórico local — a usuária decidiu que o MEGA continua sendo o arquivo de longo prazo (30 dias), e o local é a camada rápida de emergência, não o histórico completo.

## Decisão 4 — Destinos independentes: falha de um não impede o outro, alertas separados

Esta é a correção direta da causa raiz do incidente atual. Hoje, se o MEGA falha, `runBackup()` inteiro falha (lança e é capturado por `runJob`, que gera **um** alerta genérico "Backup não realizado"). Na versão nova:

- MEGA e disco local são tentados **independentemente** — a falha de um não impede a tentativa do outro.
- Cada destino gera seu próprio resultado (`{ok, message}`), e a rotina reporta um resumo combinado.
- `runJob` (`src/crons/index.ts`, job `backup:diario`) lança erro (disparando o alerta crítico já existente) **somente se AMBOS os destinos falharem** — se só um falhar, o job é considerado parcialmente bem-sucedido, mas ainda registra e alerta especificamente sobre o destino que falhou, para que a usuária saiba que está rodando em um destino só e precisa investigar antes que o segundo também falhe.

Isso significa dois níveis de alerta:
- **Crítico** (via `avisarAdmins(..., critica: true)`, mensagem "Backup não realizado em nenhum destino"): quando MEGA E local falham na mesma execução.
- **Aviso** (mesmo mecanismo, não-crítico): quando só um destino falha — nomeando qual (ex.: "Backup local OK, mas MEGA falhou: <mensagem>").

## Decisão 5 — Download manual: nova rota, reaproveita a tela existente

Nova rota `GET /api/backup/download-local` (autenticada, mesmo middleware das demais rotas de `/api/backup`) que serve o arquivo local mais recente como download direto (`Content-Disposition: attachment`), já cifrado — não decifra no servidor, mesma postura de "backup vazado devia virar lixo" que já rege `encryptBuffer`. A tela de Backup existente no CRM (`public/app.js`, já tem `GET /api/backup` e `POST /api/backup/run`) ganha um botão "Baixar backup local" ao lado do botão de rodar agora.

## Decisão 6 — Prova de restauração mensal continua testando só o MEGA

O job `backup:prova-de-restauracao` (dia 1 do mês, `src/services/restoreService.ts`) já baixa o backup mais recente do MEGA e restaura num banco temporário para provar que o backup é utilizável. Como os 3 destinos recebem o mesmo dump/buffer nesta versão, testar o do MEGA já prova a integridade do conteúdo que também está local — não há necessidade de duplicar esse teste para o arquivo local.

## Global Constraints

- Backup automático roda 3x/dia: 02h, 09h, 19h (`America/Sao_Paulo`).
- Um único `mysqldump` + cifragem por execução, entregue aos 3 destinos (MEGA, local, disponível para download).
- Destino local em `~/backups-crm`, fora da árvore do deploy (`~/app`), sobrevive a `git reset --hard`.
- Retenção local: 14 arquivos mais recentes. Retenção MEGA: mantém 30 (já existente, sem mudança).
- MEGA e local falham/reportam independentemente — nunca a falha de um impede a tentativa do outro.
- Alerta crítico apenas quando ambos os destinos falham na mesma execução; alerta de aviso (não-crítico) quando só um falha, nomeando qual.
- Arquivo servido para download manual permanece cifrado (nunca decifra no servidor antes de entregar).
- Sem testes automatizados de e2e contra o MEGA real (custaria acesso de rede real a cada CI); a lógica de seleção/rotação/decisão de destino independente é testável com filesystem/mocks locais, sem precisar de credenciais reais.
