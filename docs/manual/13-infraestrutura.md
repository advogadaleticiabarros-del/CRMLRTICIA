# 13 · Onde tudo roda (infraestrutura)

**Área:** Sistema · **Autor:** Claude (levantado do código-fonte e do servidor real) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

O CRM roda numa VPS própria na Hostinger (não mais no Railway, que foi desligado em 03/09/2026), com banco de dados MySQL local, backup automático 3x ao dia (criptografado, local + nuvem), e deploy que puxa o código do GitHub sozinho — mas hoje ainda precisa de um reinício manual do processo pra valer de fato.

## Contexto

Consulte pra entender onde o sistema roda de verdade, como o deploy funciona, ou o que aconteceria se o servidor caísse.

## Servidor

- **Onde**: VPS Hostinger (`srv1921337.hstgr.cloud`), Ubuntu 24.04, IP `179.199.128.68`.
- **Domínio**: `crm.advogadaleticiabarros.com.br` aponta direto pra essa VPS.
- **Aplicação**: Node.js/Express, gerenciada pelo PM2 (processo `crm-juridico`), caminho `/home/crmapp/app`.
- **Banco**: MySQL, rodando localmente na mesma VPS (não é um serviço de banco externo).
- **Documentos**: armazenados no MEGA (nuvem separada do servidor) — não ocupam disco da VPS.
- **A mesma VPS também hospeda** o Orbit (ecossistema de marketing), num container Docker separado, sem interferir no CRM.
- **Laya** (desde 16/10/2026): o modelo de decisão grátis roda no PM2 do crmapp (processo `laya`), só em 127.0.0.1:8765. O CRM fala com ela por `LAYA_URL`. Detalhes em [16-ferramentas-acessos](16-ferramentas-acessos.md).
- **Capacidade (medida em 16/10/2026):**
  - **Processador:** 2 núcleos, quase ociosos.
  - **Memória:** 8 GB, com cerca de 4 GB livres. Os maiores consumidores são a Laya (1,7 GB) e o MySQL (1,3 GB).
  - **Disco:** 96 GB, em 27% depois da limpeza do cache do Docker.
  - **Arquivos no banco:** documentos enviados ao CRM e mídias do WhatsApp ficam no MySQL (colunas `data`). Os backups vão para o MEGA.
- **Disco:**
  - **Faxina semanal** do cache de build do Docker (Orbit) no crontab do root: domingo às 4h, `docker builder prune -f --filter until=168h`.
  - **Alarme** `manutencao:disco` no CRM: todo dia às 8h05, avisa a partir de 85%.
  - **Histórico:** em 16/10 o cache tinha chegado a 55 GB. Ver o runbook, "disco do servidor cheio".

- **Acervo de leis** (desde 21/10/2026): `/home/crmapp/leis/acervo` (cópia parcial do GitHub ctresb/leis, cerca de 120 MB do git e 400 MB de texto) e `/home/crmapp/leis/acervo.db` (índice SQLite, cerca de 0,7 GB). Fica fora do MySQL e fora do backup: refaz-se do GitHub. A atualização (domingo, 5h15) roda num processo Node separado do `crm-juridico`. Precisa de `git` na VPS e de Node 22.13 ou mais novo (`node:sqlite`). Ver [Pesquisa de Leis](18-pesquisa-de-leis.md).

## Portão de qualidade (CI), desde 16/10/2026

Nada vai para a VPS sem passar pelo workflow **Testes** (`.github/workflows/ci.yml`). Ele roda num servidor descartável do GitHub, com um MySQL vazio só para o teste, nesta ordem:

| Etapa | O que garante | Trava o deploy? |
|---|---|---|
| Tipos (`npm run typecheck`) | O TypeScript compila sem erro | sim |
| Lint (`npm run lint`, ESLint) | Sem erro de verdade: função duplicada, código inalcançável, chave repetida… O estilo só gera aviso | sim |
| Banco do zero (`npm run migrate`) | **Todas** as migrations rodam num banco vazio, ou seja, o banco pode ser recriado num desastre | sim |
| Dados fictícios (`scripts/ci-semear.mjs`) | Um cliente e um caso fictícios para os testes de integração. O script se recusa a rodar fora de um banco `_ci` | — |
| Mapa da API em dia | `docs/api/rotas.md` bate com o código (`npm run docs:api`) | sim |
| Testes (`npm test`) | Unitários **e de integração com banco** (969 em 16/10, nenhum pulado) | sim |
| Vulnerabilidades (`npm audit --audit-level=high`) | Nenhuma biblioteca de produção com falha alta ou crítica | sim |

