# Mapa da API do CRM

> Gerado automaticamente por `npm run docs:api` a partir do código. **Não edite à mão.**
> Acesso: **público** (sem login), **logado** (qualquer usuário), **equipe** (admin, advogada, staff), **admin**.
> Dentro de cada rota pode haver checagem extra (ex.: dono do registro, papel parceiro).

**489 rotas em 78 grupos.**

## `/api/access-logs` · admin · `src/routes/accessLogs.ts`

| Método | Caminho |
|---|---|
| GET | `/api/access-logs` |
| GET | `/api/access-logs/stats` |

## `/api/acordos` · equipe · `src/routes/acordos.ts`

| Método | Caminho |
|---|---|
| GET | `/api/acordos` |
| GET | `/api/acordos/stats/resumo` |
| GET | `/api/acordos/:id` |
| GET | `/api/acordos/:id/cronograma` |
| GET | `/api/acordos/:id/repasses` |
| PATCH | `/api/acordos/repasses/:payoutId/marcar-repassado` |
| GET | `/api/acordos/repasses/:payoutId/prestacao` |
| POST | `/api/acordos/repasses/:payoutId/prestacao/enviar` |
| POST | `/api/acordos/:id/gerar-termo` |
| POST | `/api/acordos/:id/minuta` |
| GET | `/api/acordos/:id/minuta` |
| POST | `/api/acordos` |
| GET | `/api/acordos/detectados/pendentes` |
| POST | `/api/acordos/detectados/varrer` |
| POST | `/api/acordos/detectados/:id/descartar` |
| PUT | `/api/acordos/:id` |
| POST | `/api/acordos/:id/assinar` |
| POST | `/api/acordos/:id/encerrar` |
| POST | `/api/acordos/:id/cancelar` |

## `/api/ai` · equipe · `src/routes/ai.ts`

| Método | Caminho |
|---|---|
| GET | `/api/ai/templates` |
| GET | `/api/ai` |
| GET | `/api/ai/config` |
| POST | `/api/ai/testar-openai` |
| GET | `/api/ai/:id` |
| POST | `/api/ai/generate` |
| POST | `/api/ai/:id/result` |
| POST | `/api/ai/:id/save-document` |
| DELETE | `/api/ai/:id` |

## `/api/atendente` · equipe · `src/routes/atendente.ts`

| Método | Caminho |
|---|---|
| GET | `/api/atendente/rascunhos` |
| POST | `/api/atendente/rascunhos/:id/enviar` |
| POST | `/api/atendente/rascunhos/:id/descartar` |
| GET | `/api/atendente/guia` |
| POST | `/api/atendente/estudar-tom` |

## `/api/auditoria-financeira` · equipe · `src/routes/auditoria-financeira.ts`

| Método | Caminho |
|---|---|
| GET | `/api/auditoria-financeira` |
| GET | `/api/auditoria-financeira/stats` |

## `/api/auth` · público · `src/routes/auth.ts`

| Método | Caminho |
|---|---|
| POST | `/api/auth/login` |
| POST | `/api/auth/login/2fa` |
| POST | `/api/auth/forgot` |
| POST | `/api/auth/reset` |
| GET | `/api/auth/reset-requests` |
| GET | `/api/auth/me` |
| POST | `/api/auth/register` |
| PATCH | `/api/auth/password` |
| POST | `/api/auth/passkey/register/options` |
| POST | `/api/auth/passkey/register/verify` |
| GET | `/api/auth/passkey` |
| DELETE | `/api/auth/passkey/:id` |
| POST | `/api/auth/passkey/login/options` |
| POST | `/api/auth/passkey/login/verify` |

## `/api/automation` · admin · `src/routes/automation.ts`

| Método | Caminho |
|---|---|
| GET | `/api/automation/rules` |
| PATCH | `/api/automation/rules/:key` |

## `/api/awards` · equipe · `src/routes/awards.ts`

| Método | Caminho |
|---|---|
| GET | `/api/awards` |
| POST | `/api/awards` |
| PUT | `/api/awards/:id` |
| PATCH | `/api/awards/:id/receber` |
| POST | `/api/awards/:id/cancelar` |

