-- Atendente responsável por cada conversa de WhatsApp — atribuição manual
-- (não é fila automática de distribuição), na mesma lógica de organização
-- que já existe hoje pro Kanban de etapas (whatsapp_stages). Permite filtrar
-- "Meus atendimentos" na tela de Conversas.
ALTER TABLE whatsapp_chat_meta
  ADD COLUMN assigned_user_id INT UNSIGNED NULL,
  ADD CONSTRAINT fk_wcm_assigned_user
    FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL;
