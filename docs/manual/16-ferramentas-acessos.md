# 16 · Ferramentas e acessos

**Área:** Sistema · **Autor:** Claude (levantado do código-fonte e das variáveis de ambiente reais) · **Última atualização:** 04/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que uma integração nova entrar ou uma existente sair

## TL;DR

Lista única de tudo que o CRM depende por fora dele mesmo — pra que serve cada coisa, e o que quebra se ela cair. Consolidado a partir do que já estava espalhado pelos 13 blocos de módulo.

## Contexto

Consulte antes de mexer em qualquer integração externa, pra saber o que depende dela — ou quando precisar lembrar "onde é que configuro X".

## Integrações externas

| Ferramenta | Pra que serve | O que quebra se cair |
|---|---|---|
| **Uazapi** | WhatsApp real do escritório | Toda a central de atendimento e todos os avisos automáticos (ver [WhatsApp](03-whatsapp.md)) |
| **MEGA** | Armazenamento de documentos e backup do banco | Upload/visualização de documento; backup diário (continua rodando local, só não sobe a cópia externa) |
| **DJEN (Comunica CNJ)** | Descoberta de processo por OAB, movimentações, prazos | Descoberta automática de processo, nomeação dativa, alertas de marco processual |
| **DataJud (CNJ)** | Consulta de processo já cadastrado manualmente | Sincronização de processos cadastrados manualmente |
| **APIs públicas de tribunal** (TJES, TRT17, TRF2, TJPR, TRT9, TRF4, STJ, TST) | Alternativa ao DataJud pra tribunais específicos | Sincronização dos processos daquele tribunal |
| **Google (OAuth/Calendar/Gmail)** | Agenda sincronizada; leitura de e-mail de monitoramento judicial | Sincronização de agenda; descoberta de movimentação por e-mail |
| **Asaas** | Cobrança Pix/cartão, baixa automática de parcela | Emissão de cobrança nova; baixa automática (baixa manual continua funcionando) |
| **Groq** | IA rápida — resumo de movimentação, qualificação de lead | Resumos automáticos de movimentação no briefing; qualificação automática de lead |
| **Gemini** | IA de visão — leitura de documento/imagem | Classificação automática de documento por foto (Dativo) |
| **OpenAI** | IA usada em extrações específicas (ex.: parte/CPF em e-mail de tribunal) | Scripts de extração que dependem especificamente dela |
| **DataJud API Key** | Autenticação da consulta pública do CNJ | — (chave própria, ver variável `DATAJUD_API_KEY`) |
| **Resend / SMTP (Gmail)** | Envio de e-mail (briefing, notificações) | Todo e-mail automático do sistema |
| **GitHub** | Código-fonte + deploy automático (GitHub Actions) | Nenhum push novo chega em produção sem isso |
| **Hostinger VPS** | Onde o sistema roda de fato | Sistema inteiro fora do ar (ver [Onde tudo roda](13-infraestrutura.md)) |
| **VAPID (push)** | Notificação push do navegador | Notificação push no navegador (o resto do sistema continua normal) |

## Onde as chaves ficam

Nunca no código-fonte nem no Git — só em variáveis de ambiente na VPS (`.env`, fora do repositório). Um subconjunto (`OPENAI_API_KEY`, `MEGA_EMAIL`, `MEGA_PASSWORD`) é reinjetado a cada deploy automático a partir dos "Secrets" configurados no GitHub Actions — ver `.github/workflows/deploy.yml`.

## Descontinuado

**Railway** — hospedou o sistema até 21/08/2026. Migrado pra VPS Hostinger; a instância antiga foi mantida rodando por engano até 03/09/2026 (ver [Runbook](14-runbook.md), incidente de mensagem duplicada), quando foi desligada de vez. Não usar mais como referência pra nada.

## FAQ

**Se eu quiser trocar de provedor de IA (ex.: Groq por outro), preciso mexer em quê?** Depende de qual fluxo — cada um chama a IA de forma independente (não existe uma "chave mestra de IA" única). Consulte o módulo específico antes de trocar.

**Onde vejo se uma integração está com problema?** Painel de Saúde do WhatsApp (pra Uazapi); logs do servidor pra o resto — não há um painel único de status de todas as integrações hoje.

## Links relacionados
- [Onde tudo roda](13-infraestrutura.md)
- [Runbook](14-runbook.md)
- [WhatsApp](03-whatsapp.md)

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 04/09/2026 | Claude | Criação do documento |

---
◀ [Onboarding](15-onboarding.md) · [Visão geral](00-visao-geral.md) · Próximo: [Decision Log](17-decision-log.md) ▶
