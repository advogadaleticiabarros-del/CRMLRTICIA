import crypto from 'crypto';
import { db } from '../config/database';
import { getActiveProvider, getProvider } from './processProviders';
import { aliasFromProcessNumber } from './datajud';
import { fetchDjenByOAB, groupPublicationsByProcess, DjenPublication, DjenProcess } from './djen';
import { notificationService } from './NotificationService';
import { telegramNotificationService } from './TelegramNotificationService';
import { logTimeline } from './TimelineService';
import { runIntimacaoPlaybooks } from './automationService';
import { interpretarMovimentacao, extrairNomeacaoDativa } from './aiAssistant';
import { sendText } from './uazapiInstance';

// ── Sugestão de fase processual a partir do texto das movimentações ──────────
const PHASE_RANK: Record<string, number> = { inicial: 1, instrucao: 2, sentenca: 3, recurso: 4, execucao: 5, encerrado: 6 };
function phaseFromText(text: string): string | null {
  const t = (text || '').toLowerCase();
  if (/tr[âa]nsito em julgado|arquivad|baixa definitiva/.test(t)) return 'encerrado';
  if (/execu[çc][ãa]o|cumprimento de senten|penhora|alvar[áa]|bacenjud|sisbajud|bloqueio de valores|le[ií]l[ãa]o/.test(t)) return 'execucao';
  if (/ac[óo]rd[ãa]o|apela[çc][ãa]o|\brecurso\b|embargos de declara|agravo|recurso ordin[áa]rio|recurso de revista/.test(t)) return 'recurso';
  if (/senten[çc]a/.test(t)) return 'sentenca';
  if (/audi[êe]ncia|instru[çc][ãa]o|contesta[çc][ãa]o|r[ée]plica|per[íi]cia|saneador|sanea/.test(t)) return 'instrucao';
  if (/cita[çc][ãa]o|distribu|autua|recebida a inicial|peti[çc][ãa]o inicial|ajuiza/.test(t)) return 'inicial';
  return null;
}

/** Recalcula a fase SUGERIDA do processo (maior estágio detectado nas movimentações). */
export async function recomputeSuggestedPhase(processId: number): Promise<void> {
  try {
    const [movs] = await db.query('SELECT title, description FROM process_movements WHERE process_id = ?', [processId]) as any;
    let best: string | null = null; let bestRank = 0;
    for (const m of movs) {
      const ph = phaseFromText(`${m.title || ''} ${m.description || ''}`);
      if (ph && PHASE_RANK[ph] > bestRank) { best = ph; bestRank = PHASE_RANK[ph]; }
    }
    if (best) await db.query('UPDATE legal_processes SET suggested_phase = ? WHERE id = ?', [best, processId]);
  } catch { /* best-effort */ }
}

function hashMovement(processNumber: string, date: string | null, description: string): string {
  return crypto.createHash('sha256').update(`${processNumber}|${date || ''}|${description}`).digest('hex');
}

function isDatajudSource(source: string): boolean {
  return ['datajud', 'api_publica_tjes', 'api_publica_trt17', 'api_publica_trf2', 'api_publica_tjpr', 'api_publica_trt9', 'api_publica_trf4', 'api_publica_stj', 'api_publica_tst'].includes(source) || source.startsWith('api_publica_');
}

/** Cria alerta de movimentação sem intimação (salvaguarda DataJud). */
async function createMovementAlert(processId: number, clientId: number | null, m: { movement_date: string | null; title?: string; description?: string }, keyword: string): Promise<void> {
  try {
    await db.query(
      `INSERT INTO movement_alerts (process_id, movement_date, title, description, alert_type, detected_keyword, status)
       VALUES (?, ?, ?, ?, 'movimento_sem_intimacao', ?, 'aberto')`,
      [processId, toDate(m.movement_date), m.title?.slice(0, 500), (m.description || '').slice(0, 2000), keyword]
    );
    const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
    for (const a of admins) {
      await db.query(
        `INSERT INTO notifications (user_id, client_id, title, message, notification_type, channel, scheduled_at, status)
         VALUES (?, ?, ?, ?, 'alerta_movimentacao', 'sistema', NOW(), 'pendente')`,
        [a.id, clientId, 'Movimentação sem intimação — verificar', `Movimento "${keyword}" detectado no DataJud sem intimação DJEN correspondente.`]
      );
    }
  } catch { /* best-effort */ }
}