## `/api/backup` · admin · `src/routes/backup.ts`

| Método | Caminho |
|---|---|
| GET | `/api/backup` |
| POST | `/api/backup/run` |
| GET | `/api/backup/download-local` |

## `/api/bank-statement` · equipe · `src/routes/bankStatement.ts`

| Método | Caminho |
|---|---|
| POST | `/api/bank-statement/import` |
| GET | `/api/bank-statement/summary` |
| GET | `/api/bank-statement/entries` |
| GET | `/api/bank-statement/pendentes` |
| PATCH | `/api/bank-statement/:id/review` |
| GET | `/api/bank-statement/imports` |

## `/api/briefing` · admin · `src/routes/briefing.ts`

| Método | Caminho |
|---|---|
| POST | `/api/briefing/run` |

## `/api/busca` · equipe · `src/routes/busca.ts`

| Método | Caminho |
|---|---|
| GET | `/api/busca` |

## `/api/calendar` · equipe · `src/routes/calendar.ts`

| Método | Caminho |
|---|---|
| GET | `/api/calendar/google/auth-url` |
| GET | `/api/calendar/google/status` |
| DELETE | `/api/calendar/google/disconnect` |
| GET | `/api/calendar/events` |
| POST | `/api/calendar/events` |
| GET | `/api/calendar/feed` |
| GET | `/api/calendar/events/:id` |
| PATCH | `/api/calendar/events/:id/status` |
| DELETE | `/api/calendar/events/:id` |
| POST | `/api/calendar/events/:id/stop-series` |
| POST | `/api/calendar/google/sync` |

## `/api/card-statement` · equipe · `src/routes/cardStatement.ts`

| Método | Caminho |
|---|---|
| POST | `/api/card-statement/import` |
| GET | `/api/card-statement/summary` |
| GET | `/api/card-statement/entries` |
| GET | `/api/card-statement/pendentes` |
| PATCH | `/api/card-statement/:id/review` |
| GET | `/api/card-statement/imports` |

## `/api/cases` · equipe · `src/routes/cases.ts`

| Método | Caminho |
|---|---|
| GET | `/api/cases` |
| GET | `/api/cases/production-board` |
| GET | `/api/cases/sem-procuracao` |
| GET | `/api/cases/:id/ficha` |
| GET | `/api/cases/:id/production` |
| POST | `/api/cases/:id/contexto` |
| POST | `/api/cases/:id/peticao-inicial` |
| PATCH | `/api/cases/:id/production-meta` |
| POST | `/api/cases/:id/analisar-documentos` |
| POST | `/api/cases/:id/production-notes` |
| PATCH | `/api/cases/production-notes/:noteId/resolve` |
| GET | `/api/cases/:id/checklist` |
| PATCH | `/api/cases/:id/checklist` |
| POST | `/api/cases/:id/briefing-audiencia` |
| GET | `/api/cases/:id` |
| POST | `/api/cases/:id/partes` |
| DELETE | `/api/cases/:id/partes/:parteId` |
| POST | `/api/cases` |
| GET | `/api/cases/prescricao/sugestao` |
| PUT | `/api/cases/:id` |
| GET | `/api/cases/:id/collaborators` |
| POST | `/api/cases/:id/collaborators` |
| POST | `/api/cases/:id/duplicate` |
| DELETE | `/api/cases/:id` |
| DELETE | `/api/cases/:id/collaborators/:userId` |
| POST | `/api/cases/:id/movements` |
| PATCH | `/api/cases/:id/production-stage` |
| POST | `/api/cases/:id/reject` |
| POST | `/api/cases/:id/reject/revert` |
| GET | `/api/cases/:id/timeline` |

## `/api/cashflow` · equipe · `src/routes/cashflow.ts`

| Método | Caminho |
|---|---|
| GET | `/api/cashflow/monthly` |
| GET | `/api/cashflow/categories` |
| GET | `/api/cashflow` |
| GET | `/api/cashflow/opcoes` |
| POST | `/api/cashflow` |
| PATCH | `/api/cashflow/:id/pay` |
| PATCH | `/api/cashflow/:id/reopen` |
| PUT | `/api/cashflow/:id` |
| DELETE | `/api/cashflow/group/:group` |
| DELETE | `/api/cashflow/:id` |

