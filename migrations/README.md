# Migrations — convenções

- **Numeração sequencial** (`NNN_nome.sql`). Antes de criar uma nova, confira o **maior número existente** (`ls migrations | sort | tail`) — sessões paralelas já criaram duplicatas.
- O runner (`npm run migrate` / `migrate:dev`) registra **pelo nome do arquivo**: nunca renomeie uma migration já aplicada em produção (ela rodaria de novo).
- Idempotência: prefira `CREATE TABLE IF NOT EXISTS`; para `ALTER TABLE ADD COLUMN` (que falha se repetido), confie na numeração única.

## Duplicatas conhecidas (já aplicadas — NÃO renomear)

| Arquivos | Situação |
|---|---|
| `055_installments_user_id.sql` e `055_role_parceiro_portal.sql` | Números repetidos por sessões paralelas; ambos aplicados. Inofensivo. |
| `055_role_parceiro_portal.sql` e `056_parceiro_portal_role.sql` | Fazem o MESMO `ALTER ... MODIFY role ENUM(...)`. `MODIFY` é idempotente — a segunda só re-aplica o mesmo estado. Inofensivo. |

Próximo número livre a partir de **059**.

## Tabelas/serviços DESATIVADOS (não apagar sem confirmar antes)

- `whatsapp_conversations`, `whatsapp_messages_legacy_inbox`, `whatsapp_tags`,
  `whatsapp_conversation_tags`, `whatsapp_internal_notes` (criadas em
  `012_*.sql`) — inbox antigo, nunca usado em produção. A tela de WhatsApp
  atual usa `whatsapp_messages`/`whatsapp_media`/`whatsapp_chat_meta`
  (`061_*.sql` em diante). Essas ficaram órfãs no banco.
- `src/services/WhatsAppNotificationService.ts` + tabela `whatsapp_settings`
  (`007_whatsapp_settings.sql`) — integração alternativa com a WhatsApp Cloud
  API (Meta) oficial, preparada mas nunca ligada a nenhuma rota. O canal
  ativo hoje é a Uazapi (`src/services/uazapiInstance.ts`).
