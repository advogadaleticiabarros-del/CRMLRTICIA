/**
 * Rotinas da agenda pessoal (ver `agendaPessoal.ts` para as regras):
 *  - gera a ocorrência do dia para cada série com repetição diária;
 *  - avisa por WhatsApp (só o número de `destinoWhatsappPessoal`) e no sino na hora
 *    do compromisso pessoal/recado/medicamento — uma vez só por ocorrência.
 */
import { db } from '../config/database';
import { notificationService } from './NotificationService';
import { sendText } from './uazapiInstance';
import { destinoWhatsappPessoal } from './destinoWhatsappPessoal';
import { TIPOS_PESSOAIS, ocorrenciaNoDia, textoLembrete } from './agendaPessoal';

const hojeSP = (offsetDias = 0) =>
  new Date(Date.now() + offsetDias * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const mysql = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

/** Cria (se ainda não existe) a ocorrência de hoje e de amanhã de cada série diária. Idempotente. */
export async function gerarOcorrenciasDiarias(): Promise<{ criadas: number }> {
  const [series] = await db.query(
    `SELECT * FROM calendar_events
      WHERE repeat_daily = 1 AND series_id IS NULL
        AND (repeat_until IS NULL OR repeat_until >= CURDATE())
        AND sync_status <> 'cancelado'`
  ) as any;
  let criadas = 0;
  for (const s of series) {
    for (const dia of [hojeSP(0), hojeSP(1)]) {
      const occ = ocorrenciaNoDia(s, dia);
      if (!occ) continue;
      const [[existe]] = await db.query(
        'SELECT id FROM calendar_events WHERE series_id = ? AND start_datetime = ? LIMIT 1',
        [s.id, mysql(occ.start)]
      ) as any;
      if (existe) continue;
      await db.query(
        `INSERT INTO calendar_events
           (user_id, client_id, case_id, title, description, event_type, start_datetime, end_datetime,
            location, source, sync_status, series_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'crm', 'pendente', ?)`,
        [s.user_id, s.client_id, s.case_id, s.title, s.description, s.event_type,
         mysql(occ.start), mysql(occ.end), s.location, s.id]
      );
      criadas++;
    }
  }
  return { criadas };
}

async function numerosDaAdvogada(): Promise<string[]> {
  return [await destinoWhatsappPessoal()];
}

/** Avisa na hora (janela de -10 a +5 min) cada compromisso pessoal/recado/medicamento ainda não avisado. */
export async function enviarLembretesPessoais(): Promise<{ avisados: number }> {
  const [eventos] = await db.query(
    `SELECT id, user_id, title, description, event_type, start_datetime
       FROM calendar_events
      WHERE event_type IN (?)
        AND whatsapp_reminded_at IS NULL
        AND sync_status NOT IN ('cancelado','erro')
        AND start_datetime BETWEEN DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE) AND DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)`,
    [TIPOS_PESSOAIS]
  ) as any;
  if (!eventos.length) return { avisados: 0 };
  const numeros = await numerosDaAdvogada();
  for (const ev of eventos) {
    // Marca antes de enviar: melhor perder um aviso que mandar em dobro a cada 5 min.
    await db.query('UPDATE calendar_events SET whatsapp_reminded_at = UTC_TIMESTAMP() WHERE id = ?', [ev.id]);
    const texto = textoLembrete(ev);
    for (const n of numeros) await sendText(n, texto, 'Automático — lembrete pessoal').catch(() => false);
    await notificationService.create({
      userId: ev.user_id, calendarEventId: ev.id,
      title: texto.split('\n')[0].replace(/\*/g, ''), message: ev.description || ev.title,
      notificationType: `${ev.event_type}_lembrete`, channel: 'som', scheduledAt: new Date(),
    }).catch(() => {});
  }
  return { avisados: eventos.length };
}
