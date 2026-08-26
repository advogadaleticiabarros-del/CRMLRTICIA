# Qualificação automática do lead pela IA — Design

**Status:** decidido pela usuária como "faça tudo que for recomendado, não pergunte, resolva" — decisões tomadas sem ciclo de perguntas. 3º de 4 sub-projetos de "Comercial & intake".

## Contexto

Roadmap: "Qualificação automática do lead pela IA (área, urgência, valor)". Investigação confirma que o projeto já tem uma divisão de IA madura: **Groq** (`openai/gpt-oss-120b`) para triagem/classificação rápida, **Gemini** (`gemini-2.5-flash`) para redação/análise profunda — `interpretarMovimentacao` (`src/services/aiAssistant.ts:305-324`) é o padrão exato a seguir: prompt com campos rotulados em texto plano (não JSON mode), parser tolerante por regex com fallback seguro, `aiComplete(prompt, 'groq')` que nunca lança exceção (retorna `{ok:false}` se IA indisponível/sem chave).

`leads.legal_area`/`estimated_value` já existem; **não existe** coluna de urgência comercial (a única "urgência" do sistema é de `intakes`, módulo separado do Kanban de leads, e não deve ser reaproveitada). O formulário público (`POST /api/public/lead`) já captura texto livre real do lead (`message`, até 2000 chars, vira `case_summary`) — é a fonte de sinal mais rica, disponível no exato momento da criação.

**Achado de risco**: não existe hoje nenhum controle de custo/quota de IA no projeto — todo uso é pontual e sob demanda. Qualificar automaticamente **todo** lead criado seria a primeira vez que IA roda em escala/volume. O formulário público já tem proteção contra spam (honeypot + rate-limit de 5 req/15min por IP) — a decisão de escopo abaixo trata esse risco.

## Decisão 1 — O que a IA sugere: área, urgência comercial, faixa de valor (não valor exato)

Três campos, na mesma chamada (1 prompt, 1 request):
- **`legal_area`** — uma das 7 chaves já existentes (`trabalhista, gestante, familia, civel, previdenciario, consumidor, outro`).
- **`ai_urgency`** — `alta | media | baixa` (comercial: "esse lead precisa ser atendido logo", não prazo processual).
- **Faixa de valor estimado**, não um número exato — pedir um DECIMAL exato pra IA "chutar" a partir de 2-3 frases de um formulário de contato seria fabricar precisão que não existe, e poderia poluir relatórios financeiros que hoje já usam `estimated_value` real (`pipeline_estimado` no dashboard comercial). Em vez disso, a IA sugere uma faixa qualitativa (`baixo | medio | alto`) guardada num campo próprio (`ai_value_range`), **nunca** grava em `estimated_value` diretamente — esse campo continua 100% controlado por humano.

## Decisão 2 — Nunca sobrescreve o que um humano já preencheu

A IA só sugere `legal_area` se o lead ainda está com o valor default/vazio (`legal_area IS NULL` ou não veio no cadastro) — um humano que já escolheu a área manualmente nunca é corrigido por uma sugestão de IA. `ai_urgency`/`ai_value_range` são campos **próprios**, adicionais (`ai_` de prefixo), nunca escrevem em cima de `legal_area`/`estimated_value` que um humano tenha definido — são informação a mais exibida ao lado, não substituição.

## Decisão 3 — Quando roda: só na criação, só com texto real, best-effort

Dispara em `POST /api/public/lead` (fonte de texto mais rica) e `POST /api/leads` (uso interno, quando `case_summary`/`notes` vem preenchido) — **não** roda em `PUT`/edições posteriores (evita rodar IA repetidamente a cada pequena edição administrativa). Só chama a IA se houver texto de pelo menos 15 caracteres em `case_summary` (ou `notes`, o que estiver disponível) — sem texto, não há sinal suficiente pra qualificar, e a chamada seria desperdício.

Fire-and-forget, mesmo padrão de `enviarEbook(...).catch(() => {})` já usado em `lead-public.ts:137` (que já dispara antes do `res.status(201).json(...)` final, sem `await`, sem bloquear a resposta) — a chamada de qualificação segue o mesmo lugar/padrão: disparada sem `await` antes do `res.status(201)`, nunca atrasa nem falha a resposta HTTP do formulário público.

## Decisão 4 — Proteção de custo: throttle simples por reaproveitar o rate-limit já existente

Sem adicionar um sistema de quota novo (não há precedente no projeto — YAGNI, seria over-engineering pra um primeiro uso em escala). A defesa real contra abuso já existe: o `tooMany()` de `lead-public.ts` barra 5+ submissões por IP em 15 minutos, então a IA nunca é chamada mais que isso por atacante em potencial. `POST /api/leads` (uso interno, atrás de `authenticate`) não tem esse risco — só a advogada/equipe cria leads por ali.

## Decisão 5 — Exibição: badges no card do Kanban e no modal de detalhe

Card do Kanban (`leads(page)`, `public/app.js`) ganha um badge de urgência (cor: vermelho `alta`, âmbar `media`, sem badge se `baixa`/nulo — silêncio é "normal", só chama atenção quando é alto) ao lado do badge de tempo (cronômetro, sub-projeto 1). No modal `leadDetail`, se `ai_urgency`/`ai_value_range`/uma sugestão de `legal_area` diferente da atual existirem, aparece uma pequena caixa "Sugestão da IA" — texto simples, sem ação automática (a advogada decide se aceita, alterando `legal_area` manualmente pelo campo já existente).

## Global Constraints

- Nova migration: `leads.ai_urgency VARCHAR(10) NULL` (`alta|media|baixa`), `leads.ai_value_range VARCHAR(10) NULL` (`alto|medio|baixo`).
- IA usada: `aiComplete(prompt, 'groq')`, mesmo padrão de `interpretarMovimentacao` — prompt com campos rotulados em texto plano, parser por regex tolerante, fallback seguro se campo não bater no formato esperado.
- `legal_area` só é sugerida/gravada pela IA se o lead ainda não tem uma definida — nunca sobrescreve escolha humana.
- `ai_urgency`/`ai_value_range` são campos adicionais, nunca escrevem em `estimated_value`/`close_probability`.
- Dispara só em `POST /api/public/lead` e `POST /api/leads` (na criação), nunca em edições (`PUT`) — e só quando há texto ≥15 caracteres disponível.
- Fire-and-forget, nunca bloqueia nem falha a criação do lead.
- Sem sistema de quota novo — reaproveita o rate-limit de IP já existente no formulário público como única defesa de custo.
- Sem testes automatizados de frontend — badges validados com `node --check` + checklist visual manual; backend (parser + gravação condicional) tem teste real com `node --test`, mesmo padrão sem HTTP/supertest já usado nesta sessão.
