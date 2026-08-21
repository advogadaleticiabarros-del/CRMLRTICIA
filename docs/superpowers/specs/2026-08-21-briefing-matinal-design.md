# Briefing Jurídico Matinal — redesign

**Data:** 2026-08-21
**Status:** aprovado para implementação

**Implementado em 2026-08-20 — ver commits a partir de a2bbdeb.**

## Contexto

O resumo matinal (`src/services/morningBriefingService.ts`) já existe e roda todo dia por
e-mail (07h) e WhatsApp (08h). Hoje ele traz: frase do dia, previsão do tempo, agenda do dia,
meta do mês e "pulso do escritório" (contadores agregados).

Duas dores levaram a este redesign:

1. **A agenda não estava confiável.** Investigação encontrou dois bugs reais na sincronização
   com o Google Calendar (`GoogleCalendarService.listUpcomingEvents` cortava em 100 resultados
   sem paginação, descartando compromissos futuros quando havia mais de 100 eventos no período;
   `CalendarSyncService.syncFromGoogle` gravava `start_datetime` sem converter para UTC,
   deslocando o horário). Ambos serão corrigidos como pré-requisito deste spec.
2. **O conteúdo é raso.** Não avisa de movimentação processual (o monitoramento DJEN roda às
   08h/16h, depois do e-mail das 07h), não interpreta o que a movimentação significa, e trata
   tudo com o mesmo peso visual — tanto uma audiência hoje quanto um lead frio de 20 dias
   aparecem como texto corrido do mesmo tamanho.

## Objetivo

Transformar o resumo num **painel de comando do dia**, priorizado por gravidade, com:
movimentações processuais interpretadas (não só informadas), agenda confiável e expandida,
financeiro granular, comercial, e uma síntese final de "3 prioridades do dia".

## Fora de escopo agora (decisão explícita)

- **Radar Jurídico completo** (Informativos STJ/STF/TST): fica só a Fase A (provar a fonte
  STJ) neste spec. Generalizar para as outras cortes é um spec futuro — não construir em cima
  de fonte não testada (regra já combinada em sessão anterior).
- Fechamento de final de expediente por WhatsApp com botão de ação (é e-mail + WhatsApp texto,
  sem interatividade nova).

## 1. Ordem do cron (pré-requisito)

```
06:00 → sync completo Google Calendar (existente)
06:15 → NOVO monitoramento DJEN adiantado (existente roda 08h/16h — mantém os dois horários
         e ADICIONA este, só para alimentar o briefing fresco)
06:30 → NOVO interpretação por IA das movimentações do dia (ver seção 4)
07:00 → e-mail do briefing (existente, template novo)
08:00 → WhatsApp do briefing (existente, template novo, paridade total com o e-mail)
16:00 → monitoramento DJEN (existente, mantém)
18:30 → NOVO fechamento do dia — e-mail + WhatsApp curto (ver seção 6)
```

## 2. Correção de bugs (pré-requisito, bloqueia o resto)

### 2.1 `GoogleCalendarService.listUpcomingEvents` — corte de 100 resultados
Paginar a chamada `calendar.events.list` usando `nextPageToken` até esgotar, para cada
calendário. Sem isso, compromissos futuros somem silenciosamente quando o volume de eventos
no período (mês passado → +24 meses) passa de 100.

### 2.2 `CalendarSyncService.syncFromGoogle` — timezone
`ev.start?.dateTime` (string ISO com offset, vinda do Google) é gravado direto no banco sem
converter para o UTC real. Mesma classe de bug já corrigida em `calendar.ts` (commit
`a305ad0`) e no fluxo CRM→Google (commit `97983b6`) — nunca corrigida no sentido Google→CRM.
Corrigir convertendo `ev.start.dateTime`/`ev.end.dateTime` para um instante UTC real
(`new Date(iso).toISOString()...`) antes do INSERT/UPDATE, com teste TDD cobrindo o caso.