## `/api/cerebro` · equipe · `src/routes/cerebro.ts`

| Método | Caminho |
|---|---|
| POST | `/api/cerebro/importar` |
| POST | `/api/cerebro/concluir` |
| POST | `/api/cerebro/perguntar` |
| GET | `/api/cerebro/organizacao` |
| GET | `/api/cerebro/resumo` |

## `/api/clients` · equipe · `src/routes/clients.ts`

| Método | Caminho |
|---|---|
| GET | `/api/clients/conflito` |
| GET | `/api/clients` |
| GET | `/api/clients/busca-360` |
| GET | `/api/clients/:id/visao` |
| GET | `/api/clients/:id/senha-inss` |
| PUT | `/api/clients/:id/senha-inss` |
| GET | `/api/clients/:id` |
| GET | `/api/clients/:id/portal-messages` |
| POST | `/api/clients/:id/portal-messages` |
| GET | `/api/clients/:id/timeline` |
| GET | `/api/clients/:id/ficha` |
| GET | `/api/clients/:id/exportar-lgpd` |
| POST | `/api/clients` |
| PUT | `/api/clients/:id` |
| PATCH | `/api/clients/:id/status` |

## `/api/contracts` · equipe · `src/routes/contracts.ts`

| Método | Caminho |
|---|---|
| GET | `/api/contracts` |
| GET | `/api/contracts/:id` |
| GET | `/api/contracts/:id/party` |
| POST | `/api/contracts/:id/buscar-partes` |
| PATCH | `/api/contracts/:id/complement` |
| POST | `/api/contracts/:id/gerar-menor` |
| POST | `/api/contracts/:id/reprocessar` |
| POST | `/api/contracts/from-lead/:leadId` |
| POST | `/api/contracts` |
| PUT | `/api/contracts/:id` |
| POST | `/api/contracts/:id/sign-request` |
| GET | `/api/contracts/:id/signatures` |

## `/api/controladoria` · equipe · `src/routes/controladoria.ts`

| Método | Caminho |
|---|---|
| GET | `/api/controladoria/produtividade` |
| GET | `/api/controladoria/rentabilidade/clientes` |
| GET | `/api/controladoria/rentabilidade/processos` |
| GET | `/api/controladoria/centro-custo` |
| GET | `/api/controladoria/provisoes/resumo` |
| GET | `/api/controladoria/provisoes` |
| POST | `/api/controladoria/provisoes` |
| PUT | `/api/controladoria/provisoes/:id` |
| DELETE | `/api/controladoria/provisoes/:id` |

## `/api/correspondente` · equipe · `src/routes/correspondente.ts`

| Método | Caminho |
|---|---|
| GET | `/api/correspondente/summary` |
| GET | `/api/correspondente/solicitantes` |
| GET | `/api/correspondente` |
| POST | `/api/correspondente` |
| PUT | `/api/correspondente/:id` |
| PATCH | `/api/correspondente/:id/status` |
| DELETE | `/api/correspondente/:id` |
| GET | `/api/correspondente/agenda-pendencias` |
| POST | `/api/correspondente/agenda-pendencias/:eventId/cliente` |

## `/api/court-email-monitor` · equipe · `src/routes/courtEmailMonitor.ts`

| Método | Caminho |
|---|---|
| GET | `/api/court-email-monitor` |
| GET | `/api/court-email-monitor/auth-url` |
| POST | `/api/court-email-monitor/disconnect` |
| POST | `/api/court-email-monitor/scan-now` |

## `/api/dashboards/agenda` · equipe · `src/routes/dashboards/agenda.ts`

| Método | Caminho |
|---|---|
| GET | `/api/dashboards/agenda` |

## `/api/dashboards/cliente` · equipe · `src/routes/dashboards/cliente.ts`

| Método | Caminho |
|---|---|
| GET | `/api/dashboards/cliente/:clientId` |

## `/api/dashboards/cockpit` · equipe · `src/routes/dashboards/cockpit.ts`

| Método | Caminho |
|---|---|
| GET | `/api/dashboards/cockpit` |
| POST | `/api/dashboards/cockpit/resolver` |

