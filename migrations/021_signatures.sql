-- ============================================================
-- Migration 021 — Assinatura eletrônica própria (Fase 3b)
-- Assinatura desenhada na tela + CPF + hash do documento + auditoria.
-- Validade: assinatura eletrônica simples/avançada (Lei 14.063/2020,
-- MP 2.200-2/2001 art.10 §2º) — a prova vem do conjunto de evidências.
-- ============================================================

CREATE TABLE IF NOT EXISTS signature_requests (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_id       INT UNSIGNED NOT NULL,
  token             CHAR(36)     NOT NULL,          -- link público de assinatura
  verification_code VARCHAR(16)  NOT NULL,          -- código público de validação
  signer_name       VARCHAR(255) NULL,
  signer_cpf        VARCHAR(20)  NULL,
  status            ENUM('pendente','assinado','cancelado') NOT NULL DEFAULT 'pendente',
  doc_hash          CHAR(64)     NULL,              -- SHA-256 do conteúdo no momento da assinatura
  signature_image   LONGTEXT     NULL,              -- PNG base64 da assinatura manuscrita
  signed_at         DATETIME     NULL,
  signer_ip         VARCHAR(45)  NULL,
  signer_ua         VARCHAR(500) NULL,
  created_by        INT UNSIGNED NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_sig_token (token),
  INDEX idx_sig_doc  (document_id),
  INDEX idx_sig_code (verification_code),

  CONSTRAINT fk_sig_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
