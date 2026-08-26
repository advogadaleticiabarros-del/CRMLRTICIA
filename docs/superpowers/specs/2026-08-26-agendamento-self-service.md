# Agendamento self-service de consulta — Design

**Status:** decidido pela usuária como "faça tudo que for recomendado, não pergunte, resolva" — decisões tomadas sem ciclo de perguntas. 4º e último sub-projeto de "Comercial & intake".

## Contexto

Roadmap: "Agendamento self-service de consulta" — um lead/possível cliente marca uma consulta sozinho, sem precisar ligar/mandar mensagem pedindo horário. Investigação confirma: **nada disso existe hoje** — `calendar_events` não tem noção de disponibilidade/vagas, `office_settings` não tem horário de expediente, não existe LP nem rota pública de agendamento (a menção anterior em memória a "LP fale-com-a-advogada" nunca foi implementada no backend). É o mais complexo dos 4 sub-projetos desta sessão, coerente com a ordem "do mais simples ao mais complexo" já definida.

**O que já existe e pode ser reaproveitado**: `POST /api/calendar/events` (autenticado) já cria evento + sincroniza Google + notifica Telegram + cria lembrete — mas pressupõe um usuário logado (`req.user.id`), então não dá pra chamar essa rota diretamente do público; `POST /api/public/lead` já é o padrão de rota pública anti-spam (honeypot, rate-limit por IP, CORS aberto por rota) a replicar. `office_settings` já é key-value genérico, só falta adicionar chaves novas.

## Decisão 1 — Escopo: 1 profissional, slots fixos, sem freebusy do Google

O sistema hoje tem uma advogada só usando o CRM ativamente (confirmado pelo padrão de todo o restante do sistema — `ALERT_NUMBERS`, admin único em `lead-public.ts`). Não há necessidade de suportar múltiplos profissionais com agendas concorrentes nesta fase. Os slots livres são calculados **só a partir do que já está em `calendar_events`** (que já é sincronizado bidirecionalmente com o Google via `CalendarSyncService`) — **não** se consulta a API de freebusy do Google diretamente. Isso evita adicionar uma segunda fonte de verdade de disponibilidade e mantém o escopo restrito ao que o CRM já controla. Trade-off aceito: um evento criado no Google e ainda não puxado pelo sync (`syncFromGoogle` roda por polling/callback, não em tempo real) pode, em teoria, colidir com um agendamento self-service — risco baixo, mesma limitação que já existe hoje pra qualquer sincronização assíncrona do sistema.

## Decisão 2 — Expediente: novas chaves em `office_settings`

Mesmo padrão key-value já usado (`pix_key`, `whatsapp`, etc.):

- `agenda_dias_semana` — string CSV de dias úteis (`"1,2,3,4,5"`, 1=segunda...7=domingo; default se ausente: `"1,2,3,4,5"`).
- `agenda_hora_inicio` / `agenda_hora_fim` — `"HH:MM"` (default `"09:00"` / `"18:00"`).
- `agenda_duracao_consulta_min` — inteiro em minutos (default `60`).
- `agenda_self_service_ativo` — `"1"`/`"0"` (default `"0"` — **desligado até a usuária ativar explicitamente**, já que é uma superfície pública nova; ativação é uma ação consciente, não um opt-out).

Sem tabela nova — reaproveita `office_settings` exatamente como já funciona.

## Decisão 3 — Cálculo de vagas: função pura, sem tocar banco

`calcularSlotsDisponiveis(expediente, eventosExistentes, dataInicio, dataFim)` — gera todos os intervalos de `agenda_duracao_consulta_min` dentro do expediente configurado, nos dias úteis configurados, entre `dataInicio`/`dataFim` (janela de busca, ex.: próximos 14 dias), e remove os que colidem com qualquer `calendar_events` existente do período (checagem de sobreposição de intervalo, não só o mesmo horário exato). O único utilitário de fuso já existente é `localParaUtcMysql` (`src/utils/timezone.ts`, converte string local Brasília→UTC para gravação — não existe o inverso pronto no projeto); a função de slots trabalha em horário de Brasília (fixo, sem horário de verão desde 2019, mesma premissa do utilitário existente) internamente e usa `localParaUtcMysql` só no ponto de gravação/comparação com o banco, não precisa de um novo utilitário de conversão inversa. Retorna lista de `{start_datetime, end_datetime}` como strings locais Brasília. Testável isoladamente sem banco — só recebe os eventos já buscados como parâmetro.