## 3. Taxonomia de severidade

Regra fixa por tipo de item (não delegada a IA — previsível, auditável):

| Balde | Critério |
|---|---|
| 🔴 Atenção imediata | prazo fatal hoje/amanhã · audiência/reunião hoje · tutela/liminar pendente sem resposta · pagamento (a receber ou a pagar) vencendo hoje · movimentação interpretada com prioridade "Alta" (ver seção 4) |
| 🟠 Prioridade do dia | peça em produção há mais do SLA · documento pendente do cliente há mais de 3 dias · caso parado na esteira > 10 dias · movimentação interpretada com prioridade "Média" |
| 🟢 Acompanhamento | movimentação de rotina (sem ação) · e-mail de parceria pendente de revisão · lead aguardando resposta < 48h |
| ⚪ Pode esperar | lead frio (> 48h, já sinalizado) · caso em fase avançada sem pendência · qualquer item que bateria em 🟠/🟢 mas já está dentro do prazo com folga |

"3 prioridades do dia" (fecho do briefing) = os até 3 itens de maior urgência dentro de
🔴, ordenados por: prazo fatal > audiência/reunião > tutela/liminar > movimentação prioridade
alta > pagamento. Determinístico, não é uma nova síntese por IA.

## 4. Interpretação de movimentações por IA

Reaproveita o padrão já existente do "Estagiário IA" (`aiAssistant.ts`,
`runEstagiarioForDeadline`, Groq para análise/triagem) — hoje só dispara quando a
movimentação gera um `detected_deadline`. Passa a rodar também no cron das 06:30 para
**toda** movimentação nova do dia (decisão: sem filtro por palavra-chave — mais completo,
aceita o custo de mais chamadas de IA).

Para cada `process_movements` novo do dia, gera e persiste (nova coluna
`process_movements.ai_summary` JSON: `{resumo, acao, prazo_interno, prioridade}`):

```
Prompt (Groq): leia a movimentação, devolva:
1) RESUMO em 1-2 linhas
2) AÇÃO NECESSÁRIA (ou "nenhuma" se for andamento de rotina)
3) PRAZO INTERNO recomendado (data ou "sem prazo")
4) PRIORIDADE: Alta | Média | Baixa
```

