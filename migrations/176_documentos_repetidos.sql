-- Documentos repetidos do cliente (31/10/2026, caso do Valmirio: o mesmo arquivo da pasta
-- do Drive entrava uma vez em cada ação e as cópias "(2)", "(3)" também entravam).
-- drive_md5: conteúdo do arquivo do Drive (md5Checksum), para reconhecer cópias com outro nome.
-- duplicado_de: o repetido fica marcado (não é apagado) e sai da tela, do kit e das leituras.
ALTER TABLE documents ADD COLUMN drive_md5 CHAR(32) NULL, ADD COLUMN duplicado_de INT NULL, ADD INDEX idx_documents_drive_md5 (drive_md5);
