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
- **Tipo e grau da movimentação** (desde 30/09/2026) — o resumo vem prefixado, ex.: "[Sentença · 1º grau]".
- **Também precisa de você** (desde 30/09/2026) — bloco no e-mail e no WhatsApp, só aparece o que tiver conteúdo:
  - 💬 WhatsApp aguardando sua resposta (última mensagem do contato há 2h+, últimos 7 dias, sem arquivadas/bloqueadas) — com horas de espera;
  - 📥 Leads sem resposta há 24h+ (últimos 30 dias);
  - 💸 Parcelas atrasadas (installments + parcelas de receitas) com total;
  - 🤝 Repasses ao cliente de acordos pendentes (vencidos ou nos próximos 3 dias);
  - 📎 Documentos recebidos no WhatsApp nas últimas 24h;
  - 🔎 Publicações sem análise da IA (24h) — ler manualmente;
  - ⚠️ Consultas ao tribunal que falharam (24h) e não voltaram a funcionar;
  - 🩺 Saúde do CRM — rotinas com erro sem sucesso posterior e backup sem confirmação nas últimas 26h.
  Conversa esperando 24h+ e backup não confirmado entram na contagem de urgentes do assunto do e-mail. Consultas em `src/services/briefingExtras.ts`, texto em `briefingExtrasRender.ts` (testado).

## Classificação por urgência

Cada item do briefing recebe uma severidade — **crítica** (🔴, precisa de ação hoje/já), **atenção** (🟠, precisa de olhar em breve) ou **neutra** (🟢, informativo). A versão de WhatsApp usa essa classificação pra decidir o que vira mensagem: só os itens críticos entram na seção principal, o resto fica em "prioridade"/"acompanhar".

## Fechamento do dia

Às 18h30 sai o fechamento do dia, em duas versões:

- **E-mail completo** para quem recebe o briefing: concluído hoje, ficou pendente, aguardando terceiro, prioridade de amanhã e uma frase de encerramento.
- **WhatsApp executivo** (desde 30/09/2026) **só para o número da Jessica (27 98879-8093)** — não vai para os números do briefing (pedido de 01/10/2026; trocável em `office_settings.whatsapp_pessoal_destino`): contagem, pendências (até 8), aguardando terceiro, top 5 de amanhã e a frase.

**Comparação manhã × noite:** o retrato salvo pelo briefing matinal (`briefing_snapshots`) agora é usado de verdade — uma tarefa que estava planejada de manhã e foi reagendada durante o dia continua aparecendo como pendente (antes sumia do fechamento).

**Prioridade de amanhã:** até 5 itens — prazos pendentes de amanhã primeiro, depois audiências/reuniões, depois tarefas por prioridade.

**Aguardando terceiro:** tarefa marcada em *Prazos & Tarefas → Aguardando terceiro* (com quem: cliente, perito, cartório...) sai de "pendente" e ganha bloco próprio.

**Frase de encerramento:** 100 frases em 7 categorias (descanso, audiência, dia cheio, pendências, academia, hidratação, leitura). A categoria vem do dia: teve audiência → audiência; compromisso com "academia"/"treino" amanhã → academia; 5+ concluídas → dia cheio; 5+ pendentes → pendências; senão, sorteio entre descanso/hidratação/leitura. Sorteio de verdade, evitando as últimas 40 usadas (guardadas em `office_settings.fechamento_frases_recentes`).

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
| 01/10/2026 | Claude | Fechamento do dia por WhatsApp vai só para o número da Jessica |
| 30/09/2026 | Claude | Briefing: bloco "Também precisa de você" (WhatsApp aguardando, leads 24h, parcelas atrasadas, repasses, docs recebidos, publicações não analisadas, falhas de consulta, saúde do CRM) e tipo/grau da movimentação |
| 30/09/2026 | Claude | Fechamento do dia v2: versão WhatsApp, prioridade de amanhã, bloco "aguardando terceiro", 100 frases por contexto e uso real do retrato da manhã |

---
◀ [Monitoramento automático](10-monitoramento.md) · [Visão geral](00-visao-geral.md) · Próximo: [Usuários e acesso](12-usuarios.md) ▶
