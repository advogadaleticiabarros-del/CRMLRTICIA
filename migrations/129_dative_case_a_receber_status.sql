-- ============================================================
-- Migration 129 — Status "A receber" nos casos dativos
-- Cobre honorarios ja arbitrados (decisao judicial) e cujo
-- procedimento de recebimento ja foi aberto, mas que ainda nao
-- caíram na conta — normalmente leva de 60 a 90 dias entre abrir
-- o procedimento e o pagamento efetivo. Antes so existia "concluida"
-- (o processo/ato terminou) e "paga" (o dinheiro ja entrou), sem
-- nada pro meio do caminho — pedido explicito da usuaria.
-- Fica entre concluida e paga na ordem natural do fluxo:
-- nomeada -> em_andamento -> concluida -> a_receber -> paga.
-- IMPORTANTE: o runner divide por ';' e remove linhas iniciadas por '--',
-- entao nenhum conteudo abaixo contem ';' nem linha comecando com '--'.
-- ============================================================

ALTER TABLE dative_cases
  MODIFY COLUMN status ENUM('nomeada','em_andamento','concluida','a_receber','paga') NOT NULL DEFAULT 'nomeada'
