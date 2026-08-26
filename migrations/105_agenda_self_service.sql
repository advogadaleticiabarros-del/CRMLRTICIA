-- Chaves de configuração do agendamento self-service em office_settings
-- (tabela key-value já existente — sem tabela nova). Insere os defaults do
-- spec desde já, para que GET /api/office-settings nunca precise cair no
-- fallback de string vazia antes da primeira gravação manual pela tela de
-- Configurações. agenda_self_service_ativo começa desligado ('0') — feature
-- existe no código mas fica inerte até a usuária ativar conscientemente.
INSERT INTO office_settings (setting_key, setting_value) VALUES
  ('agenda_dias_semana', '1,2,3,4,5'),
  ('agenda_hora_inicio', '09:00'),
  ('agenda_hora_fim', '18:00'),
  ('agenda_duracao_consulta_min', '60'),
  ('agenda_self_service_ativo', '0')
ON DUPLICATE KEY UPDATE setting_key = setting_key;
