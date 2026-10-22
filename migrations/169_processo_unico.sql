-- Um processo para vários pedidos (22/10/2026, regra da Jessica): pedidos do
-- mesmo cliente contra o mesmo banco e da mesma família de tese (cartão
-- consignado; empréstimo consignado; empréstimo pessoal; cartão comum) viram
-- UM processo quando a Dra. confirma. O pedido unido aponta para o caso
-- principal, some do quadro e segue a etapa dele. Coluna nova e nula.
ALTER TABLE cases
  ADD COLUMN unido_ao_caso INT UNSIGNED NULL,
  ADD INDEX idx_cases_unido (unido_ao_caso);
