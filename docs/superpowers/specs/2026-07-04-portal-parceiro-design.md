# Portal do Parceiro + cadastro de parceiros — Design

**Data:** 2026-07-04 · **Status:** aprovado (brainstorming)

## Objetivo
Permitir cadastrar novos parceiros pela tela e dar a cada parceiro um **portal de
acompanhamento (somente leitura)** dos casos que ele indicou: produção + SLA, número
do processo, movimentações, financeiro (valor/pagamento dos processos + repasses dele)
e ficha do cliente — **sem** o contato do cliente.

## Decisões (brainstorming)
1. Parceiro = empresa que indica clientes (tabela `partners`, ex.: INFINITY LAW). Casos têm `partner_id`.
2. **Cadastro de parceiros:** falta só o formulário no frontend (backend `POST/PUT /api/partners` já existe).
3. **Login do parceiro:** `users.partner_id` + papel **`parceiro_portal`**; escopo por `partner_id`.
4. **View-only:** o parceiro NÃO marca pagamentos/repasses. Quem dá baixa é o escritório.
5. **Ficha do cliente:** visível ao parceiro, mas **sem telefone/e-mail** do cliente.
6. Parceiro vê: etapa de produção + **SLA 10 dias**, **case_number** (após protocolo), movimentações,
   valor/pagamento das parcelas do processo, e os **repasses** dele (a receber/recebidos).

## Modelo de dados
- `migration 054`: `ALTER TABLE users ADD COLUMN partner_id INT UNSIGNED NULL;`
- Sem mais schema (usa `cases.partner_id`, `repasses`, `installments`, `case_movements`).

## Auth / papel
- Novo papel `parceiro_portal`. Ajustar `middleware/auth.ts`: `requireStaff`/`requireAdmin` devem
  bloquear `parceiro_portal` (como já bloqueiam `cliente`). O papel só acessa `/api/partner-portal/*`.
- Middleware `loadPartnerId`: lê `users.partner_id`; 403 se não vinculado.

## Backend — `src/routes/partner-portal.ts` (authenticate + loadPartnerId)
- `GET /me` — nome do parceiro + resumo (nº casos ativos, repasse a receber, repasse recebido).
- `GET /cases` — casos `WHERE partner_id = ?` com `production_stage`, `sla_days` (DATEDIFF), `case_number`, receita e repasse (SUM repasses do caso).
- `GET /cases/:id` — só se `partner_id` do caso == o do parceiro. Retorna: ficha do cliente **sem contato**
  (nome, área, status, resumo), movimentações (`case_movements`), e financeiro do processo
  (`installments`: número, valor, vencimento, status) + repasses do caso.
- `GET /financial` — repasses do parceiro (todos os casos dele) com status; e valor por processo.

## Frontend
- **Cadastro (admin):** botão "+ Novo parceiro" na tela Parcerias → form (nome, % êxito, split, sucumbência, entrada single/double, entry_split, obs). Usa `POST /api/partners`; editar usa `PUT`.
- **Usuário do parceiro (admin):** no cadastro de usuário, quando papel = `parceiro_portal`, escolher o `partner_id` (select de parceiros). Backend de users aceita `partner_id`.
- **Portal do parceiro (papel `parceiro_portal`):**
  - Nav própria: "Meus indicados" + "Financeiro".
  - Meus indicados: cartão por caso com etapa+SLA, nº processo, receita/repasse; "Ver detalhes".
  - Detalhe: ficha do cliente (sem contato) + etapas + movimentações + parcelas do processo.
  - Financeiro: repasses (a receber/recebidos) + valor de cada processo. Somente leitura.
  - Visual do sistema (navy+dourado, responsivo, temas).

## Segurança
- Toda rota filtra por `partner_id`; caso de outro parceiro → 404.
- Contato do cliente nunca é enviado ao portal do parceiro.

## Testes / QA
- Manual: criar parceiro; criar usuário `parceiro_portal` vinculado; logar como parceiro;
  ver só os casos daquele parceiro; confirmar que telefone/e-mail do cliente não aparecem;
  confirmar que não há botões de baixa (view-only).

## Fora de escopo (YAGNI)
- Parceiro marcar recebimento (é do escritório). Documentos ao parceiro. Mercado Pago.
