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
