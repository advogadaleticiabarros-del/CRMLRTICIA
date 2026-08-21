# Redesign da tela de Conversas do WhatsApp

**Data:** 2026-08-21
**Status:** aprovado para implementação (design visual validado com a usuária via mockup)

## Contexto

A tela de Conversas (`public/whatsapp.js`, `ROUTES.whatsapp.tabConversas`) já tem bastante
funcionalidade (etiquetas, busca, fixar/arquivar, respostas citadas, transcrição de áudio,
geração de PDF, conversão em tarefa/prazo/compromisso/anotação, resumo por IA, ficha de
contexto do cliente). Uma primeira passada de polimento (transições de hover, animação de
entrada de mensagem, feedback de clique) já foi feita e aprovada, mas a usuária pediu pra ir
mais fundo — apontou 3 problemas: visual genérico/datado, difícil achar coisas, falta
informação importante à vista sem clicar.

## Objetivo

Redesenhar o cabeçalho e a lista de conversas (coluna esquerda da tela) pra:
1. Reforçar a identidade visual do escritório (navy + dourado, já usada em todo o resto do
   CRM e no material de Instagram/blog — não inventar paleta nova).
2. Sinalizar urgência de cada conversa de forma visual e imediata, usando a MESMA linguagem
   já validada no Briefing Jurídico Matinal (🔴 crítico / 🟠 atenção / ⚪ sem pendência) —
   consistência de vocabulário visual entre as duas telas.
3. Trazer, direto na lista (sem precisar abrir a "Ficha do contato"), um resumo de UMA
   pendência crítica real do cliente daquela conversa (audiência próxima ou pagamento
   vencendo) — só quando existir, sem inventar dado novo.

## Design aprovado (mockup validado)

- **Cabeçalho**: fundo navy (`#1f3047`), friso inferior dourado (`#c19a4e`, 3px), título
  "Conversas" em Georgia serif, contador de não lidas discreto à direita.
- **Item da lista**: borda esquerda de 4px colorida por urgência:
  - vermelho (`#b3432f`) — crítico (audiência ≤ 2 dias, ou pagamento vencendo hoje/atrasado)
  - âmbar (`#a67626`) — atenção (audiência ≤ 7 dias, ou pagamento vencendo em até 3 dias)
  - cinza neutro (`#e2ddd1`) — sem pendência identificada
- Mais espaçamento vertical entre itens que o layout atual (respiro, não empilhado).
- Avatar mantém o esquema de cores por iniciais já existente (`WA_CORES`/`waCor`).
- Abaixo do nome/prévia da mensagem, quando existir pendência crítica ou de atenção: uma
  etiqueta pequena (pill) com ícone + texto curto — ex. "⚖️ Audiência em 2 dias",
  "💰 Parcela vence em 3 dias". Item cinza (sem pendência) não mostra etiqueta nenhuma.
- Resto da lista (busca, filtros por etiqueta, arquivadas, badge de não lidas, hora/dia)
  continua exatamente como está — não é uma reescrita funcional, é redesenho visual +
  1 informação nova.

## O que muda tecnicamente

### Backend — `GET /api/whatsapp-instance/chats`

Hoje devolve `phone, client_name/push_name, client_id, labels, last_body, last_time,
last_from_me, unread, pinned, archived`. Precisa passar a incluir, por conversa vinculada a
um cliente:
- `proxima_audiencia_dias` (int | null) — dias até a próxima audiência/reunião do cliente
  (mesma fonte que já alimenta `getPulsoNegocio`/o contexto da conversa — `calendar_events`
  join `clients`), null se não houver nenhuma nos próximos 7 dias.
- `parcela_vencendo_dias` (int | null) — dias até (ou desde, se negativo = atrasada) a
  próxima parcela pendente do cliente (mesma fonte de `installments`/`parcelas` já usada em
  `whatsappQueue.ts`/`getPulsoNegocio`), null se não houver nenhuma nos próximos 7 dias.

**Cuidado de performance:** a lista de conversas pode ter dezenas/centenas de linhas — isso
NÃO pode virar uma query por chat (N+1). Implementar como 2 subqueries agregadas (uma pra
audiência, uma pra parcela) por `client_id`, feitas uma vez só e casadas em memória com a
lista de chats — ou 2 LEFT JOINs com subquery correlacionada bem indexada. Medir antes de
finalizar: com a base atual (108 clientes), não pode adicionar mais que ~50ms perceptíveis à
rota que já existe.

### Frontend — `public/whatsapp.js`, dentro de `tabConversas`

- Função nova `severidadeConversa(chat)` → `'critica' | 'atencao' | 'neutra'`, regra fixa
  (mesmos limiares do Briefing: audiência ≤2d ou pagamento vencido/hoje = crítica; ≤7d ou
  ≤3d = atenção; senão neutra) — lógica pura, testável isolada do DOM.
- `renderLista()` usa essa função pra decidir a cor da borda e se mostra a etiqueta.
- Cabeçalho da coluna de conversas reestilizado (navy + friso dourado), CSS em
  `public/styles.css` (`.wa-side`/novo seletor pro cabeçalho).
- Sem mudança de estrutura HTML fora do necessário pra isso — filtros, busca, lista
  continuam nos mesmos containers (`#waf`, `#wal`).

## Fora de escopo (não mexer agora)

- Painel de mensagens (coluna do meio) e ficha de contexto (coluna da direita) — só a
  coluna esquerda (cabeçalho + lista) está no escopo deste redesign.
- Qualquer funcionalidade nova (a lista já tem etiqueta, busca, fixar, arquivar — não é pra
  adicionar mais ações agora, só reorganizar visualmente + a etiqueta de pendência).

## Testes

- `severidadeConversa()` — testável como função pura (padrão já usado em
  `briefingSeverity.ts`), casos: audiência hoje/amanhã → crítica; audiência em 5 dias →
  atenção; nada → neutra; parcela atrasada → crítica mesmo sem audiência.
- Auditoria de schema (reaproveitar `tests/helpers/schemaAudit.mjs`) nas novas subqueries de
  `GET /chats`, mesmo padrão já usado no Briefing — não pode reintroduzir coluna inexistente.
