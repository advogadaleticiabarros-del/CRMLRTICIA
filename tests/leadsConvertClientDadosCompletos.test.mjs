// tests/leadsConvertClientDadosCompletos.test.mjs
// Ideia 2 de prioridade alta da auditoria do módulo Clientes (23/09/2026):
// converter um lead em cliente (POST /api/leads/:id/convert-client) só
// copiava name/tipo/email/phone/notes — CPF/CNPJ e endereço do lead ficavam
// pra trás, quebrando a "qualificação jurídica pronta pra copiar" da ficha
// pra qualquer cliente que veio por essa rota. RG/estado civil/profissão já
// são resolvidos à parte (a ficha faz JOIN em `leads` por client_id — ver
// GET /:id/ficha em clients.ts), então o que faltava mesmo era cpf_cnpj e
// endereço, que vivem só em `clients`.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { auditarArquivos } from './helpers/schemaAudit.mjs';

const routePath = path.resolve('src/routes/leads.ts');
const src = fs.readFileSync(routePath, 'utf8');

function rotaConvertClient() {
  const idx = src.indexOf("router.post('/:id/convert-client'");
  assert.ok(idx > -1, "rota POST '/:id/convert-client' não encontrada");
  const fim = src.indexOf('\nexport default', idx + 10);
  return src.slice(idx, fim > -1 ? fim : undefined);
}

test('convert-client copia CPF/CNPJ do lead pro cliente', () => {
  const bloco = rotaConvertClient();
  assert.match(bloco, /INSERT INTO clients[\s\S]*?cpf_cnpj/, 'INSERT em clients deveria incluir cpf_cnpj');
  assert.match(bloco, /lead\.cpf_cnpj/, 'deveria ler cpf_cnpj do lead');
});

test('convert-client monta e copia o endereço do lead (reaproveita montarEndereco, não reinventa)', () => {
  const bloco = rotaConvertClient();
  assert.match(bloco, /montarEndereco/, 'deveria reaproveitar a mesma função já usada em propostas-public.ts');
  assert.match(src, /import\s*\{[^}]*montarEndereco[^}]*\}\s*from\s*'\.\.\/services\/contractTemplates'/, 'montarEndereco deveria ser importado de contractTemplates.ts');
});

test('SQL novo de leads.ts não referencia tabela/coluna inexistente', () => {
  const { tabelasInexistentes, colunasInexistentes } = auditarArquivos([routePath]);
  assert.deepEqual(tabelasInexistentes, []);
  assert.deepEqual(colunasInexistentes, []);
});
