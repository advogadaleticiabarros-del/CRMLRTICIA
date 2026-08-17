-- Adiciona status 'newsletter' aos leads — usado para assinantes do
-- "Jornal da Semana" (formulário do blog: nome + e-mail + WhatsApp opcional).
-- Como 'newsletter' não entra em ACTIVE_STATUSES (src/routes/leads.ts),
-- esses contatos ficam automaticamente fora do Kanban de triagem/conversão,
-- sem precisar mexer no board — só aparecem na lista/aba separada.
ALTER TABLE leads MODIFY COLUMN status
  ENUM('triagem','atendimento_inicial','reuniao','documentacao_pendente',
       'proposta','proposta_em_analise','contrato_assinado','fechada','convertido','perdida',
       'newsletter')
  NOT NULL DEFAULT 'triagem';
