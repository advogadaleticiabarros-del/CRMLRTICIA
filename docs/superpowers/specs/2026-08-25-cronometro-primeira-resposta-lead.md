# Cronômetro de tempo de primeira resposta — Design

**Status:** decidido pela usuária como "faça tudo que for recomendado, não me pergunte, resolva" — decisões abaixo tomadas sem ciclo de perguntas.

## Contexto

Roadmap "Comercial & intake" (55% parcial), item faltante: "Cronômetro de tempo de primeira resposta". Primeiro de 4 sub-projetos a implementar em sequência nesta sessão.

**Investigação do código real**: a tabela `leads` só tem `created_at`/`updated_at` — nenhum timestamp de resposta. O único precedente de "cronômetro" no sistema é `analise_since` (migration 009): um campo `DATETIME NULL`, setado em `PATCH /api/leads/:id/status` quando o lead entra em `proposta_em_analise`, usado pela "regra dos 7 dias". Vou seguir exatamente esse padrão.

Não existe hoje nenhum evento único e confiável de "alguém respondeu o lead" — nem a mudança de status, nem o botão de WhatsApp, sozinhos, cobrem o caso real de uso.

## Decisão 1 — Evento que marca "primeira resposta": o que acontecer primeiro, entre 2 sinais

1. **Sair de `triagem` pela primeira vez** (`PATCH /api/leads/:id/status`) — já instrumentado, cobre o fluxo mais comum (mover o card no Kanban depois de olhar/responder o lead).
2. **Clicar em "Chamar no WhatsApp"** no card do lead (`public/app.js`, `leadDetail`, handler `waCrmBtn.onclick`) — sinal mais fiel semanticamente (é literalmente iniciar contato), mas hoje não persiste nada.

**Por que os dois, não só um**: só "mudança de status" perderia o caso em que a advogada manda WhatsApp mas só move o card depois (o relógio pararia tarde demais, mentindo pra pior). Só "clique no WhatsApp" perderia leads respondidos por outro canal (ligação, e-mail) que nunca passam por esse botão — o relógio nunca pararia. União dos dois: o primeiro que acontecer marca a resposta; qualquer que seja o canal real usado, um dos dois sinais captura.

**Não conta como resposta**: `PUT /api/leads/:id` (edição genérica, ex.: corrigir área jurídica) e `POST /:id/contexto` (nota manual) — nenhum dos dois implica contato com o lead necessariamente.

## Decisão 2 — Persistência: novo campo `leads.first_response_at`, mesmo padrão de `analise_since`

```sql
ALTER TABLE leads ADD COLUMN first_response_at DATETIME NULL;
```

- Setado por `NOW()` na **primeira** vez que um dos dois sinais ocorre — nunca sobrescrito depois (diferente de `analise_since`, que é limpo/resetado a cada troca de estágio; aqui o cronômetro, uma vez parado, fica parado).
- `NULL` = ainda aguardando primeira resposta (o cronômetro está rodando).
- Sem sobrescrita: se o lead já tem `first_response_at` preenchido, nenhuma das duas rotas o altera de novo (evita que uma segunda mudança de status ou um segundo clique no WhatsApp "reinicie" o relógio).

## Decisão 3 — Onde instrumentar

**Backend, `src/routes/leads.ts`, `PATCH /:id/status`:**
```typescript
const primeiraRespostaSql = (prev.status === 'triagem' && status !== 'triagem')
  ? ', first_response_at = COALESCE(first_response_at, NOW())'
  : '';
```
Adicionado ao mesmo `UPDATE` que já seta `analise_since` — sem query extra. `COALESCE` garante idempotência mesmo que a condição de "sair de triagem" seja atingida mais de uma vez por algum caminho não previsto (defesa extra, sem custo).

**Backend, nova rota `POST /api/leads/:id/mark-response`:** chamada pelo frontend quando o botão "Chamar no WhatsApp" é clicado. Mesmo `COALESCE(first_response_at, NOW())`, sem outro efeito colateral (não muda status, não gera `journey_log` — ver Decisão 4). Rota separada em vez de embutir no clique via `PUT /:id` porque o clique não deve carregar side-effects de edição genérica, e porque "marcar resposta" é uma ação semântica própria, não uma edição de campo.