**Bibliotecas (20/10/2026):** produção com **0 vulnerabilidades**. As 5 moderadas da `uuid` (dentro do `googleapis` e do `node-cron`) foram resolvidas forçando a `uuid` 11.1.1 em `overrides` no `package.json`; ela mantém o formato antigo (`require`) que essas bibliotecas usam. As altas que o `npm audit` mostra sem `--omit=dev` vêm do `nodemon` (só desenvolvimento, não vai para a VPS) e não têm correção publicada.
| Ponta a ponta (`npm run test:e2e`, Playwright) | Um navegador de verdade entra no CRM, abre as 9 telas principais exigindo que carreguem de fato, e cadastra um cliente | sim |

- **Em branch** que não seja a `main`, o workflow roda sozinho e não publica nada, para testar antes.
- **Na `main`**, o `deploy.yml` chama o workflow e só publica se ele passar (`needs: testes`).
- **Se falhar:** a aba Actions do GitHub mostra a etapa. O relatório do teste de ponta a ponta, com prints da tela, fica para baixar por 7 dias.

## Deploy — como uma mudança chega em produção

1. O código é enviado (`git push`) para a `main` no GitHub. Primeiro passa pelo portão de qualidade acima.
2. O GitHub Actions (`.github/workflows/deploy.yml`) entra na VPS por SSH e faz, em ordem: puxa o código, `npm install`, compila, roda as migrations e reinicia o PM2 `crm-juridico`.
   - **Espera o backup:** se houver backup em andamento, espera até 20 minutos antes de reiniciar. Por isso um deploy às vezes demora: em 16/10, um deploy levou cerca de 15 minutos, provavelmente por coincidir com o backup.
   - **Conexão:** se a primeira conexão SSH falhar, tenta mais duas vezes.
   - **Para acompanhar:** `gh run watch`.
3. Ao reiniciar, o sistema aplica sozinho qualquer migration de banco pendente ("Banco em dia (N migrations aplicadas)" no log).

## Backup

Regra da usuária (07/10/2026): **o backup não pode falhar nenhum dia** — são dados sensíveis que não podem ser perdidos.

**Quando:** 3 vezes por dia, às 02h, 09h e 19h (Brasília), em dois lugares: no disco da VPS (`~/backups-crm`) e no MEGA. O arquivo é comprimido e **criptografado** (sem a `ENCRYPTION_KEY` ninguém abre), com data e hora no nome.

**Proteções de cada cópia** (`src/services/backupService.ts`):
- cada etapa tem **tempo limite** (25 min para gerar a cópia, 25 min para enviar ao MEGA). Antes não tinha, e em 16/09 e 05/10/2026 o backup travou sem arquivo e sem erro;
- o arquivo é **conferido antes de ser salvo**: abre (decifra), descomprime de ponta a ponta e precisa ter as tabelas principais (clientes, casos, processos, financeiro, documentos) e mais de 50 tabelas. Cópia com defeito não é salva nem empurra cópias boas para fora do histórico;
- depois de salvar, confere o **tamanho** do arquivo no MEGA e no disco;
- cópia antiga só é apagada **depois** que a nova está salva e conferida.

**Se falhar** (`src/services/backupRotina.ts`):
- falhou ou travou → **tenta de novo sozinho** 3 min depois;
- **vigia** às 02h45, 09h45 e 19h45: se a cópia daquele horário não existe, **refaz na hora** e avisa (sino + WhatsApp);
- só um destino funcionou (MEGA ou disco) → alerta crítico;
- o deploy **não reinicia o sistema no meio de um backup**: enquanto existe `~/backups-crm/.backup-em-andamento`, ele espera até 20 min (`.github/workflows/deploy.yml`).

**Aviso diário:** todo dia às **20h30** chega o aviso "Backup do CRM" no WhatsApp (mesmo número do fechamento do dia, `destinoWhatsappPessoal`) e no sino. Diz quantas cópias do dia ficaram completas (3 de 3), o tamanho, quantas cópias há na nuvem, o espaço do MEGA e a última prova de restauração. Começa com ✅ se tudo deu certo; com ⚠️ e a lista do problema se algo falhou.

**Histórico guardado** (`src/services/backupRegras.ts`, regra avô-pai-filho):
- **MEGA:** todas as cópias dos últimos 3 dias + 1 por dia até 30 dias + 1 por mês até 12 meses (~48 arquivos);
- **VPS:** todas dos últimos 3 dias + 1 por dia até 14 dias.