## `/api/dashboards/comercial` · equipe · `src/routes/dashboards/comercial.ts`

| Método | Caminho |
|---|---|
| GET | `/api/dashboards/comercial` |
| POST | `/api/dashboards/comercial/gasto-marketing` |
| GET | `/api/dashboards/comercial/gasto-marketing` |
| GET | `/api/dashboards/comercial/custo-aquisicao` |

## `/api/dashboards/financeiro` · equipe · `src/routes/dashboards/financeiro.ts`

| Método | Caminho |
|---|---|
| GET | `/api/dashboards/financeiro/projecao-mes` |
| GET | `/api/dashboards/financeiro/previsao-ponderada` |
| GET | `/api/dashboards/financeiro` |

## `/api/dashboards/monitoramento` · equipe · `src/routes/dashboards/monitoramento.ts`

| Método | Caminho |
|---|---|
| GET | `/api/dashboards/monitoramento` |

## `/api/dashboards/parceria-mensal` · equipe · `src/routes/dashboards/parceriaMensal.ts`

| Método | Caminho |
|---|---|
| GET | `/api/dashboards/parceria-mensal` |

## `/api/dashboards/processual` · equipe · `src/routes/dashboards/processual.ts`

| Método | Caminho |
|---|---|
| GET | `/api/dashboards/processual` |

## `/api/dashboards/producao` · equipe · `src/routes/dashboards/producao.ts`

| Método | Caminho |
|---|---|
| GET | `/api/dashboards/producao` |

## `/api/dashboards/relatorio-mensal` · equipe · `src/routes/dashboards/relatorioMensal.ts`

| Método | Caminho |
|---|---|
| GET | `/api/dashboards/relatorio-mensal` |
| POST | `/api/dashboards/relatorio-mensal/enviar` |

## `/api/dashboards/resultados` · equipe · `src/routes/dashboards/resultados.ts`

| Método | Caminho |
|---|---|
| GET | `/api/dashboards/resultados` |

## `/api/dative` · equipe · `src/routes/dative.ts`

| Método | Caminho |
|---|---|
| GET | `/api/dative/summary` |
| GET | `/api/dative/cases` |
| GET | `/api/dative/a-receber-90d` |
| GET | `/api/dative/cases/:id` |
| POST | `/api/dative/cases/:id/extrair-ia` |
| POST | `/api/dative/cases/:id/relatos` |
| POST | `/api/dative/cases/:id/mover-esteira` |
| POST | `/api/dative/cases` |
| PUT | `/api/dative/cases/:id` |
| POST | `/api/dative/cases/:id/reject` |
| POST | `/api/dative/cases/:id/reject/revert` |
| DELETE | `/api/dative/cases/:id` |
| GET | `/api/dative/hearings` |
| POST | `/api/dative/hearings` |
| PUT | `/api/dative/hearings/:id` |
| PATCH | `/api/dative/hearings/:id/status` |
| PUT | `/api/dative/hearings/:id` |
| PATCH | `/api/dative/cases/:id/receber` |
| GET | `/api/dative/payments` |
| POST | `/api/dative/payments` |
| PUT | `/api/dative/payments/:id` |
| PATCH | `/api/dative/payments/:id/receive` |
| PUT | `/api/dative/payments/:id` |
| POST | `/api/dative/documentos/classificar` |

## `/api/deadlines` · equipe · `src/routes/deadlines.ts`

| Método | Caminho |
|---|---|
| GET | `/api/deadlines/calcular` |
| GET | `/api/deadlines` |
| POST | `/api/deadlines` |
| PUT | `/api/deadlines/:id` |
| PATCH | `/api/deadlines/:id/status` |

## `/api/documents` · equipe · `src/routes/documents.ts`

| Método | Caminho |
|---|---|
| GET | `/api/documents/templates` |
| POST | `/api/documents/templates` |
| PUT | `/api/documents/templates/:id` |
| DELETE | `/api/documents/templates/:id` |
| POST | `/api/documents/generate` |
| GET | `/api/documents` |
| GET | `/api/documents/:id` |
| POST | `/api/documents` |
| GET | `/api/documents/:id/file` |
| PUT | `/api/documents/:id` |
| DELETE | `/api/documents/:id` |
| POST | `/api/documents/:id/sign-request` |
| GET | `/api/documents/:id/signatures` |

