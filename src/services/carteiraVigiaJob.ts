/**
 * Varredura diária da carteira (07:30). Regras em `carteiraVigia.ts`.
 * Cada aviso sai uma vez por marco: `vigia_alertas` (ref + marco únicos).
 * A ref de processo parado inclui a data da última movimentação — se o
 * processo andar e parar de novo, os marcos recomeçam.
 */
import { db } from '../config/database';
import { notificationService } from './NotificationService';
import { marcoParado, marcoPrescricao, textoParado, textoPrescricao } from './carteiraVigia';

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const iso = (d: any) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);

/** true se é a primeira vez deste marco para esta ref. */
async function primeiraVez(ref: string, marco: number): Promise<boolean> {
  const [r] = await db.query('INSERT IGNORE INTO vigia_alertas (ref, marco) VALUES (?, ?)', [ref, marco]) as any;
  return r.affectedRows > 0;
}

async function avisarAdmins(title: string, message: string, extra: { clientId?: number; caseId?: number }, tipo: string) {
  const [admins] = await db.query("SELECT id FROM users WHERE role IN ('admin','advogado') AND active = 1") as any;
  for (const a of admins) {
    await notificationService.create({
      userId: a.id, title, message, notificationType: tipo, channel: 'sistema', scheduledAt: new Date(),
      clientId: extra.clientId, caseId: extra.caseId,
    });
  }
}

export async function runVigiaCarteira(): Promise<{ parados: number; prescricao: number }> {
  const hoje = hojeSP();
  let parados = 0, prescricao = 0;

  const [processos] = await db.query(
    `SELECT lp.id, lp.process_number, lp.last_movement_at, lp.client_id, lp.case_id, cl.name AS client_name
       FROM legal_processes lp LEFT JOIN clients cl ON cl.id = lp.client_id
      WHERE lp.status = 'ativo' AND lp.monitoring_enabled = 1 AND lp.last_movement_at IS NOT NULL
        AND lp.last_movement_at < NOW() - INTERVAL 30 DAY`
  ) as any;
  const novosParados: { p: any; marco: number }[] = [];
  for (const p of processos) {
    const marco = marcoParado(iso(p.last_movement_at), hoje);
    if (marco && await primeiraVez(`lp:${p.id}:${iso(p.last_movement_at)}`, marco)) novosParados.push({ p, marco });
  }
  parados = novosParados.length;
  // Muitos de uma vez (ex.: primeira varredura): um aviso-resumo em vez de encher o sino.
  if (novosParados.length > 5) {
    const linhas = novosParados.slice(0, 10).map(({ p, marco }) => `• ${p.process_number}${p.client_name ? ` (${p.client_name})` : ''} — ${marco}+ dias`);
    await avisarAdmins(`⏸️ ${novosParados.length} processos parados há 30+ dias`,
      `${linhas.join('\n')}${novosParados.length > 10 ? `\n• +${novosParados.length - 10} (filtro "parados há 30 dias" em Processos)` : ''}`,
      {}, 'vigia_processo_parado');
  } else {
    for (const { p, marco } of novosParados) {
      await avisarAdmins(`⏸️ Processo parado há ${marco}+ dias`,
        textoParado({ processNumber: p.process_number, clientName: p.client_name }, marco),
        { clientId: p.client_id ?? undefined, caseId: p.case_id ?? undefined }, 'vigia_processo_parado');
    }
  }

  const [casos] = await db.query(
    `SELECT c.id, c.title, c.client_id, c.prescricao_data, cl.name AS client_name
       FROM cases c LEFT JOIN clients cl ON cl.id = c.client_id
      WHERE c.status = 'ativo' AND c.prescricao_data IS NOT NULL
        AND c.prescricao_data <= CURDATE() + INTERVAL 90 DAY`
  ) as any;
  for (const c of casos) {
    const data = iso(c.prescricao_data);
    const marco = marcoPrescricao(data, hoje);
    if (marco === null || !await primeiraVez(`case:${c.id}:${data}`, marco)) continue;
    await avisarAdmins(marco === 0 ? '🚨 Data prescricional vencida' : `⏳ Prescrição em até ${marco} dias`,
      textoPrescricao({ clientName: c.client_name, title: c.title, data }, marco),
      { clientId: c.client_id ?? undefined, caseId: c.id }, 'vigia_prescricao');
    prescricao++;
  }
  return { parados, prescricao };
}
