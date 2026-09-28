-- ============================================================
-- Migration 136 — Corrige court_alias gravado com TRF/TRT trocados
-- Bug achado pelos testes da ideia 8 (auditoria de Processos e prazos,
-- 28/09/2026): aliasFromProcessNumber tratava J=5 como federal e J=4
-- como trabalhista, o contrario da Res. CNJ 65 (4=Federal, 5=Trabalho).
-- Processos descobertos pelo DJEN ficaram com alias errado (ex.: processo
-- do TRT17 gravado como api_publica_trf17, que nao existe) e a consulta
-- ao DataJud nao encontrava nada. Recalcula so as linhas afetadas.
-- IMPORTANTE: o runner divide por ';' e remove linhas iniciadas por '--',
-- entao nenhum conteudo abaixo contem ';' fora do fim de cada comando.
-- ============================================================

UPDATE legal_processes
   SET court_alias = CONCAT('api_publica_trt', CAST(SUBSTRING(REPLACE(REPLACE(REPLACE(process_number, '.', ''), '-', ''), ' ', ''), 15, 2) AS UNSIGNED))
 WHERE court_alias LIKE 'api_publica_trf%'
   AND SUBSTRING(REPLACE(REPLACE(REPLACE(process_number, '.', ''), '-', ''), ' ', ''), 14, 1) = '5';

UPDATE legal_processes
   SET court_alias = CONCAT('api_publica_trf', CAST(SUBSTRING(REPLACE(REPLACE(REPLACE(process_number, '.', ''), '-', ''), ' ', ''), 15, 2) AS UNSIGNED))
 WHERE court_alias LIKE 'api_publica_trt%'
   AND SUBSTRING(REPLACE(REPLACE(REPLACE(process_number, '.', ''), '-', ''), ' ', ''), 14, 1) = '4'
