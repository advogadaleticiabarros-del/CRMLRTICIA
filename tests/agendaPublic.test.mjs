// tests/agendaPublic.test.mjs
// Ver docs/superpowers/specs/2026-08-26-agendamento-self-service.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../dist/config/database.js', import.meta.url))) {
  execSync('npx tsc', { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
}
const { db } = await import('../dist/config/database.js');
const { calcularSlotsDisponiveis, parseExpedienteDeOfficeSettings } = await import('../dist/services/agendaSlots.js');
const { utcParaLocalStr } = await import('../dist/routes/agenda-public.js');
const { localParaUtcMysql } = await import('../dist/utils/timezone.js');

function isDbUnavailable(err) {
  return /Access denied|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(err.message || '');
}

test('agenda_self_service_ativo=0 por padrão bloqueia as rotas com 503 — verificado via query direta', async (t) => {
  try {
    const [[row]] = await db.query(
      "SELECT setting_value FROM office_settings WHERE setting_key = 'agenda_self_service_ativo'"
    );
    assert.equal(row?.setting_value, '0');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  }
});

test('slot ocupado por um calendar_event existente não aparece mais na revalidação (usa a conversão real de agenda-public.ts)', async (t) => {
  let eventId;
  try {
    const [[admin]] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1");
    if (!admin) { t.skip('nenhum admin no banco de teste'); return; }

    const dataTeste = '2027-01-04'; // segunda-feira distante, isolada de dados reais
    const startLocal = `${dataTeste}T09:00`;
    const endLocal = `${dataTeste}T10:00`;

    const [ins] = await db.query(
      `INSERT INTO calendar_events (user_id, title, event_type, start_datetime, end_datetime, source, sync_status)
       VALUES (?, 'Evento de teste — agendaPublic.test', 'reuniao', ?, ?, 'crm', 'pendente')`,
      [admin.id, localParaUtcMysql(startLocal), localParaUtcMysql(endLocal)]
    );
    eventId = ins.insertId;

    const [rows] = await db.query(
      `SELECT start_datetime, end_datetime FROM calendar_events WHERE id = ?`,
      [eventId]
    );
    // rows[0].start_datetime/end_datetime chegam como objetos Date (driver
    // mysql2 com dateStrings:false) — mesma forma que buscarEventosExistentes
    // recebe em produção. Usa a função real exportada da rota, não uma
    // reimplementação, para que este teste realmente pegue uma regressão na
    // conversão UTC->local.
    const eventosExistentes = rows.map((r) => ({
      start_datetime: utcParaLocalStr(r.start_datetime),
      end_datetime: utcParaLocalStr(r.end_datetime),
    }));

    const expediente = parseExpedienteDeOfficeSettings({});
    const slots = calcularSlotsDisponiveis(expediente, eventosExistentes, dataTeste, dataTeste);
    const aindaLivre = slots.some((s) => s.start_datetime === startLocal && s.end_datetime === endLocal);
    assert.equal(aindaLivre, false, 'o slot das 09:00-10:00 deveria ter sido removido por colidir com o evento existente');
  } catch (err) {
    if (isDbUnavailable(err)) { t.skip(`banco indisponível neste ambiente: ${err.message}`); return; }
    throw err;
  } finally {
    if (eventId) await db.query('DELETE FROM calendar_events WHERE id = ?', [eventId]).catch(() => {});
  }
});
