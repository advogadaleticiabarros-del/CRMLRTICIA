-- ============================================================
-- Migration 121 — Passkeys (WebAuthn / Face ID) como entrada alternativa
-- Item 5 do plano de autenticacao biometrica no iPhone (PWA).
-- Cada linha guarda UMA credencial WebAuthn cadastrada pela usuaria em UM
-- aparelho (ex.: iPhone com Face ID). Uma mesma pessoa pode ter varias
-- linhas (varios aparelhos). credential_id e o identificador unico que o
-- navegador/autenticador manda de volta a cada login e public_key e a
-- chave publica usada para conferir a assinatura - nunca guardamos nada
-- do Face ID em si, ele nunca sai do aparelho da usuaria.
-- counter e o contador anti-replay exigido pelo protocolo WebAuthn: a
-- cada login o valor novo tem que ser MAIOR que o salvo, senao e sinal
-- de credencial clonada e o login deve ser recusado.
-- device_name e livre (ex. Iphone da Leticia) so para a usuaria
-- reconhecer qual aparelho e qual se cadastrar mais de um.
-- IMPORTANTE: o runner divide por ';' e remove linhas iniciadas por '--',
-- entao nenhum conteudo abaixo contem ';' nem linha comecando com '--'.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_passkeys (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id        INT UNSIGNED NOT NULL,
  credential_id  VARCHAR(255) NOT NULL,
  public_key     TEXT NOT NULL,
  counter        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  device_name    VARCHAR(120) NULL,
  transports     VARCHAR(120) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at   DATETIME NULL,
  UNIQUE KEY uq_user_passkeys_credential_id (credential_id),
  KEY idx_user_passkeys_user_id (user_id),
  CONSTRAINT fk_user_passkeys_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
