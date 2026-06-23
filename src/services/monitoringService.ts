import crypto from 'crypto';
import { db } from '../config/database';
import { getActiveProvider, getProvider } from './processProviders';
import { aliasFromProcessNumber } from './datajud';
import { fetchDjenByOAB, groupPublicationsByProcess, DjenPublication } from './djen';
import { notificationService } from './NotificationService';
import { telegramNotificationService } from './TelegramNotificationService';
import { logTimeline } from './TimelineService';

function hashMovement(processNumber: string, date: string | null, description: string): string {
  return crypto.createHash('sha256').update(`${processNumber}|${date || ''}|${description}`).digest('hex');
}

/** Converte data (ISO/string) para Date aceito pelo MySQL, ou null. */
function toDate(val: string | null): Date | null {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

// Palavras-gatilho que normalmente iniciam um prazo (sugestão; o advogado confirma).
const DEADLINE_TRIGGERS: { re: RegExp; type: string; days: number }[] = [
  { re: /senten[çc]a/i,         type: 'Recurso (apelação)', days: 15 },
  { re: /ac[óo]rd[ãa]o/i,       type: 'Recurso',            days: 15 },
  { re: /cita[çc][ãa]o/i,       type: 'Contestação',        days: 15 },
  { re: /embargos/i,            type: 'Embargos',           days: 5 },
  { re: /intima[çc][ãa]o/i,     type: 'Manifestação',       days: 15 },
  { re: /decis[ãa]o|despacho/i, type: 'Manifestação',       days: 5 },
  { re: /publica[çc][ãa]o/i,    type: 'Manifestação',       days: 15 },
];

/** Cria um "prazo a confirmar" quando a movimentação contém palavra-gatilho. Nunca derruba o sync. */
async function detectDeadline(processId: number, clientId: number | null, m: { movement_date: string | null; title?: string; description?: string }): Promise<void> {
  try {
    const text = `${m.title || ''} ${m.description || ''}`;
    const trig = DEADLINE_TRIGGERS.find((t) => t.re.test(text));
    if (!trig) return;
    const start = toDate(m.movement_date) || new Date();
    // Publicação antiga (provavelmente já respondida/resolvida): não cria prazo.
    const DETECT_MAX_AGE_DAYS = 45;
    if ((Date.now() - start.getTime()) / 86_400_000 > DETECT_MAX_AGE_DAYS) return;
    const startStr = start.toISOString().split('T')[0];
    await db.query(
      `INSERT INTO detected_deadlines (process_id, client_id, movement_text, detected_keyword, suggested_type, suggested_days, start_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'a_confirmar')`,
      [processId, clientId, (m.description || m.title || '').slice(0, 500), trig.type, trig.type, trig.days, startStr]
    );
    const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
    for (const a of admins) {
      await notificationService.create({
        userId: a.id, clientId: clientId ?? undefined, title: 'Possível prazo detectado',
        message: `Movimentação pode iniciar prazo (${trig.type}). Abra Prazos → confirmar a data.`,
        notificationType: 'prazo_detectado', channel: 'sistema', scheduledAt: new Date(),
      });
    }
  } catch { /* detecção é best-effort */ }
}

interface SyncResult {
  processId: number;
  status: 'sem_novidade' | 'nova_movimentacao' | 'nao_encontrado' | 'erro';
  newMovements: number;
  message?: string;
}

/** Sincroniza UM processo: consulta o provider, salva movimentações novas, notifica. */
export async function syncProcess(processId: number): Promise<SyncResult> {
  const [rows] = await db.query('SELECT * FROM legal_processes WHERE id = ?', [processId]) as any;
  if (!rows.length) return { processId, status: 'erro', newMovements: 0, message: 'Processo não encontrado' };
  const proc = rows[0];

  // processos manuais não consultam fonte externa
  const provider = proc.source === 'manual' ? getProvider('manual') : getActiveProvider();

  let result;
  try {
    result = await provider.getMovements(proc.process_number, proc.court_alias);
  } catch (err: any) {
    await logMonitor(processId, proc.lawyer_id, 'erro', provider.name, err.message);
    return { processId, status: 'erro', newMovements: 0, message: err.message };
  }

  if (!result.found) {
    const status = result.error === 'Processo não encontrado' ? 'nao_encontrado' : 'erro';
    await logMonitor(processId, proc.lawyer_id, status, provider.name, result.error);
    await db.query('UPDATE legal_processes SET last_sync_at = NOW() WHERE id = ?', [processId]);
    return { processId, status, newMovements: 0, message: result.error };
  }

  // insere movimentações novas (dedupe por hash)
  let novas = 0;
  let latest: string | null = proc.last_movement_at;
  for (const m of result.movements) {
    const hash = hashMovement(proc.process_number, m.movement_date, m.description);
    try {
      const [ins] = await db.query(
        `INSERT INTO process_movements (process_id, movement_date, title, description, source, unique_hash)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [processId, toDate(m.movement_date), m.title?.slice(0, 500), m.description, provider.name, hash]
      ) as any;
      if (ins.affectedRows) {
        novas++;
        if (m.movement_date && (!latest || m.movement_date > latest)) latest = m.movement_date;
        await detectDeadline(processId, proc.client_id, m);
      }
    } catch (e: any) {
      // duplicada (unique_hash) — ignora
      if (e.code !== 'ER_DUP_ENTRY') throw e;
    }
  }

  await db.query(
    'UPDATE legal_processes SET last_sync_at = NOW(), last_movement_at = ? WHERE id = ?',
    [toDate(latest), processId]
  );

  if (novas > 0) {
    await logMonitor(processId, proc.lawyer_id, 'nova_movimentacao', provider.name, `${novas} nova(s)`);
    await notifyNewMovements(proc, novas);
  } else {
    await logMonitor(processId, proc.lawyer_id, 'sem_novidade', provider.name, 'Sem novidades');
  }

  return { processId, status: novas > 0 ? 'nova_movimentacao' : 'sem_novidade', newMovements: novas };
}

async function notifyNewMovements(proc: any, novas: number) {
  // notifica os admins no sistema
  const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
  const msg = `${novas} nova(s) movimentação(ões) no processo ${proc.process_number}.`;
  for (const a of admins) {
    await notificationService.create({
      userId: a.id, clientId: proc.client_id, title: 'Nova movimentação processual',
      message: msg, notificationType: 'nova_movimentacao', channel: 'sistema', scheduledAt: new Date(),
    });
    await telegramNotificationService.sendMovimentacaoProcessual(a.id, {
      caseRef: proc.process_number, movement: `${novas} nova(s) movimentação(ões).`,
    });
  }
  // histórico do cliente
  if (proc.client_id) {
    await logTimeline({ clientId: proc.client_id, eventType: 'movimentacao_processual',
      description: msg, userId: null });
  }
}

async function logMonitor(processId: number, lawyerId: number | null, status: string, source: string, message?: string) {
  await db.query(
    'INSERT INTO monitoring_logs (process_id, lawyer_id, status, source, message) VALUES (?, ?, ?, ?, ?)',
    [processId, lawyerId ?? null, status, source, message?.slice(0, 500) ?? null]
  );
}

/** Insere movimentações novas (dedupe por hash) de um processo já cadastrado. Retorna quantas entraram. */
async function saveMovements(processId: number, processNumber: string, movements: { movement_date: string | null; title: string; description: string }[], source: string, clientId: number | null = null): Promise<number> {
  let novas = 0;
  for (const m of movements) {
    const hash = hashMovement(processNumber, m.movement_date, m.description);
    try {
      const [ins] = await db.query(
        `INSERT INTO process_movements (process_id, movement_date, title, description, source, unique_hash)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [processId, toDate(m.movement_date), m.title?.slice(0, 500), m.description, source, hash]
      ) as any;
      if (ins.affectedRows) { novas++; await detectDeadline(processId, clientId, m); }
    } catch (e: any) {
      if (e.code !== 'ER_DUP_ENTRY') throw e;
    }
  }
  return novas;
}

const dateOnly = (val: string | null): string | null => {
  const d = toDate(val);
  return d ? d.toISOString().split('T')[0] : null;
};

interface DiscoveryResult { lawyerId: number; oab: string; found: number; novos: number; tribunais: number; clientesNovos?: number; clientesVinculados?: number; }

/**
 * Descobre por OAB todos os processos de UM advogado e cadastra os novos (source = djen_oab).
 * Fonte: DJEN/Comunica do CNJ (busca por OAB) — o DataJud público NÃO indexa advogado/OAB.
 * Cada publicação vira movimentação; intimações disparam o detector de prazos.
 */
export async function discoverProcessesByOAB(lawyerId: number, _scope: 'national' | 'state' = 'national'): Promise<DiscoveryResult> {
  const [rows] = await db.query('SELECT * FROM lawyers WHERE id = ?', [lawyerId]) as any;
  if (!rows.length) return { lawyerId, oab: '', found: 0, novos: 0, tribunais: 0 };
  const lawyer = rows[0];
  if (!lawyer.oab_number) {
    await logMonitor(null as any, lawyerId, 'erro', 'djen_oab', 'Advogado sem número de OAB');
    return { lawyerId, oab: '', found: 0, novos: 0, tribunais: 0 };
  }

  const pubs = await fetchDjenByOAB(lawyer.oab_number, lawyer.oab_uf || 'ES', { maxPages: 15 });
  return ingestDjenForLawyer(lawyerId, pubs, lawyer);
}

/**
 * Grava no banco as publicações DJEN de um advogado (descobre processos novos,
 * adiciona movimentações e dispara o detector de prazos). Reusada tanto pela
 * descoberta server-side quanto pela ingestão vinda do navegador (que contorna
 * o bloqueio de IP do CloudFront).
 */
export async function ingestDjenForLawyer(lawyerId: number, pubs: DjenPublication[], lawyerRow?: any, createdBy: number | null = null): Promise<DiscoveryResult> {
  let lawyer = lawyerRow;
  if (!lawyer) {
    const [rows] = await db.query('SELECT * FROM lawyers WHERE id = ?', [lawyerId]) as any;
    if (!rows.length) return { lawyerId, oab: '', found: 0, novos: 0, tribunais: 0 };
    lawyer = rows[0];
  }
  const processes = groupPublicationsByProcess(pubs);
  const tribunais = new Set<string>();

  // Cria o cliente (parte representada) sem duplicar, e devolve o id. Dedup por nome.
  let clientesNovos = 0;
  const ensureClient = async (name: string, tipo: 'PF' | 'PJ'): Promise<number | null> => {
    const nm = (name || '').trim();
    if (!nm) return null;
    const [found] = await db.query('SELECT id FROM clients WHERE LOWER(name) = LOWER(?) LIMIT 1', [nm]) as any;
    if (found.length) return found[0].id;
    const [ins] = await db.query(
      "INSERT INTO clients (name, tipo, status, notes, created_by) VALUES (?, ?, 'ativo', 'Cadastrado automaticamente a partir do DJEN/OAB.', ?)",
      [nm, tipo, createdBy]
    ) as any;
    clientesNovos++;
    return ins.insertId;
  };

  let novos = 0;
  let vinculados = 0;
  for (const p of processes) {
    if (p.court) tribunais.add(p.court);
    const alias = aliasFromProcessNumber(p.process_number);
    let processId: number;
    let clientId: number | null;

    const [exists] = await db.query('SELECT id, client_id FROM legal_processes WHERE process_number = ? LIMIT 1', [p.process_number]) as any;
    if (exists.length) {
      processId = exists[0].id;
      clientId = exists[0].client_id ?? null;
      await saveMovements(processId, p.process_number, p.movements, 'djen_oab', clientId);
      await db.query('UPDATE legal_processes SET last_movement_at = (SELECT MAX(movement_date) FROM process_movements WHERE process_id = ?) WHERE id = ?', [processId, processId]);
    } else {
      const [ins] = await db.query(
        `INSERT INTO legal_processes
           (lawyer_id, process_number, court, court_alias, status, source, confidential, distribution_date, last_sync_at)
         VALUES (?, ?, ?, ?, 'ativo', 'djen_oab', 0, ?, NOW())`,
        [lawyerId, p.process_number, p.court || null, alias, dateOnly(p.last_date)]
      ) as any;
      processId = ins.insertId;
      clientId = null;
      const novasMovs = await saveMovements(processId, p.process_number, p.movements, 'djen_oab', null);
      await db.query('UPDATE legal_processes SET last_movement_at = (SELECT MAX(movement_date) FROM process_movements WHERE process_id = ?) WHERE id = ?', [processId, processId]);
      novos++;
      await logMonitor(processId, lawyerId, 'nova_movimentacao', 'djen_oab', `Processo descoberto via DJEN (${novasMovs} publicação/ões)`);
    }

    // Vincula o cliente (parte representada) se o processo ainda não tiver um
    if (!clientId && p.client_name) {
      const cid = await ensureClient(p.client_name, p.client_type);
      if (cid) {
        await db.query('UPDATE legal_processes SET client_id = ? WHERE id = ? AND client_id IS NULL', [cid, processId]);
        vinculados++;
      }
    }
  }

  await db.query('UPDATE lawyers SET last_sync_at = NOW() WHERE id = ?', [lawyerId]);
  await logMonitor(null as any, lawyerId, novos > 0 ? 'nova_movimentacao' : 'sem_novidade', 'djen_oab',
    `OAB ${lawyer.oab_number}/${lawyer.oab_uf}: ${processes.length} processos, ${pubs.length} publicações, ${novos} novos`);

  if (novos > 0) {
    const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
    for (const a of admins) {
      await notificationService.create({
        userId: a.id, title: 'Novos processos encontrados (OAB)',
        message: `${novos} novo(s) processo(s) vinculado(s) à OAB ${lawyer.oab_number}/${lawyer.oab_uf} (via DJEN).`,
        notificationType: 'descoberta_oab', channel: 'sistema', scheduledAt: new Date(),
      });
    }
  }

  return { lawyerId, oab: `${lawyer.oab_number}/${lawyer.oab_uf}`, found: processes.length, novos, tribunais: tribunais.size, clientesNovos, clientesVinculados: vinculados };
}

/** Roda a descoberta por OAB para todos os advogados ativos com monitoramento ligado. */
export async function runDiscoveryJob(): Promise<{ lawyers: number; totalNovos: number }> {
  const [lawyers] = await db.query(
    "SELECT id FROM lawyers WHERE active = 1 AND monitoring_enabled = 1 AND oab_number IS NOT NULL AND oab_number <> ''"
  ) as any;
  let totalNovos = 0;
  for (const l of lawyers) {
    try {
      const r = await discoverProcessesByOAB(l.id, 'national');
      totalNovos += r.novos;
    } catch (e: any) {
      await logMonitor(null as any, l.id, 'erro', 'datajud_oab', e.message);
    }
  }
  return { lawyers: lawyers.length, totalNovos };
}

/** Roda o monitoramento de todos os processos ativos com monitoring_enabled. */
export async function runMonitoringJob(): Promise<{ processed: number; withNews: number }> {
  const [procs] = await db.query(
    `SELECT lp.id FROM legal_processes lp
     JOIN lawyers l ON l.id = lp.lawyer_id
     WHERE lp.monitoring_enabled = 1 AND lp.status = 'ativo'
       AND l.monitoring_enabled = 1 AND l.active = 1`
  ) as any;

  let withNews = 0;
  for (const p of procs) {
    const r = await syncProcess(p.id);
    if (r.status === 'nova_movimentacao') withNews++;
  }
  await db.query('UPDATE lawyers SET last_sync_at = NOW() WHERE monitoring_enabled = 1');
  return { processed: procs.length, withNews };
}
