# 11 · Briefing diário

**Área:** Automação · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

Resumo automático do dia, enviado por e-mail e WhatsApp, todo dia, sem precisar pedir — agenda, financeiro, comercial, movimentações de processo e prazos, tudo classificado por urgência (🔴 crítico, 🟠 atenção, 🟢 neutro) pra ler em segundos o que realmente precisa de atenção hoje.

## Contexto

Consulte pra entender o que cada seção do briefing significa, os horários de envio, ou por que algo apareceu (ou não) como crítico.

## Horários de envio

| Envio | Quando |
|---|---|
| Briefing matinal (e-mail) | 7h |
| Briefing matinal (WhatsApp) | 8h |
| Jornal jurídico (notícias da área) | 7h |
| Fechamento do dia | 18h30 |

## O que entra no briefing matinal

- **Agenda do dia e dos próximos 3 dias** — reuniões, audiências, compromissos.
- **Financeiro** — a receber vencendo hoje, valores em atraso.
- **Comercial** — leads novos, aniversariantes do dia.
- **Esteira e documentos** — peças paradas há X dias, documentos pendentes.
- **Movimentações processuais do dia** — já resumidas pela IA (ver [Processos e prazos](04-processos.md)).
- **Prazos por faixa** — hoje, amanhã, 3 dias, semana.

## Classificação por urgência

Cada item do briefing recebe uma severidade — **crítica** (🔴, precisa de ação hoje/já), **atenção** (🟠, precisa de olhar em breve) ou **neutra** (🟢, informativo). A versão de WhatsApp usa essa classificação pra decidir o que vira mensagem: só os itens críticos entram na seção principal, o resto fica em "prioridade"/"acompanhar".

## Fechamento do dia

Ao final do dia (18h30), um snapshot das tarefas do dia é salvo — usado como comparação no briefing seguinte (o que ficou pendente de ontem).

## Copiloto no sino

Uma versão curta e só com o que exige ação (leads frios, valores vencidos, casos estourando prazo) fica disponível também como notificação dentro do sistema, não só por e-mail/WhatsApp.

## FAQ

**Por que recebo o briefing por e-mail E por WhatsApp?** São dois formatos independentes do mesmo conteúdo — e-mail é mais completo/visual, WhatsApp é o resumo rápido. Não há como desligar um sem o outro pelo momento.

**Um item que não é urgente ainda aparece no briefing?** Sim — a maioria das seções mostra tudo, a classificação de urgência só decide destaque/cor, não some do relatório.

**O jornal jurídico é sobre meus processos ou notícias gerais da área?** Notícias gerais da área jurídica, separado do resumo dos seus próprios processos.

## Links relacionados
- [Monitoramento automático](10-monitoramento.md) — fonte dos dados do briefing
- [Processos e prazos](04-processos.md) — movimentações resumidas por IA
- [Cobrança e parcelas](08-cobranca.md) — origem do bloco financeiro

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 03/09/2026 | Claude | Criação do documento |

---
◀ [Monitoramento automático](10-monitoramento.md) · [Visão geral](00-visao-geral.md) · Próximo: [Usuários e acesso](12-usuarios.md) ▶