## `/api/email-intake` · equipe · `src/routes/emailIntake.ts`

| Método | Caminho |
|---|---|
| GET | `/api/email-intake/integration` |
| GET | `/api/email-intake/integration/auth-url` |
| PUT | `/api/email-intake/integration` |
| POST | `/api/email-intake/integration/disconnect` |
| POST | `/api/email-intake/integration/diagnose` |
| POST | `/api/email-intake/integration/import-message` |
| POST | `/api/email-intake/integration/sync` |
| GET | `/api/email-intake` |
| POST | `/api/email-intake/parse` |
| PUT | `/api/email-intake/:id` |
| POST | `/api/email-intake/:id/confirm` |
| POST | `/api/email-intake/reprocess-drive/:caseId` |
| POST | `/api/email-intake/:id/discard` |

## `/api/erros` · logado · `src/routes/erros.ts`

| Método | Caminho |
|---|---|
| POST | `/api/erros` |
| GET | `/api/erros` (equipe) |
| POST | `/api/erros/:id/resolvido` (equipe) |

## `/api/escritorio` · equipe · `src/routes/escritorio.ts`

| Método | Caminho |
|---|---|
| GET | `/api/escritorio` |
| GET | `/api/escritorio/mural` |
| POST | `/api/escritorio/reuniao` |
| GET | `/api/escritorio/ficha-pendencias` |
| POST | `/api/escritorio/ficha-pendencias/:id/:acao` |
| POST | `/api/escritorio/ficha/:phone` |
| GET | `/api/escritorio/copiloto` |
| GET | `/api/escritorio/analista` |
| POST | `/api/escritorio/analista/:caseId` |
| GET | `/api/escritorio/agente/:id` |
| GET | `/api/escritorio/painel-ia` |

## `/api/financial` · equipe · `src/routes/financial.ts`

| Método | Caminho |
|---|---|
| GET | `/api/financial` |
| GET | `/api/financial/opcoes` |
| GET | `/api/financial/summary` |
| GET | `/api/financial/inteligencia` |
| POST | `/api/financial` |
| PATCH | `/api/financial/:id/pay` |
| GET | `/api/financial/asaas-config` |
| PUT | `/api/financial/asaas-config` |
| PUT | `/api/financial/:id` |
| GET | `/api/financial/installments` |
| GET | `/api/financial/a-receber` |
| GET | `/api/financial/parcerias/a-receber` |
| POST | `/api/financial/conciliar` |
| GET | `/api/financial/projecao` |
| GET | `/api/financial/dre` |
| GET | `/api/financial/receita-origem` |
| POST | `/api/financial/renegociar` |
| PATCH | `/api/financial/installments/:id/pay` |

## `/api/goals` · equipe · `src/routes/goals.ts`

| Método | Caminho |
|---|---|
| GET | `/api/goals/current` |
| PUT | `/api/goals/current` |

## `/api/hoje` · equipe · `src/routes/hoje.ts`

| Método | Caminho |
|---|---|
| GET | `/api/hoje` |

## `/api/inadimplencias` · equipe · `src/routes/inadimplencias.ts`

| Método | Caminho |
|---|---|
| GET | `/api/inadimplencias` |
| POST | `/api/inadimplencias/recalcular` |
| PATCH | `/api/inadimplencias/:id` |
| POST | `/api/inadimplencias/:id/resolver` |

## `/api/intakes` · equipe · `src/routes/intakes.ts`

| Método | Caminho |
|---|---|
| GET | `/api/intakes` |
| GET | `/api/intakes/:id` |
| POST | `/api/intakes` |
| PUT | `/api/intakes/:id` |
| POST | `/api/intakes/:id/convert-lead` |
| POST | `/api/intakes/:id/convert-client` |

## `/api/job-health` · equipe · `src/routes/jobHealth.ts`

| Método | Caminho |
|---|---|
| GET | `/api/job-health` |
| GET | `/api/job-health/:job` |

## `/api/journey` · equipe · `src/routes/journey.ts`

| Método | Caminho |
|---|---|
| GET | `/api/journey` |

