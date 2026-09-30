import { db } from '../config/database';
import { sendEmail, layout } from './EmailService';
import { sendText } from './uazapiInstance';
import {
  classificarDia, categoriaDoDia, sortearFrase, textoWhatsapp,
  type Retrato, type TarefaDia, type Classificacao, type ContextoDia,
} from './fechamentoDia';

interface TarefaSnapshot { id: number; titulo: string; status: string; }
interface SnapshotPayload { tarefas: TarefaSnapshot[]; }

/**
 * Compara o snapshot salvo de manhã com o estado atual. Regra (decisão da
 * usuária, spec seção 6): "concluído" é TUDO que mudou de status hoje — não
 * só o que já estava no snapshot da manhã. Pura, sem I/O — fácil de testar.
 * Mantida por compatibilidade; o fechamento usa `classificarDia`, que também
 * considera o que estava no retrato da manhã e foi reagendado.
 */
export function compararSnapshotComEstadoAtual(
  manha: SnapshotPayload | null,
  agora: SnapshotPayload
): { concluidos: string[]; pendentes: string[] } {
  const statusConcluido = new Set(['concluida', 'concluido', 'pago', 'protocolado']);
  const concluidos: string[] = [];
  const pendentes: string[] = [];
  for (const t of agora.tarefas) {
    if (statusConcluido.has(t.status)) concluidos.push(t.titulo);
    else pendentes.push(t.titulo);
  }
  return { concluidos, pendentes };
}

