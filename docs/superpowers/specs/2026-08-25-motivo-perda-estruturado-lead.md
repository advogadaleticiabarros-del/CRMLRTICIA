# Motivo de perda estruturado — Design

**Status:** decidido pela usuária como "faça tudo que for recomendado, não pergunte, resolva" — decisões abaixo tomadas sem ciclo de perguntas. 2º de 4 sub-projetos de "Comercial & intake".

## Contexto

Roadmap: "Motivo de perda estruturado (preço, sumiu, foi com outro...)". Investigação do código real confirma: `leads.loss_reason` já existe (`VARCHAR(255) NULL`, migration 017), mas é **texto livre opcional** — o modal de detalhe do lead (`leadDetail`, `public/app.js`) mostra um `<textarea>` sem opções pré-definidas quando o status muda pra `perdida`, sem `required`; o backend (`PUT /api/leads/:id`) grava o que vier, inclusive vazio (`''` vira `null`). O dashboard comercial já conta "leads perdidos" no funil de conversão (`calcularFunilConversao`), mas sem nenhuma quebra por motivo — não dá pra saber hoje *por que* os leads se perdem, só quantos.

## Decisão 1 — Lista fixa de motivos, mesmo padrão de `AREAS`

Sem nova migration (a coluna já é `VARCHAR(255)`, compatível com qualquer string curta da lista) — só passa a ser **validada** contra um conjunto fixo, igual `AREAS` já é (`src/routes/leads.ts:22`, `.includes()` antes de gravar).

```typescript
const LOSS_REASONS = ['preco', 'sumiu', 'foi_com_outro', 'desistiu', 'fora_area_atuacao', 'sem_perfil', 'outro'];
```

| Chave | Rótulo (PT) |
|---|---|
| `preco` | Achou o preço alto |
| `sumiu` | Parou de responder |
| `foi_com_outro` | Fechou com outro escritório |
| `desistiu` | Desistiu do processo |
| `fora_area_atuacao` | Fora da área de atuação do escritório |
| `sem_perfil` | Sem perfil pro caso (triagem negativa) |
| `outro` | Outro motivo |

`preco`/`sumiu`/`foi_com_outro` vêm direto do roadmap ("preço, sumiu, foi com outro"); `desistiu`/`fora_area_atuacao`/`sem_perfil` cobrem os motivos reais mais comuns de perda em escritório de advocacia que os 3 exemplos do roadmap não mencionam explicitamente, mas que o funil já demonstra existir (leads de área que o escritório não atende, leads que a triagem recusa); `outro` é o escape hatch — sempre necessário numa lista fixa nova, sem histórico de dados pra saber se a lista está completa.

## Decisão 2 — Motivo passa a ser obrigatório ao marcar como "Perdida", travado no backend

Hoje: `PATCH /api/leads/:id/status` aceita `status = 'perdida'` sem checar `loss_reason` — o campo é preenchido depois, opcionalmente, por um `PUT` genérico separado. Isso é a causa raiz de "estruturado" não ter valor: nada impede a advogada de mover o lead pra perdido sem nunca dizer por quê, e é exatamente isso que acontece hoje na prática (campo de texto livre sem `required` no frontend).

**Mudança**: `PATCH /:id/status` passa a aceitar `loss_reason` no mesmo body, e exige (400 se ausente/inválido) quando `status === 'perdida'`:

```typescript
if (status === 'perdida' && !LOSS_REASONS.includes(loss_reason)) {
  res.status(400).json({ error: `loss_reason é obrigatório e deve ser um de: ${LOSS_REASONS.join(', ')}` });
  return;
}
```

Gravado no mesmo `UPDATE` que já muda `status`/`analise_since`/`first_response_at` — uma query, sem side-effect novo. Quando o status **não** é `perdida`, `loss_reason` é ignorado nesta rota (não é limpo/resetado automaticamente ao sair de "perdida" — um lead reaberto mantém o motivo antigo registrado até ser perdido de novo, que é histórico útil, não lixo a apagar).

