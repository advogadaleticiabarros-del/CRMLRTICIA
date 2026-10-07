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

## Deploy — como uma mudança chega em produção

1. Código é enviado (`git push`) pro repositório no GitHub.
2. A VPS puxa o código sozinha (mecanismo de auto-pull ainda não totalmente mapeado — não é cron nem systemd tradicional, possivelmente integração própria do painel da Hostinger).
3. **Passo que ainda não é automático**: o processo (`pm2 restart crm-juridico`) precisa ser reiniciado manualmente pra rodar o código novo — o `git pull` sozinho não recarrega a aplicação. Até isso acontecer, o site continua servindo a versão anterior.
4. Ao reiniciar, o sistema aplica sozinho qualquer migration de banco pendente ("Banco em dia (N migrations aplicadas)" no log).

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

**Prova de restauração:** todo **domingo às 03h30** (era mensal até 07/10/2026) o sistema restaura a cópia mais recente num banco de teste e confere que os dados voltam. Falhou → alerta crítico.

**Tamanho:** ~280 MB por cópia em 07/10/2026, dos quais ~80% são mídias do WhatsApp guardadas dentro do banco (`whatsapp_media`, 206 MB). Ver a análise em [Decisões](17-decision-log.md).

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
| 03/09/2026 | Claude | Criação do documento; registrado o desligamento do Railway e a migração definitiva pra VPS |
| 07/10/2026 | Claude | Backup reforçado: tempo limite, conferência do arquivo, nova tentativa automática, vigia de horário perdido, aviso diário 20h30, histórico 30 dias + 12 meses, prova de restauração semanal, deploy espera o backup |

---
◀ [Usuários e acesso](12-usuarios.md) · [Visão geral](00-visao-geral.md)

**Fim da documentação — 13 de 13 blocos completos.**
