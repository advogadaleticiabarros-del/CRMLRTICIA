-- Rastreador de erros do próprio CRM (servidor e tela), no lugar do Sentry.
-- Uma linha por falha (assinatura); repetições só somam em "vezes".
-- Mensagem e detalhe já chegam com CPF, telefone, e-mail e processo mascarados.
CREATE TABLE IF NOT EXISTS erros_sistema (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assinatura  CHAR(40)     NOT NULL,
  origem      VARCHAR(10)  NOT NULL,
  mensagem    VARCHAR(500) NOT NULL,
  local       VARCHAR(255) NULL,
  detalhe     TEXT         NULL,
  usuario     VARCHAR(120) NULL,
  vezes       INT UNSIGNED NOT NULL DEFAULT 1,
  primeiro_em DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_em   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  avisado_em  DATETIME     NULL,
  resolvido   TINYINT(1)   NOT NULL DEFAULT 0,
  UNIQUE KEY uq_erro_assinatura (assinatura),
  INDEX idx_erro_ultimo (resolvido, ultimo_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