**Compatibilidade**: `PUT /api/leads/:id` continua aceitando `loss_reason` como campo genérico (via `EXTRA_COLS`) para edição administrativa/correção posterior — mas o caminho normal de perder um lead (mover a etapa) passa a exigir o motivo no ato, não depois.

## Decisão 3 — Frontend: `<select>` fixo no lugar do `<textarea>` livre

No modal `leadDetail`, o campo hoje é um `<textarea name="loss_reason">` sem opções, mostrado/escondido por `syncLoss()` quando o `<select name="status">` muda para `perdida`. Vira um `<select name="loss_reason">` com as 7 opções da Decisão 1 (rótulo PT, valor chave), mesmo padrão de `field(..., { options })` já usado para `legal_area` no mesmo arquivo. Continua condicional (só aparece com `status = perdida`), mas passa a ter `required` no HTML **e** a validação já reforçada no backend (Decisão 2) — dupla camada, já que o frontend sozinho nunca é suficiente (chamada direta à API contornaria).

Um campo de texto livre adicional (`notes`, coluna já existente e genérica) continua disponível pra detalhe extra opcional ("foi com outro, mas mencionou que pode voltar em 2026") — não se perde a capacidade de anotar contexto, só deixa de ser o único mecanismo.

## Decisão 4 — Dashboard: quebra de perdidos por motivo

`calcularFunilConversao` (`src/routes/dashboards/comercial.ts`) já conta `desfechos.perdidos`. Adiciona uma quebra complementar, mesmo filtro por `user_id` já usado por todas as outras queries dessa rota (`leadsPorStatus`, `porOrigem`, `porArea` — nenhuma delas filtra por período, só por usuário):

```sql
SELECT loss_reason, COUNT(*) AS total FROM leads WHERE user_id = ? AND status = 'perdida' AND loss_reason IS NOT NULL AND loss_reason <> '' GROUP BY loss_reason ORDER BY total DESC
```

Exposto como `motivos_perda: [{motivo, label, total}]` dentro da mesma resposta de `GET /api/dashboards/comercial`, ao lado de `funil_conversao` (já existente) — sem rota nova. Frontend (`dashComercial`) ganha uma lista/barra horizontal simples (mesmo componente `chartHBars` já usado pra "Leads por origem"/"Leads por área jurídica" nessa mesma tela) mostrando os motivos mais comuns.

Leads perdidos **antes** desta mudança (com `loss_reason` livre/vazio) não batem com nenhuma das 7 chaves fixas — a query `GROUP BY loss_reason` simplesmente os ignora (filtro `loss_reason IS NOT NULL` já exclui vazios, e valores de texto livre antigos aparecem como sua própria "categoria" de uma linha só, sem tradução pra rótulo bonito — aceitável, é dado histórico anterior à estruturação, não vale migrar/normalizar retroativamente).

## Global Constraints

- Sem nova migration — `loss_reason` continua `VARCHAR(255) NULL`, só passa a ser validado contra `LOSS_REASONS` no backend.
- `LOSS_REASONS` definida em `src/routes/leads.ts`, mesmo padrão/local de `AREAS`.
- `PATCH /api/leads/:id/status` rejeita (400) `status='perdida'` sem `loss_reason` válido — validação ANTES de qualquer escrita no banco.
- `PUT /api/leads/:id` não valida `loss_reason` contra a lista (mantém compatibilidade de edição livre por admin) — só o caminho de "perder o lead" via mudança de status é travado.
- Frontend: `<select>` obrigatório no lugar do `<textarea>`, mesmas 7 chaves/rótulos do backend (duplicação de string aceitável — é um dicionário de exibição, não lógica de negócio, mesmo padrão de `LEGAL_AREA_PT`).
- `motivos_perda` no dashboard comercial não reprocessa leads perdidos antes desta mudança (texto livre antigo não bate com as chaves fixas — ficam de fora da quebra, aparecem só no total de "perdidos" do funil).
- Sem testes automatizados de frontend — o `<select>` é validado com `node --check public/app.js` + checklist visual manual; backend tem teste real com `node --test` (padrão do projeto, sem HTTP/supertest).
