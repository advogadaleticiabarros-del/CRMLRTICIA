-- ============================================================
-- Migration 132 — Remove a tabela orfa whatsapp_templates
-- Achado na auditoria de fluxos do WhatsApp (22/09/2026): CRUD proprio
-- (GET/POST/PUT/DELETE /api/whatsapp-instance/templates) que nunca foi
-- chamado de lugar nenhum da tela — o unico jeito de usar resposta pronta
-- sempre foi a lista da Uazapi (/quickreplies), que fica sincronizada com
-- o proprio app oficial do WhatsApp Business. As 7 linhas que existiam
-- (criadas por script/teste direto na API, nunca por uma tela) tinham 4
-- conteudos uteis sem equivalente na lista da Uazapi (procuracao,
-- audiencia, reuniao, pensao) — ja migrados pra la (atalhos /procuracao,
-- /audiencia, /reuniao, /pensaodocumentos) antes desta migration rodar.
-- ============================================================

DROP TABLE IF EXISTS whatsapp_templates