## `/api/lawyers` · admin · `src/routes/lawyers.ts`

| Método | Caminho |
|---|---|
| GET | `/api/lawyers` |
| POST | `/api/lawyers` |
| PUT | `/api/lawyers/:id` |

## `/api/leads` · equipe · `src/routes/leads.ts`

| Método | Caminho |
|---|---|
| GET | `/api/leads/board` |
| GET | `/api/leads` |
| GET | `/api/leads/:id` |
| POST | `/api/leads` |
| PUT | `/api/leads/:id` |
| POST | `/api/leads/:id/contexto` |
| DELETE | `/api/leads/:id` |
| PATCH | `/api/leads/:id/status` |
| POST | `/api/leads/:id/mark-response` |
| POST | `/api/leads/:id/convert-client` |

## `/api/leis` · equipe · `src/routes/leis.ts`

| Método | Caminho |
|---|---|
| GET | `/api/leis/estado` |
| GET | `/api/leis/buscar` |
| GET | `/api/leis/atalhos` |
| GET | `/api/leis/norma/:id` |
| GET | `/api/leis/dispositivo/:id` |
| POST | `/api/leis/conferir` |
| POST | `/api/leis/fundamentos` |
| POST | `/api/leis/atualizar` |

## `/api/me` · equipe · `src/routes/me.ts`

| Método | Caminho |
|---|---|
| GET | `/api/me/2fa` |
| POST | `/api/me/2fa/setup` |
| POST | `/api/me/2fa/enable` |
| POST | `/api/me/2fa/disable` |
| GET | `/api/me/cases` |
| GET | `/api/me/repasses` |

## `/api/mesa` · equipe · `src/routes/mesa.ts`

| Método | Caminho |
|---|---|
| GET | `/api/mesa/sugestoes-juncao` |
| POST | `/api/mesa/juntar` |
| POST | `/api/mesa/:caseId/separar` |
| GET | `/api/mesa/:caseId/contratos` |
| POST | `/api/mesa/:caseId/contratos/levantar` |
| PUT | `/api/mesa/contrato/:id` |
| GET | `/api/mesa/:caseId` |
| POST | `/api/mesa/:caseId/analisar` |
| GET | `/api/mesa/documento/:id` |
| POST | `/api/mesa/documento/:id/edicao` |
| POST | `/api/mesa/documento/:id/final` |
| GET | `/api/mesa/documento/:id/comparar` |
| POST | `/api/mesa/documento/:id/aprender` |
| POST | `/api/mesa/:caseId/revisar` |
| POST | `/api/mesa/licao/:id` |

## `/api/metrics` · equipe · `src/routes/metrics.ts`

| Método | Caminho |
|---|---|
| GET | `/api/metrics/series` |

## `/api/notifications` · logado · `src/routes/notifications.ts`

| Método | Caminho |
|---|---|
| GET | `/api/notifications` |
| GET | `/api/notifications/count` |
| POST | `/api/notifications/check` |
| PATCH | `/api/notifications/:id/read` |
| PATCH | `/api/notifications/read-all` |
| GET | `/api/notifications/settings` |
| PUT | `/api/notifications/settings` |
| GET | `/api/notifications/telegram` |
| PUT | `/api/notifications/telegram` |
| GET | `/api/notifications/whatsapp` |
| PUT | `/api/notifications/whatsapp` |
| POST | `/api/notifications/telegram/test` |

## `/api/office-settings` · admin · `src/routes/office-settings.ts`

| Método | Caminho |
|---|---|
| GET | `/api/office-settings` |
| PATCH | `/api/office-settings` |

## `/api/parcelas` · equipe · `src/routes/parcelas.ts`

| Método | Caminho |
|---|---|
| GET | `/api/parcelas` |
| GET | `/api/parcelas/receita/:receitaId/totais` |
| GET | `/api/parcelas/:id` |
| POST | `/api/parcelas` |
| POST | `/api/parcelas/gerar` |
| PUT | `/api/parcelas/:id` |
| POST | `/api/parcelas/:id/pagar` |
| DELETE | `/api/parcelas/:id` |

## `/api/partner-portal` · logado · `src/routes/partner-portal.ts`

