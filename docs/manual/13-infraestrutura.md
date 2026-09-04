# 13 · Onde tudo roda (infraestrutura)

**Área:** Sistema · **Autor:** Claude (levantado do código-fonte e do servidor real) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado

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

Três backups automáticos por dia (madrugada, manhã, noite), criptografados, salvos em dois lugares: localmente na VPS e no MEGA. Cada arquivo tem o carimbo de data/hora no nome.

## Histórico: Railway

Até 21/08/2026, o sistema rodava no Railway. A migração pra VPS aconteceu depois disso, mas o projeto no Railway **continuou rodando em paralelo, sem receber atualizações**, com seu próprio banco de dados separado — o que chegou a causar duplicidade real (o mesmo aviso automático de fechamento do dia foi enviado duas vezes, uma por cada servidor, no mesmo dia). O Railway foi desligado em 03/09/2026 depois dessa descoberta. Se algo antigo ainda mencionar Railway, está desatualizado — a VPS é o único ambiente de produção.

## Segurança e LGPD

Alguns dados sensíveis (tokens de integração) ficam cifrados no banco. Acessos à ficha completa de um cliente são registrados para auditoria (ver [Clientes e cadastro](01-clientes.md)).

## FAQ

**Se o servidor cair, o que acontece?** O PM2 tem política de reinício automático em caso de falha do processo (não confundir com deploy de código novo, que ainda é manual). Não há um servidor de standby/failover documentado — é um servidor único.

**Onde ficam as chaves de API (Groq, Gemini, Uazapi, Asaas etc.)?** Em variáveis de ambiente na VPS, fora do código-fonte e fora do repositório Git.

**Dá pra restaurar de um backup específico?** Sim — os arquivos de backup diário ficam guardados tanto local quanto no MEGA, com data no nome, prontos pra restauração se necessário.

## Links relacionados
- [Monitoramento automático](10-monitoramento.md) — rotinas que rodam nesse servidor
- [Usuários e acesso](12-usuarios.md) — segurança de login

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 03/09/2026 | Claude | Criação do documento; registrado o desligamento do Railway e a migração definitiva pra VPS |

---
◀ [Usuários e acesso](12-usuarios.md) · [Visão geral](00-visao-geral.md)

**Fim da documentação — 13 de 13 blocos completos.**
