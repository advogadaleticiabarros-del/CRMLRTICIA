# FullCycle Squad — Memória da Squad

Memória de nível squad: aprendizados genéricos, reutilizáveis em qualquer projeto.
Contexto específico de cada projeto vive em `projects/<projeto>/_memory/`.

---

## Setup

- [ ] Onboarding de primeira utilização apresentado (skills recomendadas) — registrar a data aqui quando feito. Enquanto este item estiver desmarcado, executar `onboarding.first_run` do `squad.yaml`.

---

## Aprendizados reutilizáveis

- **RLS desde o início**: desenhar policies (anon vs authenticated) junto com a tabela evita retrabalho e brechas. Service role key apenas server-side.
- **Proxy server-side para APIs externas**: uma Edge Function como proxy resolve CORS e mantém API keys fora do frontend.
- **Auditoria com campos mascarados**: logs de alteração (JSONB diff) devem mascarar campos sensíveis antes de persistir.
- **Webhooks idempotentes**: receivers de integração precisam tolerar entrega duplicada do mesmo evento sem duplicar dados.

> Adicione novos aprendizados acima, sempre com uma linha por aprendizado e contexto suficiente para reaplicar em outro projeto.

---

## Histórico da squad

| Data | Evento |
|------|--------|
| 2026-06-11 | v1.0.0 — Squad criada para o ExpxAgents (9 membros, orquestração completa) com identidade role-first: `id` por especialidade como identificador primário, `callsign` humano opcional e configurável |
| 2026-06-14 | v1.1.0 — Protocolo de diálogo interativo (descoberta → proposta → confirmação → execução → verificação) em `personas/_protocolo-dialogo.md`, com seção "Como conduz a conversa" por persona e pipeline alinhado às 5 fases |
| 2026-06-18 | Projeto CRM Jurídico — Item 1 (estrutura) entregue: Node+TS+Express+mysql2, env(zod)+pool MySQL, JWT middleware, app/index, migrate runner, railway.json. typecheck+build exit 0. Próximo: item 2 (migration 001 com tabelas base: users, clients, leads, propostas, cases, tasks, deadlines, documents, installments, financial_records, case_movements, legal_pieces) |

---

Última atualização: 2026-06-14 | Versão da squad: 1.1.0