| Método | Caminho |
|---|---|
| GET | `/api/partner-portal/me` |
| GET | `/api/partner-portal/cases` |
| GET | `/api/partner-portal/rejected` |
| GET | `/api/partner-portal/cases/:id` |
| GET | `/api/partner-portal/financial` |
| GET | `/api/partner-portal/entradas` |
| GET | `/api/partner-portal/timeline` |
| GET | `/api/partner-portal/clients` |
| GET | `/api/partner-portal/agenda` |

## `/api/partners` · equipe · `src/routes/partners.ts`

| Método | Caminho |
|---|---|
| GET | `/api/partners` |
| POST | `/api/partners` |
| PUT | `/api/partners/:id` |
| POST | `/api/partners/:id/cases` |
| GET | `/api/partners/:id/cases` |
| POST | `/api/partners/cases/:caseId/resultado` |

## `/api/payments` · equipe · `src/routes/payments.ts`

| Método | Caminho |
|---|---|
| GET | `/api/payments` |
| POST | `/api/payments/:id/confirmar` |
| POST | `/api/payments/:id/recusar` |

## `/api/peca-modelos` · equipe · `src/routes/pecaModelos.ts`

| Método | Caminho |
|---|---|
| GET | `/api/peca-modelos` |
| GET | `/api/peca-modelos/resumo` |
| GET | `/api/peca-modelos/:id` |
| POST | `/api/peca-modelos/import` |
| POST | `/api/peca-modelos/import-ficha` |

## `/api/phonebook` · equipe · `src/routes/phonebook.ts`

| Método | Caminho |
|---|---|
| GET | `/api/phonebook` |
| POST | `/api/phonebook` |
| PUT | `/api/phonebook/:id` |
| DELETE | `/api/phonebook/:id` |

## `/api/portal` · logado · `src/routes/portal.ts`

| Método | Caminho |
|---|---|
| GET | `/api/portal/me` |
| PUT | `/api/portal/me` |
| GET | `/api/portal/cases` |
| GET | `/api/portal/timeline` |
| GET | `/api/portal/cases/:id` |
| GET | `/api/portal/financial` |
| GET | `/api/portal/documents` |
| GET | `/api/portal/checklist` |
| POST | `/api/portal/cases/:id/documentos` |
| GET | `/api/portal/assinaturas` |
| GET | `/api/portal/mensagens` |
| POST | `/api/portal/mensagens` |
| GET | `/api/portal/contact` |
| GET | `/api/portal/pix/:installmentId` |
| POST | `/api/portal/installments/:id/pagar` |

## `/api/prazos-detectados` · equipe · `src/routes/detected-deadlines.ts`

| Método | Caminho |
|---|---|
| POST | `/api/prazos-detectados/:id/minuta` |
| GET | `/api/prazos-detectados` |
| GET | `/api/prazos-detectados/count` |
| POST | `/api/prazos-detectados/:id/confirmar` |
| GET | `/api/prazos-detectados/mutirao` |
| POST | `/api/prazos-detectados/lote` |
| DELETE | `/api/prazos-detectados/antigos` |
| POST | `/api/prazos-detectados/:id/descartar` |

## `/api/processes` · equipe · `src/routes/processes.ts`

| Método | Caminho |
|---|---|
| GET | `/api/processes/tribunais` |
| GET | `/api/processes` |
| GET | `/api/processes/duplicados` |
| POST | `/api/processes/duplicados/:digitos/unir` |
| GET | `/api/processes/revisar-clientes` |
| POST | `/api/processes/:id/trocar-cliente` |
| POST | `/api/processes/:id/cliente-conferido` |
| GET | `/api/processes/:id` |
| POST | `/api/processes` |
| PUT | `/api/processes/:id` |
| POST | `/api/processes/:id/sync` |
| POST | `/api/processes/descobrir-oab` |
| PATCH | `/api/processes/:id/phase` |
| POST | `/api/processes/importar-esteira` |
| POST | `/api/processes/ingest-djen` |
| POST | `/api/processes/:id/movements` |

## `/api/propostas` · equipe · `src/routes/propostas.ts`

