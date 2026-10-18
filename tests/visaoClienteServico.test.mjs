// tests/visaoClienteServico.test.mjs — visão completa contra o banco de verdade (roda no CI; sem banco, pula).
// Prova que todas as consultas batem com o esquema real: nenhuma pode dar erro de SQL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(32);
const { db } = await import('../dist/config/database.js');
const { montarVisao, buscarClientes } = await import('../dist/services/visaoClienteServico.js');

async function bancoDisponivel() {
  try { await db.query('SELECT 1'); return true; } catch { return false; }
}

test('visão completa: dativo + parceria + próprio, processos, acordo, repasse, financeiro e busca', async (t) => {
  if (!(await bancoDisponivel())) { t.skip('banco indisponível neste ambiente'); return; }
  const errosSql = [];
  const errOriginal = console.error;
  console.error = (...a) => { if (String(a[0]).includes('[visao-cliente]')) errosSql.push(a.join(' ')); else errOriginal(...a); };

  const marca = crypto.randomUUID().slice(0, 8);
  const nome = `Cliente Visao Teste ${marca}`;
  const numProc = `50${Date.now().toString().slice(-5)}-12.2026.5.17.0001`;
  const ids = {};
  try {
    const [[admin]] = await db.query("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
    if (!admin) { t.skip('sem admin no banco de teste'); return; }
    const [cl] = await db.query("INSERT INTO clients (name, cpf_cnpj, phone, status) VALUES (?, '529.982.247-25', '27911112222', 'ativo')", [nome]);
    ids.client = cl.insertId;
    const [pt] = await db.query('INSERT INTO partners (name, partner_split_percent) VALUES (?, 50)', [`Parceiro ${marca}`]);
    ids.partner = pt.insertId;
    const [c1] = await db.query("INSERT INTO cases (user_id, client_id, title, legal_area, case_number) VALUES (?, ?, 'Caso próprio', 'trabalhista', ?)", [admin.id, ids.client, numProc]);
    const [c2] = await db.query("INSERT INTO cases (user_id, client_id, title, legal_area, partner_id) VALUES (?, ?, 'Caso de parceria', 'civel', ?)", [admin.id, ids.client, ids.partner]);
    ids.cases = [c1.insertId, c2.insertId];
    const [lp] = await db.query('INSERT INTO legal_processes (client_id, case_id, process_number) VALUES (?, ?, ?)', [ids.client, c1.insertId, numProc]);
    ids.lp = lp.insertId;
    await db.query("INSERT INTO process_movements (process_id, movement_date, title, description, unique_hash) VALUES (?, '2026-10-01', 'Juntada', 'Juntada de petição', ?)", [ids.lp, `t-${marca}`]);
    const [dc] = await db.query("INSERT INTO dative_cases (user_id, client_id, comarca, process_number, status, estimated_value) VALUES (?, ?, 'Vitória', '0009999-00.2026.8.08.0024', 'em_andamento', 800)", [admin.id, ids.client]);
    ids.dc = dc.insertId;
    const [ag] = await db.query(
      `INSERT INTO agreements (client_id, case_id, process_number, opposing_party, total_agreement_value, installments_count, first_due_date, honorarium_percentage, honorarium_value, status)
       VALUES (?, ?, ?, 'Empresa Teste Ltda', 10000, 2, '2026-11-10', 30, 3000, 'Ativo')`, [ids.client, c1.insertId, numProc]);
    ids.ag = ag.insertId;
    await db.query("INSERT INTO agreement_client_payouts (agreement_id, tranche_label, valor_bruto, valor_honorarios, valor_liquido, status) VALUES (?, '1/2', 5000, 1500, 3500, 'pendente')", [ids.ag]);
    await db.query("INSERT INTO installments (client_id, case_id, numero, valor, due_date, status) VALUES (?, ?, 1, 300, '2020-01-10', 'pendente')", [ids.client, c1.insertId]);
    await db.query("INSERT INTO deadlines (user_id, client_id, case_id, description, deadline_date, status) VALUES (?, ?, ?, 'Recurso teste', DATE_ADD(CURDATE(), INTERVAL 2 DAY), 'pendente')", [admin.id, ids.client, c1.insertId]);

    const v = await montarVisao(ids.client);
    assert.ok(v, 'visão montada');
    assert.deepEqual(v.relacoes.map((r) => r.tipo).sort(), ['dativo', 'parceria', 'proprio']);
    assert.equal(v.casos.length, 2);
    assert.equal(v.processos.length, 1);
    assert.equal(v.processos[0].process_number, numProc);
    assert.ok(v.movimentacoes.some((m) => /Juntada/.test(m.description)));
    assert.equal(v.dativos.length, 1);
    assert.equal(v.acordos.length, 1);
    assert.equal(v.repassesCliente.length, 1);
    assert.equal(v.financeiro.repasseCliente.pendente, 3500);
    assert.ok(v.financeiro.aReceber >= 300, 'a parcela de 300 está a receber');
    assert.ok(v.financeiro.vencido >= 300, 'e vencida');
    assert.ok(v.alertas.some((a) => /Recurso teste/.test(a.texto)));
    assert.ok(v.alertas.some((a) => /Repasse ao cliente pendente/.test(a.texto)));
    assert.ok(v.linhaDoTempo.length > 0);

    const porNome = await buscarClientes(nome.slice(0, 22));
    assert.ok(porNome.some((c) => c.id === ids.client));
    const porProcesso = await buscarClientes(numProc.replace(/\D/g, '').slice(0, 9));
    assert.ok(porProcesso.some((c) => c.id === ids.client && /processo/.test(c.motivo)));
    const porCpf = await buscarClientes('52998224725');
    assert.ok(porCpf.some((c) => c.id === ids.client));

    assert.equal(await montarVisao(999999999), null);
    assert.deepEqual(errosSql, [], `consultas com erro de SQL:\n${errosSql.join('\n')}`);
  } finally {
    console.error = errOriginal;
    if (ids.ag) await db.query('DELETE FROM agreement_client_payouts WHERE agreement_id = ?', [ids.ag]).catch(() => {});
    if (ids.ag) await db.query('DELETE FROM agreements WHERE id = ?', [ids.ag]).catch(() => {});
    if (ids.lp) await db.query('DELETE FROM process_movements WHERE process_id = ?', [ids.lp]).catch(() => {});
    if (ids.lp) await db.query('DELETE FROM legal_processes WHERE id = ?', [ids.lp]).catch(() => {});
    if (ids.dc) await db.query('DELETE FROM dative_cases WHERE id = ?', [ids.dc]).catch(() => {});
    if (ids.client) {
      await db.query('DELETE FROM deadlines WHERE client_id = ?', [ids.client]).catch(() => {});
      await db.query('DELETE FROM installments WHERE client_id = ?', [ids.client]).catch(() => {});
      await db.query('DELETE FROM cases WHERE client_id = ?', [ids.client]).catch(() => {});
      await db.query('DELETE FROM clients WHERE id = ?', [ids.client]).catch(() => {});
    }
    if (ids.partner) await db.query('DELETE FROM partners WHERE id = ?', [ids.partner]).catch(() => {});
  }
});
