# 03 · WhatsApp

**Área:** Atendimento e captação · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

O número real do escritório (via Uazapi) integrado direto no CRM, em duas visões (lista de 3 painéis ou Kanban), com painel de saúde da conexão e um monte de avisos automáticos de outros módulos passando por aqui.

## Contexto

Consulte pra entender a estrutura das telas de conversa, o que o painel de saúde mostra, ou de onde vem uma mensagem automática específica (pro escritório ou pro cliente/lead).

## Duas visões da mesma conversa

- **Lista (3 painéis)** — visão padrão. Painel 1: lista de conversas com abas (Todas / Não lidas / Em atendimento / Finalizadas), busca por nome/telefone/assunto, filtro por responsável e por etiqueta. Painel 2: a conversa aberta (histórico, anexos, áudio, respostas prontas). Painel 3: ficha do contato — identificação, processo vinculado, financeiro, etiquetas editáveis, notas internas da equipe, botões de "Abrir cadastro"/"Criar tarefa"/"Vincular processo".
- **Quadro (Kanban)** — mesmas conversas organizadas em colunas por etapa de atendimento (etapas configuráveis), pra quem prefere visão de funil em vez de lista.

Um botão no topo alterna entre as duas visões sem perder a conversa aberta.

## Abrir em tela cheia

O ícone de WhatsApp na barra superior sempre abre a central em **aba nova, em tela cheia**, sem tirar você da tela onde você estava.

## Foco na conversa / minimizar

A barra de busca/filtros pode ser minimizada, e existe um modo "foco na conversa" que esconde a lista lateral pra sobrar mais espaço só pro histórico de mensagens — as duas preferências ficam salvas e não voltam a mudar sozinhas a cada clique.

## Notas internas e etiquetas

Notas internas (visíveis só pra equipe, nunca pro cliente) e etiquetas de conversa (setor, prioridade, o que for) ficam editáveis direto no painel 3, sem precisar abrir um menu separado.

## Painel de Saúde do WhatsApp

Dentro do menu de auditoria da tela: status da conexão em tempo real, hora da última mensagem recebida, contagem de falhas de envio/mídia nos últimos 7 e 30 dias, e a lista das notificações de falha mais recentes. É um painel de diagnóstico — os números de falha são "pelo menos N" (o sistema evita alertar demais pra mesma falha), não uma contagem perfeita.

## Avisos automáticos que chegam por aqui

Vários módulos usam o mesmo canal de WhatsApp pra avisar o escritório: nomeação dativa detectada, sentença/acórdão publicado, movimentação encontrada por e-mail fora do DJEN, falha de conexão/envio. Ver [Monitoramento automático](10-monitoramento.md) para o detalhe de cada um.

## Auto-envios para o cliente/lead

Alguns eventos disparam mensagem automática pro **contato** (não pro escritório): confirmação/recusa de newsletter, aceite de proposta, follow-up de proposta (5 dias e 48h antes de expirar), despedida ao perder um lead (ver [Leads](02-leads.md)).

## FAQ

**Preciso ter o WhatsApp aberto no celular pra funcionar?** Não — a conexão é com o número real via Uazapi, roda no servidor. O painel de Saúde mostra se essa conexão está ativa.

**Dá pra saber se uma mensagem falhou ao enviar?** Sim, pelo painel de Saúde — mas os contadores de falha são "pelo menos N" (throttle contra alerta repetido), não uma contagem perfeita.

**As etapas do Kanban de WhatsApp são as mesmas do funil de Leads?** Não — são etapas de atendimento configuráveis, independentes das etapas do funil comercial.

## Links relacionados
- [Leads e comercial](02-leads.md) — origem de vários auto-envios
- [Monitoramento automático](10-monitoramento.md) — avisos que chegam por aqui
- [Processos e prazos](04-processos.md) — avisos de marco processual

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 03/09/2026 | Claude | Criação do documento |

---
◀ [Leads](02-leads.md) · [Visão geral](00-visao-geral.md) · Próximo: [Processos e prazos](04-processos.md) ▶
