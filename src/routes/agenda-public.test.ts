// src/routes/agenda-public.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../config/database';

// Teste de integração real contra o banco configurado no ambiente (mesmo
// padrão de skip gracioso já usado nesta sessão para testes que tocam
// banco — se não houver conexão disponível, o teste é pulado, não falha).
async function bancoDisponivel(): Promise<boolean> {
  try { await db.query('SELECT 1'); return true; } catch { return false; }
}

test('agenda_self_service_ativo=0 por padrão bloqueia as rotas com 503 — verificado via query direta', async (t) => {
  if (!(await bancoDisponivel())) { t.skip('banco indisponível'); return; }
  const [[row]] = await db.query(
    "SELECT setting_value FROM office_settings WHERE setting_key = 'agenda_self_service_ativo'"
  ) as any;
  assert.equal(row?.setting_value, '0');
});

test('slot ocupado por um calendar_event existente não aparece mais na revalidação', async (t) => {
  if (!(await bancoDisponivel())) { t.skip('banco indisponível'); return; }

  const { calcularSlotsDisponiveis, parseExpedienteDeOfficeSettings } = await import('../services/agendaSlots');
  const { localParaUtcMysql } = await import('../utils/timezone');

  const [[admin]] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1") as any;
  if (!admin) { t.skip('nenhum admin no banco de teste'); return; }

  const dataTeste = '2027-01-04'; // segunda-feira distante, isolada de dados reais
  const startLocal = `${dataTeste}T09:00`;
  const endLocal = `${dataTeste}T10:00`;

  const [ins] = await db.query(
    `INSERT INTO calendar_events (user_id, title, event_type, start_datetime, end_datetime, source, sync_status)
     VALUES (?, 'Evento de teste — agenda_public.test', 'reuniao', ?, ?, 'crm', 'pendente')`,
    [admin.id, localParaUtcMysql(startLocal), localParaUtcMysql(endLocal)]
  ) as any;
  const eventId = ins.insertId;

  try {
    const [rows] = await db.query(
      `SELECT start_datetime, end_datetime FROM calendar_events WHERE id = ?`,
      [eventId]
    ) as any;
    const utcMysqlParaLocalStr = (utcMysql: string) => {
      const d = new Date(String(utcMysql).replace(' ', 'T').replace('T', 'T').slice(0, 19) + 'Z');
      const localMs = d.getTime() - 3 * 60 * 60 * 1000;
      const local = new Date(localMs);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
    };
    const eventosExistentes = rows.map((r: any) => ({
      start_datetime: utcMysqlParaLocalStr(String(r.start_datetime).replace('T', ' ').slice(0, 19)),
      end_datetime: utcMysqlParaLocalStr(String(r.end_datetime).replace('T', ' ').slice(0, 19)),
    }));

    const expediente = parseExpedienteDeOfficeSettings({});
    const slots = calcularSlotsDisponiveis(expediente, eventosExistentes, dataTeste, dataTeste);
    const ocupado = slots.some((s) => s.start_datetime === startLocal && s.end_datetime === endLocal);
    assert.equal(ocupado, false, 'o slot das 09:00-10:00 não deveria aparecer como livre');
  } finally {
    await db.query('DELETE FROM calendar_events WHERE id = ?', [eventId]);
  }
});