## Decisão 4 — Duas rotas públicas, mesmo padrão anti-spam de `lead-public.ts`

- `GET /api/public/agenda/slots?dias=14` — retorna a lista de horários livres calculada pela Decisão 3. Sem honeypot/rate-limit agressivo (é leitura, não escrita) — mas ainda assim limitado (`dias` máximo 30, para não expor a agenda inteira de uma vez e limitar custo de query).
- `POST /api/public/agenda/agendar` — cria o agendamento. Mesmo honeypot (`website`) e rate-limit por IP (5/15min, reaproveitando o mesmo padrão `tooMany()`) de `lead-public.ts`. Campos: `name*`, `phone*`, `email`, `start_datetime*` (deve ser um dos slots retornados por `/slots` — revalidado no servidor antes de criar, contra condição de corrida de dois usuários pegando o mesmo horário ao mesmo tempo), `message` (motivo da consulta, opcional).

Ambas as rotas retornam `503` se `agenda_self_service_ativo !== '1'` — a feature existe no código mas fica inerte até a usuária ligar.

## Decisão 5 — O que a criação faz: lead + evento + pipeline já existente

`POST /agendar`:
1. Revalida que o `start_datetime` pedido ainda está livre (query direta em `calendar_events`, mesma checagem de sobreposição da Decisão 3) — 409 se não estiver mais (outra pessoa já pegou).
2. Cria (ou reaproveita, mesma dedupe de 24h por telefone/e-mail já usada em `lead-public.ts`) um `lead` com `status='triagem'`, `source='agendamento_site'`.
3. Cria o `calendar_event` (`event_type='reuniao'`, `title` = "Consulta — {nome}", `user_id` = admin fixo, mesma lógica de `POST /api/calendar/events` — sync Google + Telegram + lembrete reaproveitados **por chamada direta às mesmas funções de serviço** (`googleCalendarService.createEvent`, `telegramNotificationService.sendReuniaoAgendada`, `notificationService.create`), não por HTTP interno — evita duplicar a lógica de negócio em dois lugares.
4. Dispara `notifyNewLead(...)` (já existente) — a equipe já é avisada pelo mesmo canal (sino + WhatsApp) que avisa de qualquer lead novo, sem precisar de um canal de notificação novo.

## Decisão 6 — Frontend: página pública simples, sem tela nova no CRM

Uma página HTML própria (mesmo padrão de página pública standalone, análoga a `public/proposta.html` já existente no projeto — página estática servida direto, com seu próprio JS inline, fora do SPA autenticado) — não uma tela dentro do SPA autenticado do CRM. Mostra os dias/horários livres retornados por `/slots` num calendário simples (lista agrupada por dia, sem biblioteca de calendário pesada — poucos slots por dia, lista já é suficiente), formulário de dados de contato, confirmação após `POST /agendar`. Fica em `public/agendamento.html` (arquivo standalone, servido estático, com seu próprio `<script>` inline — mesmo espírito de simplicidade das outras páginas públicas do projeto, sem entrar no bundle do SPA principal).

## Global Constraints

- `agenda_self_service_ativo` desligado por padrão — feature existe mas fica inerte até ativação consciente.
- Sem consulta a freebusy do Google — cálculo de vagas usa só `calendar_events` já sincronizado no banco.
- `calcularSlotsDisponiveis` é função pura, sem I/O — testável isoladamente.
- Revalidação de disponibilidade no servidor no momento do `POST /agendar` (não confia só no que o cliente calculou/enviou) — 409 se o slot já foi ocupado.
- Reaproveita as mesmas funções de serviço já usadas por `POST /api/calendar/events` (Google sync, Telegram, lembrete) e por `POST /api/public/lead` (dedupe de lead, `notifyNewLead`) — sem duplicar lógica de negócio, sem nova tabela além das chaves novas em `office_settings`.
- Mesmo padrão anti-spam de `lead-public.ts`: honeypot + rate-limit de IP em `POST /agendar`.
- Frontend é uma página pública standalone (`public/agendamento.html`), não uma tela nova dentro do SPA autenticado do CRM.
- Sem testes automatizados de frontend — a página é validada com checklist visual manual; backend (cálculo de slots + revalidação + criação) tem teste real com `node --test`, mesmo padrão sem HTTP/supertest já usado nesta sessão para a função pura, e teste de integração real para a parte que toca banco.
