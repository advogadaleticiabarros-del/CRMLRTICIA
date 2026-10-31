-- Índices com 6 casas decimais (31/10/2026). A Taxa Legal do Bacen (art. 406 do Código
-- Civil, série SGS 29543) é publicada com 6 casas (ex.: 0,676227% em 09/2024); com
-- DECIMAL(10,4) ela seria arredondada e os juros da planilha sairiam errados.
-- Só aumenta a precisão: os valores já guardados (4 casas) não mudam.
ALTER TABLE indices_economicos MODIFY valor DECIMAL(12,6) NOT NULL;