/** Resolve alertas abertos quando a intimação DJEN correspondente chega. */
async function resolveMatchingAlerts(processId: number, movementDate: Date | null, description: string): Promise<void> {
  if (!description) return;
  const prefix = description.slice(0, 180);
  try {
    await db.query(
      `UPDATE movement_alerts
          SET status = 'resolvido', resolution = 'Intimação DJEN recebida', resolved_at = NOW()
        WHERE process_id = ?
          AND status = 'aberto'
          AND (movement_date <=> ? OR movement_date IS NULL)
          AND LEFT(?, 180) = LEFT(description, 180)`,
      [processId, movementDate, prefix]
    );
  } catch { /* best-effort */ }
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

/** Cria "prazo a confirmar" (DJEN) ou alerta (DataJud) quando a movimentação contém palavra-gatilho. Nunca derruba o sync. */
async function detectDeadline(processId: number, clientId: number | null, m: { movement_date: string | null; title?: string; description?: string }, processNumber?: string, movementId: number | null = null, source?: string): Promise<void> {
  try {
    const text = `${m.title || ''} ${m.description || ''}`;
    const trig = DEADLINE_TRIGGERS.find((t) => t.re.test(text));
    if (!trig) return;
    const start = toDate(m.movement_date) || new Date();
    const DETECT_MAX_AGE_DAYS = 45;
    if ((Date.now() - start.getTime()) / 86_400_000 > DETECT_MAX_AGE_DAYS) return;

    // DataJud: cria ALERTA em vez de falso prazo
    if (!source || isDatajudSource(source)) {
      await createMovementAlert(processId, clientId, m, trig.type);
      return;
    }

    // DJEN (source = djen_oab): cria prazo a confirmar
    const startStr = start.toISOString().split('T')[0];
    const movementText = (m.description || m.title || '');

    // Não recriar um prazo que já foi detectado para esta movimentação — mesmo que
    // o usuário já tenha CONFIRMADO ou DESCARTADO. Evita reenvio a cada sincronização.
    const [dup] = await db.query(
      `SELECT id FROM detected_deadlines
        WHERE process_id = ? AND suggested_type = ?
          AND (movement_id = ? OR start_date = ?)
        LIMIT 1`,
      [processId, trig.type, movementId, startStr]
    ) as any;
    if (dup.length) return;

    const [ddRes] = await db.query(
      `INSERT INTO detected_deadlines (process_id, movement_id, client_id, movement_text, detected_keyword, suggested_type, suggested_days, start_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'a_confirmar')`,
      [processId, movementId, clientId, movementText, trig.type, trig.type, trig.days, startStr]
    ) as any;

    // Playbooks da intimação (estagiário IA + aviso Telegram, conforme ligados).
    await runIntimacaoPlaybooks({
      detectedDeadlineId: ddRes.insertId, clientId, movementText,
      suggestedType: trig.type, suggestedDays: trig.days, processNumber, processId,
    });

    const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
    if (admins.length) {
      await db.query(
        `INSERT INTO tasks (user_id, client_id, title, description, due_date, priority, status)
         VALUES (?, ?, ?, ?, NOW(), 'alta', 'pendente')`,
        [admins[0].id, clientId, `Analisar ${trig.type}${processNumber ? ' — proc. ' + processNumber : ''}`, (m.description || m.title || '').slice(0, 1000)]
      );
    }
    for (const a of admins) {
      await notificationService.create({
        userId: a.id, clientId: clientId ?? undefined, title: 'Possível prazo detectado',
        message: `Intimação pode iniciar prazo (${trig.type}). Abra Prazos → confirmar a data.`,
        notificationType: 'prazo_detectado', channel: 'sistema', scheduledAt: new Date(),
      });
    }
  } catch { /* detecção é best-effort */ }
}

// Termos que indicam nomeação de defensor(a) dativo(a) — precisa achar "nome*"
// e "dativ*" a uma distância curta um do outro, nas duas ordens possíveis
// ("nomeio... dativa" ou "dativa... nomeação"), pra não disparar em falso com
// um "dativo" citado de passagem em outro contexto do processo.
const DATIVA_NOMEACAO_RE = /nome(?:io|ada|ado|a[çc][ãa]o)[\s\S]{0,150}?dativ|dativ[\s\S]{0,150}?nome(?:io|ada|ado|a[çc][ãa]o)/i;

// Avisa no WhatsApp assim que uma nomeação dativa é detectada e cadastrada —
// a advogada (44) e a assistente Jessica (27), confirmado por elas.
const DATIVA_WHATSAPP_NUMEROS = ['5544991011402', '5527988798093'];

/**
 * Detecta, no texto de UMA publicação DJEN já baixada, se é uma decisão de
 * nomeação dativa e — se for, e ainda não existir demanda cadastrada pra esse
 * processo — extrai os dados (IA) e já cria a demanda em dative_cases.
 * Nunca lança: é chamado dentro da descoberta por OAB, best-effort.
 */
async function maybeRegisterDativeNomination(proc: DjenProcess, clientId: number | null): Promise<void> {
  try {
    const texto = proc.movements.map((m) => m.description).join('\n\n');
    if (!DATIVA_NOMEACAO_RE.test(texto)) return;

    const [existing] = await db.query('SELECT id FROM dative_cases WHERE process_number = ? LIMIT 1', [proc.process_number]) as any;
    if (existing.length) return; // já cadastrada — não duplica

    const [[owner]] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1") as any;
    if (!owner) return; // sem usuário dono, não há como cadastrar (user_id é NOT NULL)

    const trecho = proc.movements.find((m) => DATIVA_NOMEACAO_RE.test(m.description))?.description || texto;
    const ai = await extrairNomeacaoDativa(trecho);
    const ext = ai.extraction || { juizo: '', comarca: '', vara: '', qualificacao_parte: '', decisao_id: '', assunto: '' };

    // comarca é NOT NULL no schema — sem extração da IA, cai pro nome do órgão/tribunal.
    const comarca = ext.comarca || proc.orgao || proc.court || 'Não identificada';
    const nomeacaoDate = dateOnly(proc.last_date);

    const [ins] = await db.query(
      `INSERT INTO dative_cases
         (user_id, client_id, process_number, comarca, vara, juizo, assisted_name, area, assunto,
          decisao_id, qualificacao_parte, nomeacao_date, estimated_value, notes, status, origem)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'outro', ?, ?, ?, ?, 0, ?, 'nomeada', 'auto_djen')`,
      [
        owner.id, clientId, proc.process_number, comarca, ext.vara || proc.orgao || null, ext.juizo || null,
        proc.client_name || null, ext.assunto || null, ext.decisao_id || null, ext.qualificacao_parte || null,
        nomeacaoDate,
        `Nomeação dativa detectada automaticamente via DJEN/OAB (processo ${proc.process_masked || proc.process_number}).`,
      ]
    ) as any;

    if (clientId) {
      await db.query('UPDATE clients SET is_dative = 1 WHERE id = ?', [clientId]);
      await logTimeline({
        clientId, eventType: 'demanda_dativa_detectada',
        description: `Nomeação dativa detectada e cadastrada automaticamente — processo ${proc.process_number}.`, userId: null,
      });
    }

    await notificationService.create({
      userId: owner.id, clientId: clientId ?? undefined, title: 'Nomeação dativa detectada e cadastrada',
      message: `Processo ${proc.process_masked || proc.process_number} (${comarca}) — confira/complete os dados em Dativo.`,
      notificationType: 'dativo_detectado', channel: 'sistema', scheduledAt: new Date(),
    });

    const resumo = [
      'Olá Dra. Letícia, você foi nomeada novamente, parabéns! 🎉',
      '',
      `Processo: ${proc.process_masked || proc.process_number}`,
      `Comarca: ${comarca}`,
      proc.client_name ? `Assistido(a): ${proc.client_name}` : null,
      ext.qualificacao_parte ? `Qualificação: ${ext.qualificacao_parte}` : null,
      ext.assunto ? `Assunto: ${ext.assunto}` : null,
    ].filter(Boolean).join('\n');
    for (const num of DATIVA_WHATSAPP_NUMEROS) {
      await sendText(num, resumo).catch(() => {});
    }

    await logMonitor(null as any, null, 'nova_movimentacao', 'djen_oab', `Demanda dativa auto-cadastrada (dative_cases id ${ins.insertId}) para o processo ${proc.process_number}`);
  } catch { /* detecção é best-effort — nunca derruba a descoberta */ }
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
        `INSERT INTO process_movements (process_id, movement_date, title, description, source, movement_type, unique_hash)
         VALUES (?, ?, ?, ?, ?, 'movimento', ?)`,
        [processId, toDate(m.movement_date), m.title?.slice(0, 500), m.description, provider.name, hash]
      ) as any;
      if (ins.affectedRows) {
        novas++;
        if (m.movement_date && (!latest || m.movement_date > latest)) latest = m.movement_date;
        await detectDeadline(processId, proc.client_id, m, proc.process_number, ins.insertId, provider.name);
        // Interpretação para o briefing matinal — best-effort, nunca trava a sincronização.
        await interpretarMovimentacao(ins.insertId, `${m.title || ''}\n${m.description || ''}`.trim())
          .catch((e) => console.error(`[movimentação ${ins.insertId}] falha ao interpretar:`, e?.message || e));
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
  if (novas > 0) await recomputeSuggestedPhase(processId);

  if (novas > 0) {
    await logMonitor(processId, proc.lawyer_id, 'nova_movimentacao', provider.name, `${novas} nova(s)`);
    await notifyNewMovements(proc, novas);
  } else {
    await logMonitor(processId, proc.lawyer_id, 'sem_novidade', provider.name, 'Sem novidades');
  }

  return { processId, status: novas > 0 ? 'nova_movimentacao' : 'sem_novidade', newMovements: novas };
}

async function notifyNewMovements(proc: any, novas: number) {
  // NÃO inunda o sininho/Telegram a cada movimentação (eram 50+ por sincronização).
  // O que é PRIORIDADE — prazos detectados — continua notificando em detectDeadline().
  // Aqui apenas registramos no histórico do cliente, sem gerar notificação no sino.
  if (proc.client_id) {
    await logTimeline({
      clientId: proc.client_id, eventType: 'movimentacao_processual',
      description: `${novas} nova(s) movimentação(ões) no processo ${proc.process_number}.`, userId: null,
    });
  }
}

async function logMonitor(processId: number, lawyerId: number | null, status: string, source: string, message?: string) {
  await db.query(
    'INSERT INTO monitoring_logs (process_id, lawyer_id, status, source, message) VALUES (?, ?, ?, ?, ?)',
    [processId, lawyerId ?? null, status, source, message?.slice(0, 500) ?? null]
  );
}

/** Insere movimentações novas (dedupe por hash) de um processo já cadastrado. Retorna quantas entraram. */
async function saveMovements(processId: number, processNumber: string, movements: ({
  movement_date: string | null; title: string; description: string;
  movement_type?: string; djen_id?: number | null; is_deadline_trigger?: boolean; metadata?: Record<string, any> | null;
})[], source: string, clientId: number | null = null): Promise<number> {
  let novas = 0;
  for (const m of movements) {
    const desc = m.description || '';
    const prefix = desc.slice(0, 180);
    const [exist] = await db.query(
      'SELECT id, CHAR_LENGTH(description) AS len FROM process_movements WHERE process_id = ? AND movement_date <=> ? AND LEFT(description, 180) = ? LIMIT 1',
      [processId, toDate(m.movement_date), prefix]
    ) as any;
    if (exist.length) {
      if (desc.length > (exist[0].len || 0)) {
        await db.query('UPDATE process_movements SET description = ? WHERE id = ?', [desc, exist[0].id]);
      }
      continue;
    }
    const movementType = m.movement_type || 'publicacao';
    const isTrigger = m.is_deadline_trigger ? 1 : 0;
    const metadata = m.metadata ? JSON.stringify(m.metadata) : null;
    const hash = hashMovement(processNumber, m.movement_date, desc);
    try {
      const [ins] = await db.query(
        `INSERT INTO process_movements
           (process_id, movement_date, title, description, source, movement_type, djen_id, is_deadline_trigger, movement_metadata, unique_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [processId, toDate(m.movement_date), m.title?.slice(0, 500), desc, source, movementType, m.djen_id ?? null, isTrigger, metadata, hash]
      ) as any;
      if (ins.affectedRows) {
        novas++;
        await detectDeadline(processId, clientId, m, processNumber, ins.insertId, source);
        if (isTrigger) {
          await resolveMatchingAlerts(processId, toDate(m.movement_date), desc);
        }
      }
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
      await recomputeSuggestedPhase(processId);
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
      await recomputeSuggestedPhase(processId);
      novos++;
      await logMonitor(processId, lawyerId, 'nova_movimentacao', 'djen_oab', `Processo descoberto via DJEN (${novasMovs} publicação/ões)`);
    }

    // Vincula o cliente (parte representada) se o processo ainda não tiver um
    if (!clientId && p.client_name) {
      const cid = await ensureClient(p.client_name, p.client_type);
      if (cid) {
        await db.query('UPDATE legal_processes SET client_id = ? WHERE id = ? AND client_id IS NULL', [cid, processId]);
        vinculados++;
        clientId = cid;
      }
    }

    // Auto-vincula o processo a um CASO quando não há ambiguidade: se o
    // cliente já tem exatamente 1 caso ativo, é claramente esse. Com 2+
    // casos possíveis, fica pendente de vínculo manual — só ela sabe qual.
    if (clientId) {
      const [[semCase]] = await db.query('SELECT case_id FROM legal_processes WHERE id = ?', [processId]) as any;
      if (!semCase?.case_id) {
        const [candidatos] = await db.query(
          'SELECT id FROM cases WHERE client_id = ? AND status = \'ativo\'', [clientId]
        ) as any;
        if (candidatos.length === 1) {
          await db.query('UPDATE legal_processes SET case_id = ? WHERE id = ?', [candidatos[0].id, processId]);
        }
      }
    }

    await maybeRegisterDativeNomination(p, clientId);
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