| Método | Caminho |
|---|---|
| GET | `/api/propostas` |
| GET | `/api/propostas/:id` |
| POST | `/api/propostas` |
| DELETE | `/api/propostas/:id` |
| PUT | `/api/propostas/:id` |
| PATCH | `/api/propostas/:id/status` |
| POST | `/api/propostas/:id/accept` |
| POST | `/api/propostas/:id/share` |
| POST | `/api/propostas/:id/send-email` |

## `/api/public` · público · `src/routes/sign-public.ts`

| Método | Caminho |
|---|---|
| GET | `/api/public/sign/:token` |
| POST | `/api/public/sign/:token` |
| GET | `/api/public/verify/:code` |

## `/api/public` · público · `src/routes/propostas-public.ts`

| Método | Caminho |
|---|---|
| GET | `/api/public/proposta/:token` |
| POST | `/api/public/proposta/:token/visita` |
| POST | `/api/public/proposta/:token/visita/:chave/sinal` |
| POST | `/api/public/proposta/:token/aceitar` |

## `/api/public` · público · `src/routes/lead-public.ts`

| Método | Caminho |
|---|---|
| POST | `/api/public/lead` |
| POST | `/api/public/newsletter` |

## `/api/public` · público · `src/routes/agenda-public.ts`

| Método | Caminho |
|---|---|
| GET | `/api/public/agenda/slots` |
| POST | `/api/public/agenda/agendar` |

## `/api/public` · público · `src/routes/whatsapp-webhook.ts`

| Método | Caminho |
|---|---|
| POST | `/api/public/uazapi-webhook` |

## `/api/public` · público · `src/routes/asaas-webhook.ts`

| Método | Caminho |
|---|---|
| POST | `/api/public/asaas-webhook` |

## `/api/push` · logado · `src/routes/push.ts`

| Método | Caminho |
|---|---|
| GET | `/api/push/vapid-public` |
| POST | `/api/push/subscribe` |
| POST | `/api/push/unsubscribe` |

## `/api/receitas` · equipe · `src/routes/receitas.ts`

| Método | Caminho |
|---|---|
| GET | `/api/receitas` |
| GET | `/api/receitas/cliente/:clientId/totais` |
| GET | `/api/receitas/:id` |
| POST | `/api/receitas/recebimento` |
| POST | `/api/receitas` |
| PUT | `/api/receitas/:id` |
| POST | `/api/receitas/:id/cancelar` |

## `/api/repasses` · equipe · `src/routes/repasses.ts`

| Método | Caminho |
|---|---|
| GET | `/api/repasses` |
| GET | `/api/repasses/:id` |
| POST | `/api/repasses` |
| PUT | `/api/repasses/:id` |
| POST | `/api/repasses/:id/repassar` |
| POST | `/api/repasses/:id/cancelar` |
| DELETE | `/api/repasses/:id` |

## `/api/retention` · admin · `src/routes/retention.ts`

| Método | Caminho |
|---|---|
| GET | `/api/retention/preview` |
| GET | `/api/retention/politicas` |
| POST | `/api/retention/run` |
| GET | `/api/retention/historico` |

## `/api/security` · admin · `src/routes/securityStatus.ts`

| Método | Caminho |
|---|---|
| GET | `/api/security/status` |

## `/api/tasks` · equipe · `src/routes/tasks.ts`

| Método | Caminho |
|---|---|
| GET | `/api/tasks` |
| POST | `/api/tasks` |
| PUT | `/api/tasks/:id` |
| PATCH | `/api/tasks/:id/status` |

## `/api/users` · admin · `src/routes/users.ts`

| Método | Caminho |
|---|---|
| GET | `/api/users` |
| POST | `/api/users` |
| PUT | `/api/users/:id` |
| POST | `/api/users/:id/reset-password` |

## `/api/whatsapp-queue` · equipe + WhatsApp · `src/routes/whatsapp-queue.ts`

| Método | Caminho |
|---|---|
| GET | `/api/whatsapp-queue` |
| POST | `/api/whatsapp-queue` |
| POST | `/api/whatsapp-queue/gerar` |
| POST | `/api/whatsapp-queue/:id/enviada` |
| POST | `/api/whatsapp-queue/:id/descartar` |