**Prova de restauração:** todo **domingo às 03h30** (era mensal até 07/10/2026) o sistema restaura a cópia mais recente num banco de teste e confere que os dados voltam. Falhou → alerta crítico. Desde 12/10/2026 a restauração lê o dump em fluxo, comando por comando (`restoreFluxo.ts`), sem limite de tamanho total. O limite que resta é de cerca de 32 MB por arquivo dentro do banco (`max_allowed_packet` de 64 MB, e o binário dobra de tamanho em hex).

**Tamanho:** 321 MB por cópia em 12/10/2026 (656 MB de SQL descomprimido), dos quais ~80% são mídias do WhatsApp guardadas dentro do banco (`whatsapp_media`, 252 MB, crescendo ~130 MB/mês). No MEGA (conta de 20 GB), 5,3 GB em 21 cópias em 12/10. Com a retenção completa (~48 cópias) e esse crescimento, **a conta lota entre o fim de novembro e dezembro de 2026**; o aviso diário acusa a partir de 85%. Ver a análise em [Decisões](17-decision-log.md).

## Histórico: Railway

Até 21/08/2026, o sistema rodava no Railway. A migração pra VPS aconteceu depois disso, mas o projeto no Railway **continuou rodando em paralelo, sem receber atualizações**, com seu próprio banco de dados separado — o que chegou a causar duplicidade real (o mesmo aviso automático de fechamento do dia foi enviado duas vezes, uma por cada servidor, no mesmo dia). O Railway foi desligado em 03/09/2026 depois dessa descoberta. Se algo antigo ainda mencionar Railway, está desatualizado — a VPS é o único ambiente de produção.

## Segurança e LGPD

Alguns dados sensíveis (tokens de integração) ficam cifrados no banco. Acessos à ficha completa de um cliente são registrados para auditoria (ver [Clientes e cadastro](01-clientes.md)).

## FAQ

**Se o servidor cair, o que acontece?** O PM2 tem política de reinício automático em caso de falha do processo (não confundir com deploy de código novo, que ainda é manual). Não há um servidor de standby/failover documentado — é um servidor único.

**Onde ficam as chaves de API (Groq, Gemini, Uazapi, Asaas etc.)?** Em variáveis de ambiente na VPS, fora do código-fonte e fora do repositório Git.

**Dá pra restaurar de um backup específico?** Sim — os arquivos ficam no MEGA (até 12 meses, 1 por mês nos mais antigos) e no disco da VPS (14 dias), com data no nome.

**Como sei que o backup de hoje foi feito?** Pelo aviso diário das 20h30 (WhatsApp + sino) e pelo painel de saúde da tela "Hoje".

## Links relacionados
- [Monitoramento automático](10-monitoramento.md) — rotinas que rodam nesse servidor
- [Usuários e acesso](12-usuarios.md) — segurança de login

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 26/10/2026 | Claude | O portão de vulnerabilidades barrou o deploy com 3 avisos novos: body-parser (alto) e nodemailer (moderado), resolvidos com `npm audit fix`; zod 3 → 4.6.7 (alto; sem correção na 3). O zod só valida o `.env` (`src/config/env.ts`), que funciona igual na 4 |
| 21/10/2026 | Claude | Acervo de leis na VPS (`/home/crmapp/leis`), fora do MySQL e do backup |
| 20/10/2026 | Claude | `uuid` 11.1.1 forçada em `overrides`: produção sem vulnerabilidades |
| 03/09/2026 | Claude | Criação do documento; registrado o desligamento do Railway e a migração definitiva pra VPS |
| 07/10/2026 | Claude | Backup reforçado: tempo limite, conferência do arquivo, nova tentativa automática, vigia de horário perdido, aviso diário 20h30, histórico 30 dias + 12 meses, prova de restauração semanal, deploy espera o backup |
| 12/10/2026 | Claude | Prova de restauração em fluxo (o dump passou de 512 MB e a prova falhava); tamanho atual e previsão de lotação do MEGA |
| 16/10/2026 | Claude | Portão de qualidade (CI) antes do deploy: tipos, lint, banco do zero, testes com banco, vulnerabilidades e ponta a ponta |
| 16/10/2026 | Claude | Laya no servidor; capacidade medida; faxina semanal do cache do Docker e alarme de disco; deploy descrito como é hoje (GitHub Actions automático) |

---
◀ [Usuários e acesso](12-usuarios.md) · [Visão geral](00-visao-geral.md)

**Fim da documentação — 13 de 13 blocos completos.**
