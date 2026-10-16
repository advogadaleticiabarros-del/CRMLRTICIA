-- Ficha automática: o que o lead/cliente manda no WhatsApp vira cadastro.
-- ficha_pendencias: o que NÃO foi gravado sozinho (cadastro já tinha outro
--   valor, leitura incerta, CPF inválido) e espera a equipe aplicar ou ignorar.
-- ficha_varredura: até onde as mensagens de cada telefone já foram lidas, para
--   a rotina de meia em meia hora não pagar a IA de novo à toa.
CREATE TABLE IF NOT EXISTS ficha_pendencias (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  phone       VARCHAR(30)  NOT NULL,
  alvo        VARCHAR(10)  NOT NULL,
  alvo_id     INT UNSIGNED NOT NULL,
  nome        VARCHAR(255) NULL,
  campo       VARCHAR(30)  NOT NULL,
  valor_atual VARCHAR(255) NULL,
  sugerido    VARCHAR(255) NOT NULL,
  fontes      VARCHAR(500) NULL,
  motivo      VARCHAR(200) NOT NULL,
  status      VARCHAR(12)  NOT NULL DEFAULT 'pendente',
  decidido_por VARCHAR(120) NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ficha_pend (alvo, alvo_id, campo, sugerido),
  INDEX idx_ficha_pend_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ficha_varredura (
  phone_fim8  CHAR(8)      NOT NULL PRIMARY KEY,
  ultima_msg  DATETIME     NULL,
  atualizado_em DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
