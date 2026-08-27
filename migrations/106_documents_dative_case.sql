-- Vincula documentos do GED a uma demanda dativa específica (nomeação,
-- certidão de audiência, comprovante de atuação) — usado para reunir a prova
-- documental necessária pra solicitar o pagamento ao Estado. Opcional: um
-- documento pode continuar existindo só com client_id/case_id, como hoje.
-- Ver docs/superpowers/specs/2026-08-27-dativo-documentos-design.md
ALTER TABLE documents
  ADD COLUMN dative_case_id INT UNSIGNED NULL,
  ADD INDEX idx_documents_dative_case (dative_case_id),
  ADD CONSTRAINT fk_documents_dative_case
    FOREIGN KEY (dative_case_id) REFERENCES dative_cases(id) ON DELETE SET NULL;
