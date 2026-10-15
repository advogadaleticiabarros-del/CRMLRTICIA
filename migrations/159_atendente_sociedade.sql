-- Dra. Lívia (atendente do WhatsApp) e sociedade dos agentes.
-- atendente_rascunhos: respostas que a Lívia preparou; a equipe envia, edita
--   ou descarta (modo rascunho). A edição vira memória dela.
-- agente_conversas: conversas entre agentes nascidas de ações reais
--   (ref = agente_acoes.id, uma conversa por ação).
-- agente_reunioes: reunião diária da equipe (ata, falas, ideias).
-- agente_memorias: o que cada agente aprendeu (correções da Dra., reuniões).
CREATE TABLE IF NOT EXISTS atendente_rascunhos (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  phone            VARCHAR(30)  NOT NULL,
  client_id        INT UNSIGNED NULL,
  nome             VARCHAR(255) NULL,
  mensagem_cliente TEXT         NOT NULL,
  resposta         TEXT         NOT NULL,
  intencao         VARCHAR(20)  NOT NULL DEFAULT 'outro',
  area             VARCHAR(40)  NULL,
  urgente          TINYINT(1)   NOT NULL DEFAULT 0,
  motivo_urgencia  VARCHAR(500) NULL,
  encaminhar       VARCHAR(20)  NULL,
  alertas          JSON         NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'pendente',
  resposta_final   TEXT         NULL,
  decidido_por     VARCHAR(120) NULL,
  decidido_em      DATETIME     NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ar_status (status, created_at),
  INDEX idx_ar_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agente_conversas (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  de          VARCHAR(40)  NOT NULL,
  para        VARCHAR(40)  NOT NULL,
  tema        VARCHAR(120) NOT NULL,
  falas       JSON         NOT NULL,
  ref         INT UNSIGNED NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_conversa_ref (ref),
  INDEX idx_ac_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agente_reunioes (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dia         DATE         NOT NULL,
  ata         TEXT         NOT NULL,
  falas       JSON         NOT NULL,
  ideias      JSON         NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reuniao_dia (dia)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agente_memorias (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agente      VARCHAR(40)  NOT NULL,
  tipo        VARCHAR(20)  NOT NULL DEFAULT 'aprendizado',
  texto       VARCHAR(600) NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_am_agente (agente, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