Movimentações com prioridade "Baixa" (ou "nenhuma" ação) vão para 🟢/rotina sem detalhar
item por item — só contam. Alta/Média entram no briefing com o formato completo (exemplo já
validado no protótipo: "Maria Aparecida × Rodotex — decisão publicada hoje... Ação: preparar
liquidação no PJe-Calc · prazo interno 25/08 · judicial 28/08").

## 5. Blocos de conteúdo e fonte de dado

Tudo abaixo já existe no schema — nenhuma tabela nova além do listado na seção 7.

| Bloco | Fonte |
|---|---|
| Agenda hoje + 3 dias | `calendar_events` (query estendida de `getDayAgenda`, `DATE(...) BETWEEN hoje E hoje+3`), com `location`/`video_link` para o pill presencial/online |
| Prazos hoje/amanhã/3 dias/semana | `deadlines`, agrupado por faixa em vez de só "hoje" |
| Movimentações interpretadas | `process_movements` + `ai_summary` (seção 4) |
| Peças a produzir | `cases.production_stage IN ('separacao_documentos','criacao_inicial','revisao_inicial','aguardando_protocolo')`, ordenado por `production_started_at` |
| Documentos pendentes | `cases.checklist_checked` (JSON) — itens não marcados |
| Financeiro granular | mesma base de `getPulsoNegocio()`, desagregada por tipo (parcelas, RPV/`case_awards`, depósito/`dative_payments`, correspondente) em vez de um único total |
| Comercial — leads novos | `leads` criados desde o último briefing (`created_at > NOW() - INTERVAL 1 DAY` truncado às 08h anterior) |
| Comercial — aniversariantes | `clients.birth_date` (novo campo, seção 7) `= CURDATE()` (mês/dia) |
| E-mails de parceria pendentes | `email_imports WHERE status='pendente'` (já existe em `getPulsoNegocio`) |

## 6. Fechamento do dia (18:30, novo)

Compara **tudo que mudou de status hoje** (tarefas concluídas/canceladas, prazos cumpridos,
casos que avançaram de `production_stage`, propostas fechadas) contra o que apareceu no
briefing da manhã. Gera:
- ✅ concluído hoje
- ⏳ ficou pendente (estava no briefing da manhã, não mudou de status)
- ➡️ passa pro dia seguinte (prazo/compromisso de amanhã, adiantado)

Novo serviço `eveningClosingService.ts`, reaproveita `getDayAgenda`/`getPulsoNegocio` e
compara com um snapshot salvo pela manhã (nova tabela `briefing_snapshots`, seção 7).

## 7. Mudanças de schema

```sql
-- clients: campo novo pra aniversariantes (nullable, preenchido aos poucos)
ALTER TABLE clients ADD COLUMN birth_date DATE NULL;

-- process_movements: resultado da interpretação por IA
ALTER TABLE process_movements ADD COLUMN ai_summary JSON NULL;

-- snapshot do que saiu no briefing da manhã, para o fechamento comparar à noite
CREATE TABLE briefing_snapshots (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  snapshot_date DATE NOT NULL,
  payload JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_briefing_snapshot (user_id, snapshot_date),
  CONSTRAINT fk_briefing_snapshot_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## 8. Radar Jurídico — Fase A (só provar a fonte)

Não implementar o bloco completo. Escopo desta fase:
1. Testar programaticamente o acesso à página de Informativos de Jurisprudência do STJ
   (estrutura HTML, estabilidade, se dá pra extrair tema/número/data de forma confiável).
2. Se a fonte se provar estável: guardar como spike documentado, SEM automatizar ainda.
3. Se não se provar estável: documentar por que, propor alternativa.
O bloco "⚖️ Radar jurídico" no template já nasce com o texto fixo "em construção" (já
validado no protótipo visual) — não fica vazio nem promete algo que não existe.

## 9. Design visual

Aprovado via protótipo (`https://claude.ai/code/artifact/75214f4b-0969-41a1-b40d-8475ba2d33bd`):
- Paleta e tipografia existentes mantidas (navy `#1f3047`, dourado `#c19a4e`, Georgia + Arial).
- 3 tons semânticos novos: crítico `#b3432f`, atenção `#a67626`, ok `#3d7a5c` — não competem
  com o dourado de marca.
- Hierarquia por peso tipográfico decrescente: 🔴 maior/denso → ⚪ "Pode esperar" pequeno,
  itálico, sem marcador de lista.
- Faixa de contadores (glance) logo após a frase do dia, com âncoras para cada bloco.
- Cabeçalho de cada bloco de severidade com fundo em degradê tingido (não só borda do item).
- Divisor entre a zona de triagem (🔴🟠🟢) e a zona de referência (agenda/financeiro/comercial).
- Financeiro: friso colorido por tipo (vencendo hoje = crítico, recebido = ok, neutro = navy).
- CTA final: botão principal "Abrir o CRM" + link secundário contextual pro item mais urgente.
- WhatsApp: paridade total de conteúdo com o e-mail (decisão explícita, sem versão resumida).

## 10. Testes

- TDD para os dois bugs de timezone/paginação (seção 2) antes de qualquer conteúdo novo.
- Teste da taxonomia de severidade (seção 3): dado um conjunto de itens sintéticos, cada um
  cai no balde certo.
- Teste do "3 prioridades" determinístico: mesma entrada → mesma saída, sem depender de IA.
- Teste de regressão nos testes existentes (`npm test`) a cada etapa.
- IA (interpretação de movimentação, seção 4): testar com mock — sem depender de chamada real
  ao Groq no CI.