/** Salva o retrato do que saiu no briefing da manhã, para comparar às 18:30. */
export async function salvarSnapshotDoDia(userId: number, payload: SnapshotPayload): Promise<void> {
  await db.query(
    `INSERT INTO briefing_snapshots (user_id, snapshot_date, payload)
     VALUES (?, CURDATE(), ?)
     ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
    [userId, JSON.stringify(payload)]
  );
}

async function buscarSnapshotDeHoje(userId: number): Promise<Retrato | null> {
  const [[row]] = await db.query(
    'SELECT payload FROM briefing_snapshots WHERE user_id = ? AND snapshot_date = CURDATE()',
    [userId]
  ) as any;
  if (!row) return null;
  try { return typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload; } catch { return null; }
}

const HOJE_SP = "DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))";
const AMANHA_SP = "DATE_ADD(DATE(CONVERT_TZ(NOW(),'+00:00','-03:00')), INTERVAL 1 DAY)";
const local = (col: string) => `DATE(CONVERT_TZ(${col},'+00:00','-03:00'))`;

async function estadoAtualDasTarefas(userId: number): Promise<Retrato> {
  const [rows] = await db.query(
    `SELECT id, title AS titulo, status, waiting_on FROM tasks
      WHERE user_id = ? AND due_date IS NOT NULL AND ${local('due_date')} = ${HOJE_SP}`,
    [userId]
  ) as any;
  return { tarefas: rows };
}

/** Estado atual das tarefas que estavam no retrato da manhã (mesmo se reagendadas). */
async function estadoDasTarefasDaManha(manha: Retrato | null): Promise<Map<number, TarefaDia>> {
  const ids = (manha?.tarefas ?? []).map((t) => t.id).filter(Boolean);
  if (!ids.length) return new Map();
  const [rows] = await db.query(
    'SELECT id, title AS titulo, status, waiting_on FROM tasks WHERE id IN (?)', [ids]
  ) as any;
  return new Map(rows.map((r: TarefaDia) => [r.id, r]));
}

/** Até 5 itens de amanhã: prazos primeiro, depois audiências/reuniões, depois tarefas por prioridade. */
async function prioridadesDeAmanha(userId: number): Promise<string[]> {
  const [prazos] = await db.query(
    `SELECT d.description, c.case_number FROM deadlines d LEFT JOIN cases c ON c.id = d.case_id
      WHERE d.user_id = ? AND d.status = 'pendente' AND ${local('d.deadline_date')} = ${AMANHA_SP}
      ORDER BY d.deadline_date LIMIT 5`, [userId]
  ) as any;
  const [eventos] = await db.query(
    `SELECT title, event_type, start_datetime FROM calendar_events
      WHERE user_id = ? AND event_type IN ('audiencia','reuniao') AND sync_status <> 'cancelado'
        AND ${local('start_datetime')} = ${AMANHA_SP}
      ORDER BY start_datetime LIMIT 5`, [userId]
  ) as any;
  const [tarefas] = await db.query(
    `SELECT title FROM tasks
      WHERE user_id = ? AND status IN ('pendente','em_andamento') AND ${local('due_date')} = ${AMANHA_SP}
      ORDER BY FIELD(priority,'critica','alta','media','baixa') LIMIT 5`, [userId]
  ) as any;
  const hora = (d: any) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  return [
    ...prazos.map((p: any) => `⚖️ Prazo: ${p.description}${p.case_number ? ` (${p.case_number})` : ''}`),
    ...eventos.map((e: any) => `${e.event_type === 'audiencia' ? '🏛️ Audiência' : '🤝 Reunião'} ${hora(e.start_datetime)}: ${e.title}`),
    ...tarefas.map((t: any) => `📋 ${t.title}`),
  ].slice(0, 5);
}

async function contextoDoDia(userId: number, c: Classificacao): Promise<ContextoDia> {
  const [[r]] = await db.query(
    `SELECT
       SUM(event_type = 'audiencia' AND ${local('start_datetime')} = ${HOJE_SP}) AS audiencias,
       SUM(${local('start_datetime')} = ${AMANHA_SP} AND (title LIKE '%academia%' OR title LIKE '%treino%')) AS academia
     FROM calendar_events WHERE user_id = ? AND sync_status <> 'cancelado'`, [userId]
  ) as any;
  return {
    teveAudiencia: Number(r?.audiencias) > 0, academiaAmanha: Number(r?.academia) > 0,
    concluidos: c.concluidos.length, pendentes: c.pendentes.length,
  };
}

const FRASES_RECENTES_KEY = 'fechamento_frases_recentes';

/** Sorteia a frase pelo contexto, evitando as últimas 40 usadas (guardadas em office_settings). */
async function fraseDoDia(ctx: ContextoDia): Promise<string> {
  const [[row]] = await db.query('SELECT setting_value FROM office_settings WHERE setting_key = ?', [FRASES_RECENTES_KEY]) as any;
  let recentes: string[] = [];
  try { recentes = JSON.parse(row?.setting_value || '[]'); } catch { /* valor corrompido: recomeça */ }
  const frase = sortearFrase(categoriaDoDia(ctx), recentes);
  await db.query(
    'INSERT INTO office_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
    [FRASES_RECENTES_KEY, JSON.stringify([frase, ...recentes].slice(0, 40))]
  );
  return frase;
}

async function numerosWhatsapp(): Promise<string[]> {
  const [[cfg]] = await db.query("SELECT setting_value FROM office_settings WHERE setting_key = 'briefing_whatsapp'") as any;
  return String(cfg?.setting_value || '').split(',').map((n) => n.replace(/\D/g, '')).filter(Boolean)
    .map((d) => (d.length <= 11 ? '55' + d : d));
}

const esc = (t: string) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const lista = (itens: string[], vazio: string) => (itens.length ? itens.map(esc).join('<br>') : vazio);

/**
 * Fechamento do dia (18:30): e-mail completo para quem recebe o briefing e
 * versão executiva por WhatsApp (número de `briefing_whatsapp`, enviada uma
 * vez só, com os dados do primeiro advogado/admin — o escritório é solo).
 */
export async function sendEveningClosing(): Promise<{ sent: number; failed: number; whatsapp: boolean }> {
  const [users] = await db.query(
    `SELECT id, name, email FROM users WHERE active = 1 AND role IN ('admin','advogado') AND email IS NOT NULL AND email <> '' ORDER BY id`
  ) as any;

  let sent = 0, failed = 0, whatsapp = false, whatsappTentado = false;
  for (const u of users) {
    try {
      const manha = await buscarSnapshotDeHoje(u.id);
      const c = classificarDia(manha, await estadoAtualDasTarefas(u.id), await estadoDasTarefasDaManha(manha));
      const amanha = await prioridadesDeAmanha(u.id);
      const frase = await fraseDoDia(await contextoDoDia(u.id, c));
      const firstName = (u.name || 'Dra.').split(' ')[0];

      const h3 = (t: string) => `<h3 style="color:#1f3047;font-size:15px">${t}</h3>`;
      const body = `
        <p style="font-size:19px;font-weight:700;color:#1f3047;margin:0 0 16px">Fechamento do dia, Dra. ${esc(firstName)} 🌙</p>
        ${h3('✅ Concluído hoje')}<p>${lista(c.concluidos, 'Nada marcado como concluído hoje.')}</p>
        ${h3('⏳ Ficou pendente')}<p>${lista(c.pendentes, 'Nada pendente — dia limpo!')}</p>
        ${c.aguardando.length ? `${h3('🔒 Aguardando terceiro')}<p>${lista(c.aguardando, '')}</p>` : ''}
        ${h3('🎯 Prioridade de amanhã')}<p>${lista(amanha, 'Nada marcado para amanhã ainda.')}</p>
        <p style="margin-top:22px;font-style:italic;color:#555">${esc(frase)}</p>`;
      const r = await sendEmail({ to: u.email, subject: '🌙 Fechamento do dia', html: layout('Fechamento do dia', body) });
      if (r.ok) sent++; else failed++;

      if (!whatsappTentado) {
        whatsappTentado = true;
        const texto = textoWhatsapp(firstName, c, amanha, frase);
        for (const n of await numerosWhatsapp()) {
          if (await sendText(n, texto, 'Automático — fechamento do dia').catch(() => false)) whatsapp = true;
        }
      }
    } catch {
      failed++;
    }
  }
  return { sent, failed, whatsapp };
}
