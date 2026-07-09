-- ============================================================
-- Migration 065 — Mensagens prontas do WhatsApp (jurídico)
-- Modelos com {{nome}} substituído pelo primeiro nome do contato.
-- Vêm 6 modelos de fábrica; o escritório cria/apaga os seus.
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title      VARCHAR(120) NOT NULL,
  body       TEXT         NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO whatsapp_templates (title, body) VALUES
('Pedido de documentos', 'Olá, {{nome}}! Para darmos andamento ao seu caso, precisamos dos seguintes documentos: RG ou CNH, CPF e comprovante de residência. Pode enviar as fotos por aqui mesmo. Qualquer dúvida, estou à disposição. — Advocacia Letícia Barros'),
('Envio de procuração', 'Olá, {{nome}}! Segue a procuração para assinatura. Você pode imprimir, assinar e enviar a foto por aqui, ou assinar eletronicamente pelo link que enviamos ao seu e-mail. Assim que recebermos, seguimos com o protocolo. — Advocacia Letícia Barros'),
('Atualização do processo', 'Olá, {{nome}}! Passando para atualizar você sobre o seu processo: houve movimentação e estamos acompanhando de perto. Assim que houver decisão ou próximo passo, aviso por aqui. Você também pode acompanhar pelo portal: https://crm.advogadaleticiabarros.com.br — Advocacia Letícia Barros'),
('Cobrança de honorários', 'Olá, {{nome}}! Tudo bem? Passando para lembrar da parcela dos honorários em aberto. Para facilitar, você pode pagar com Pix pelo portal: https://crm.advogadaleticiabarros.com.br — se já pagou, desconsidere e nos avise. Obrigada! — Advocacia Letícia Barros'),
('Aviso de audiência', 'Olá, {{nome}}! Lembrete importante: sua audiência está marcada. Chegue com 30 minutos de antecedência (ou entre no link 15 minutos antes, se for online) e leve documento com foto. Qualquer dúvida, me chame por aqui. — Advocacia Letícia Barros'),
('Confirmação de reunião', 'Olá, {{nome}}! Confirmando nossa reunião. Se precisar remarcar, é só avisar por aqui com antecedência. Até lá! — Advocacia Letícia Barros')
