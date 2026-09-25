-- ============================================================
-- Migration 135 — Status "Aguardando liberacao do requerimento" (dativo)
-- Pedido da Dra. Leticia (25/09/2026): faltava um status pro meio do
-- caminho entre "concluida" (a nomeacao/ato terminou, o honorario pode
-- ou nao ja ter sido arbitrado) e "a_receber" (o procedimento de
-- recebimento JA foi aberto, dinheiro so nao caiu ainda). Antes disso
-- nao tinha como sinalizar "terminei, mas ainda nao posso nem pedir o
-- pagamento porque o requerimento ainda nao foi registrado".
-- Fica assim na ordem natural do fluxo:
-- nomeada -> em_andamento -> concluida -> aguardando_liberacao_requerimento
-- -> a_receber -> paga.
-- IMPORTANTE: o runner divide por ';' e remove linhas iniciadas por '--',
-- entao nenhum conteudo abaixo contem ';' nem linha comecando com '--'.
-- ============================================================

ALTER TABLE dative_cases
  MODIFY COLUMN status ENUM('nomeada','em_andamento','concluida','aguardando_liberacao_requerimento','a_receber','paga','recusada') NOT NULL DEFAULT 'nomeada'
