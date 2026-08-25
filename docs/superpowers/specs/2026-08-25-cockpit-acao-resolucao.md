# Cockpit único (Briefing → ação) — Design

**Status:** decidido pela usuária como "faça tudo que for recomendado, não me peça nada" — decisões abaixo tomadas sem ciclo de perguntas, documentadas para revisão posterior.

## Contexto

O roadmap lista "Painel de comando diário" como 40% iniciado, com:
- ✓ Já existe: Briefing Matinal (e-mail 07h + WhatsApp 08h) agregando 8 domínios com severidade crítico/atenção/pode-esperar.
- ✗ Falta: botão de ação em cada item, tela própria de cockpit, item sumir da lista quando resolvido.

**Descoberta central da investigação**: já existe uma tela funcional que cobre boa parte do "falta" — a aba **Cockpit** dentro do Dashboard (`public/app.js:dashCockpit`, rota `GET /api/dashboards/cockpit`, `src/routes/dashboards/cockpit.ts`). Ela agrega prazos críticos, intimações a confirmar, alertas de movimentação e agenda do dia, com IDs de origem já presentes nas queries (`d.id`, `ma.id`, `ce.id`). Cada linha já é clicável e navega para a tela relacionada (`row(..., 'prazos')` → `location.hash = '#prazos'`).

Isso muda o trabalho de "construir uma tela do zero" para "estender a tela existente com resolução de item" — evita duplicar lógica e mantém uma única fonte de verdade para "o que precisa de atenção hoje".

## Decisão 1 — Estender o Cockpit existente, não criar tela nova

Justificativa: já é a tela "painel de comando diário" pretendida pelo roadmap — mesmo propósito, mesmo lugar que a usuária já visita. Criar uma segunda tela paralela fragmentaria a atenção e duplicaria manutenção.

**Fora de escopo desta fase** (registrado conscientemente, não esquecido): os domínios exclusivos do morning briefing que o Cockpit ainda não cobre — movimentações interpretadas por IA (`getMovimentacoesDoDia`), pagamentos granulares por parcela (`getFinanceiroGranular`), esteira de produção por caso (`getEsteiraEDocumentos`), documentos pendentes por checklist. O Cockpit cobre prazos, intimações, alertas e agenda — o núcleo mais crítico/acionável. Trazer os domínios restantes é uma fase futura, não bloqueante para entregar "botão de ação + some da lista" no que já existe.

## Decisão 2 — Identidade estável do item: `item_key`

Cada linha do Cockpit ganha uma chave sintética e estável: `{dominio}:{id_origem}`.

| Domínio | Tabela de origem | Exemplo de item_key |
|---|---|---|
| prazo | `deadlines.id` | `prazo:481` |
| intimacao | `detected_deadlines.id` | `intimacao:22` |
| alerta | `movement_alerts.id` | `alerta:9` |
| agenda | `calendar_events.id` | `agenda:301` |

As 4 queries em `src/routes/dashboards/cockpit.ts` já selecionam esses IDs (`d.id` em prazos, `d.id` em intimações — alias distinto necessário, já que a mesma letra `d` é usada nas duas queries com tabelas diferentes — `ma.id` em alertas, `ce.id` em agenda). O `item_key` é composto em JavaScript, no map de cada resposta (não no SQL), como `` `prazo:${row.id}` `` etc. — mantém o SQL simples e a lógica de formato num único lugar por domínio.

## Decisão 3 — Persistência: nova tabela `cockpit_resolutions`

Sem tocar nas tabelas de origem (evita risco de side-effect em `deadlines`/`calendar_events`/etc, que têm suas próprias regras de negócio e telas dedicadas).

```sql
CREATE TABLE cockpit_resolutions (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_key     VARCHAR(64)  NOT NULL,
  user_id      INT UNSIGNED NOT NULL,
  resolved_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cockpit_resolution (item_key, user_id),
  CONSTRAINT fk_cockpit_resolution_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Migration `102_cockpit_resolutions.sql`.

## Decisão 4 — Expiração automática à meia-noite (fuso de Brasília)

Um item "resolvido" ontem não deve ficar escondido para sempre — se o prazo/intimação/alerta subjacente ainda existir amanhã (ex.: a usuária resolveu "ver isso depois" mas a tarefa de origem continua pendente), o Cockpit deve voltar a mostrá-lo no dia seguinte, forçando reavaliação diária — mesmo espírito do briefing matinal ser diário.

Implementação: `resolved_at` é gravado em UTC (`NOW()` do MySQL, padrão do resto do schema). O filtro em `GET /api/dashboards/cockpit` usa `DATE(CONVERT_TZ(resolved_at, '+00:00', '-03:00')) = DATE(CONVERT_TZ(NOW(), '+00:00', '-03:00'))` — mesmo padrão `CONVERT_TZ` já usado em `morningBriefingService.ts` (constantes `horaBR`/`hojeBR`). Usar `CURDATE()` puro seria um bug: o servidor MySQL roda em UTC, então "meia-noite" seria a de UTC (21h de Brasília), não a de Brasília — o item reapareceria 3h cedo demais. Sem cron de limpeza — linhas antigas só deixam de ser lidas, e podem ser podadas por retenção geral do sistema depois, fora de escopo aqui.

**Não é "unresolve"**: dentro do mesmo dia, um item resolvido fica resolvido — não há detecção de "a origem mudou, deveria reaparecer". Simplicidade deliberada: o botão "Resolver" comunica "não preciso ver isso de novo hoje", não "isso está permanentemente tratado".

## Decisão 5 — Botão "Resolver" por linha

Cada linha do painel (`row(...)` em `dashCockpit`) ganha um botão de ação (ícone de check) ao lado do conteúdo clicável existente — sem remover a navegação atual (clicar no corpo da linha ainda leva à tela relacionada; o botão é uma ação adicional, não substitui).

`POST /api/dashboards/cockpit/resolver` — body `{ item_key: string }`. `INSERT ... ON DUPLICATE KEY UPDATE resolved_at = NOW()` (idempotente). Após sucesso, o frontend remove a linha do DOM imediatamente (sem esperar re-fetch) — mesmo padrão de feedback instantâneo já usado no fix de clique da lista do WhatsApp desta sessão.

## Decisão 6 — Contagens dos painéis refletem só o não-resolvido

`painel(titulo, count, ...)` já mostra `(N)` ao lado do título — esse `count` passa a ser o tamanho do array já filtrado (pós-exclusão de resolvidos), não o total bruto da query. Consistente com "some da lista quando resolvido" também valer para o contador.

## Global Constraints

- Fuso horário: `America/Sao_Paulo`, mesmo padrão `CONVERT_TZ`/`CURDATE()` usado em `morningBriefingService.ts` e `dashboards/cockpit.ts`.
- Autenticação: `authenticate, requireStaff` (mesmo nível já usado em `/api/dashboards/cockpit`) — não `requireAdmin` (o Cockpit é usado por qualquer staff, não só admin).
- `item_key` é `VARCHAR(64)`, formato `{dominio}:{id}` com `dominio` em minúsculas ASCII sem acento.
- Zero funcionalidade nova na navegação por clique existente (`onclick="location.hash=..."`) — o botão de resolver é aditivo.
- Sem testes automatizados de frontend no projeto (confirmado em specs anteriores) — testes cobrem a rota de API (`POST /resolver`, filtro de `GET`) e são manuais/visuais para a tela.