**Frontend, `public/app.js`, handler `waCrmBtn.onclick`:** chama `api('/api/leads/' + id + '/mark-response', { method: 'POST', body: '{}' }).catch(() => {})` — fire-and-forget, sem `await`, sem bloquear a navegação pro WhatsApp mesmo se a chamada falhar (a ação principal do usuário é ir conversar com o lead; instrumentação nunca deve atrapalhar isso).

## Decisão 4 — Sem evento novo em `journey_log`

O relatório de investigação sugeriu criar um `event_type: 'first_response'`. Decisão: **não criar**. `lead_stage_changed` já registra a saída de `triagem` quando é esse o sinal; duplicar como um segundo evento na mesma timeline seria ruído. Quando o sinal é o clique no WhatsApp (sem mudança de status), a ausência de evento na jornada é aceitável — o `first_response_at` em si já é a informação, exibida diretamente no card (Decisão 5), não precisa de uma linha a mais na timeline pra ser útil.

## Decisão 5 — Exibição: badge no card do Kanban, cor por faixa de tempo

Cada card em `public/app.js` (`leads(page)`, hoje só mostra `name`/`legal_area`/`source`) ganha um badge:

- **Enquanto `first_response_at IS NULL`** (relógio rodando): mostra tempo decorrido desde `created_at` até agora, recalculado a cada carregamento da tela (sem `setInterval` — o board já recarrega ao trocar de aba/mover card, suficiente pra um cronômetro de horas/dias, não de segundos).
  - `≤ 1h`: verde, "há Xmin" — dentro do ideal.
  - `1h–4h`: âmbar, "há Xh" — atenção.
  - `> 4h`: vermelho, "há Xh" ou "há Xd" — atrasado. Limiar de 4h escolhido por ser o meio-termo mais comum de expectativa de resposta comercial (nem tão agressivo quanto minutos, nem tão frouxo quanto 24h) — sem dado histórico do escritório pra calibrar melhor, é o valor mais defensável sem inventar uma "regra de negócio" que a usuária não pediu.
- **Depois que `first_response_at` é preenchido**: badge mostra o tempo que levou até a resposta (`first_response_at - created_at`), cor fixa neutra (cinza) — vira um registro histórico, não mais um alerta.

Cálculo em JavaScript no frontend (`Date.now() - new Date(created_at)`), sem endpoint agregado novo. Confirmado no código real: `GET /api/leads/board` (`src/routes/leads.ts:35-55`) usa `SELECT` explícito de colunas (`id, name, email, phone, source, legal_area, status, created_at, analise_since, estimated_value, close_probability, next_followup`) — `first_response_at` precisa ser adicionado a essa lista explicitamente, senão o frontend nunca a recebe mesmo com a coluna existindo no banco.

## Global Constraints

- Campo novo: `leads.first_response_at DATETIME NULL`, migration sequencial após a última existente.
- `first_response_at` nunca é sobrescrito uma vez preenchido — sempre `COALESCE(first_response_at, NOW())`.
- Dois sinais de escrita: `PATCH /api/leads/:id/status` (condicional: só quando `prev.status === 'triagem' && status !== 'triagem'`) e nova rota `POST /api/leads/:id/mark-response` (chamada pelo clique em "Chamar no WhatsApp").
- Nenhum novo `event_type` em `journey_log`.
- Autenticação da rota nova: mesmo middleware já aplicado a `/api/leads` no `src/app.ts` (`authenticate, requireStaff` — confirmar valor exato durante o plano).
- Faixas de cor do badge: verde ≤1h, âmbar 1h–4h, vermelho >4h (enquanto aguardando); cinza neutro após resposta.
- Sem testes automatizados de frontend no projeto — o badge é validado com `node --check public/app.js` + checklist visual manual; o backend (nova coluna + 2 pontos de escrita) tem teste real com `node --test`.
