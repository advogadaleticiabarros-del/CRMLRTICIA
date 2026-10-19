// tests/contratoVariasPartes.test.mjs — contrato do casal contra o banco de verdade (roda no CI; sem banco, pula).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(32);
const { db } = await import('../dist/config/database.js');
const { reprocessContract } = await import('../dist/services/contractReprocess.js');

async function bancoDisponivel() { try { await db.query('SELECT 1'); return true; } catch { return false; } }

test('dois contratantes: contrato em nome dos dois, procuração e declaração de cada um', async (t) => {
  if (!(await bancoDisponivel())) { t.skip('banco indisponível neste ambiente'); return; }
  const ids = {};
  try {
    const [[admin]] = await db.query("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
    if (!admin) { t.skip('sem admin no banco de teste'); return; }
    const [cl] = await db.query("INSERT INTO clients (name, cpf_cnpj, address, status) VALUES ('Maria Casal Teste', '529.982.247-25', 'Rua A, 1, Vitória/ES', 'ativo')");
    ids.client = cl.insertId;
    const ov = { profissao: 'auxiliar', co_contratantes: [{ nome: 'José Casal Teste', cpf: '111.444.777-35', profissao: 'motorista', mesmo_endereco: true }] };
    const [ct] = await db.query("INSERT INTO contracts (user_id, client_id, area, title, status, party_overrides) VALUES (?, ?, 'trabalhista', 'Contrato — Maria Casal Teste', 'em_producao', ?)",
      [admin.id, ids.client, JSON.stringify(ov)]);
    ids.ct = ct.insertId;

    assert.equal(await reprocessContract(ids.ct), true);
    const [[r]] = await db.query('SELECT content, procuracao_content, declaracao_content, documentos_partes FROM contracts WHERE id = ?', [ids.ct]);
    assert.match(r.content, /^CONTRATANTES: Maria Casal Teste,.*; e José Casal Teste,.*motorista.*Rua A, 1, Vitória\/ES.*em conjunto, CONTRATANTE\.$/m, 'o José herda o endereço do titular');
    assert.match(r.content, /Maria Casal Teste\nCONTRATANTE\nCPF nº 529\.982\.247-25/);
    assert.match(r.content, /José Casal Teste\nCONTRATANTE\nCPF nº 111\.444\.777-35/);
    assert.match(r.procuracao_content, /OUTORGANTE: Maria Casal Teste/);
    const extras = typeof r.documentos_partes === 'string' ? JSON.parse(r.documentos_partes) : r.documentos_partes;
    assert.equal(extras.length, 1);
    assert.match(extras[0].procuracao, /OUTORGANTE: José Casal Teste/);
    assert.match(extras[0].declaracao, /Eu, José Casal Teste/);

    // Tirando o co-contratante, volta a ser de uma pessoa só.
    await db.query('UPDATE contracts SET party_overrides = ? WHERE id = ?', [JSON.stringify({ co_contratantes: [] }), ids.ct]);
    await reprocessContract(ids.ct);
    const [[s]] = await db.query('SELECT content, documentos_partes FROM contracts WHERE id = ?', [ids.ct]);
    assert.match(s.content, /^CONTRATANTE: Maria Casal Teste/m);
    assert.equal(s.documentos_partes, null);
  } finally {
    if (ids.ct) await db.query('DELETE FROM contracts WHERE id = ?', [ids.ct]).catch(() => {});
    if (ids.client) await db.query('DELETE FROM clients WHERE id = ?', [ids.client]).catch(() => {});
  }
});
