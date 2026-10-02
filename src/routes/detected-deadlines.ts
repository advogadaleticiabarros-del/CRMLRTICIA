import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { runPrazoConfirmadoPlaybooks } from '../services/automationService';
import { runEstagiarioForDeadline } from '../services/aiAssistant';
import { contarPrazo } from '../utils/prazoUtil';

const router = Router();

// ── POST /api/prazos-detectados/:id/minuta — gera a minuta com IA (Gemini) ──
// Gatilho MANUAL do Estagiário para um prazo específico. Diferente do fluxo
// automático, aqui devolvemos o resultado (sucesso/erro) para o usuário.
router.post('/:id/minuta', async (req: Request, res: Response) => {
  const [[dd]] = await db.query(
    `SELECT d.*, COALESCE(pm.description, d.movement_text) AS movement_full
       FROM detected_deadlines d
       LEFT JOIN process_movements pm ON pm.id = d.movement_id
      WHERE d.id = ?`, [req.params.id]
  ) as any;
  if (!dd) { res.status(404).json({ error: 'Prazo detectado não encontrado' }); return; }

  const r = await runEstagiarioForDeadline({
    detectedDeadlineId: dd.id,
    clientId: dd.client_id ?? null,
    caseId: dd.case_id ?? null,
    processId: dd.process_id ?? null,
    movementText: dd.movement_full || dd.movement_text || '',
    suggestedType: dd.suggested_type || 'Manifestação',
    suggestedDays: dd.suggested_days || 15,
  });
  if (!r.ok) { res.status(400).json({ error: r.message || 'Não foi possível gerar a minuta' }); return; }
  res.json({ success: true, ai_draft_id: r.minutaId });
});

// ── GET /api/prazos-detectados ──────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const status = (req.query.status as string) || 'a_confirmar';
  const [rows] = await db.query(
    `SELECT d.*, lp.process_number,
            COALESCE(c.name, cp.name) AS client_name,
            COALESCE(pm.description, d.movement_text) AS movement_full,
            pm.title AS movement_title,
            pm.movement_date AS movement_date,
            pm.source AS movement_source,
            pm.movement_metadata AS movement_metadata
       FROM detected_deadlines d
       LEFT JOIN legal_processes lp ON lp.id = d.process_id
       LEFT JOIN clients c  ON c.id  = d.client_id
       LEFT JOIN clients cp ON cp.id = lp.client_id
       LEFT JOIN process_movements pm ON pm.id = d.movement_id
      WHERE d.status = ? ORDER BY d.start_date DESC, d.created_at DESC LIMIT 200`, [status]
  ) as any;
  res.json(rows);
});

router.get('/count', async (_req: Request, res: Response) => {
  const [[{ total }]] = await db.query("SELECT COUNT(*) total FROM detected_deadlines WHERE status = 'a_confirmar'") as any;
  res.json({ count: Number(total) });
});

// ── POST /api/prazos-detectados/:id/confirmar ───────────────────────────────
/**
 * Confirma um prazo detectado (calcula o vencimento CPC, cria o prazo no caso,
 * roda os playbooks). Usado pela confirmação individual e pelo mutirão em lote.
 */
async function confirmarPrazoDetectado(
  id: number | string, user: { id: number },
  opts: { deadline_type?: string; days?: any; start_date?: string } = {}
): Promise<{ success: true; due_date: string; deadline_id: number | null; linked_to_case: boolean } | null> {
  const { deadline_type, days, start_date } = opts;
  const [[dd]] = await db.query('SELECT * FROM detected_deadlines WHERE id = ?', [id]) as any;
  if (!dd) return null;

  const start = start_date || (dd.start_date ? new Date(dd.start_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
  const n = parseInt(days) || dd.suggested_days || 15;
  // Mesmo cálculo da calculadora manual (CPC 219/220/224): pula feriado
  // nacional/forense e a suspensão de 20/12–20/01. O addBusinessDays antigo só
  // pulava fim de semana e podia dar data MENOR que a real perto de feriado.
  const due = contarPrazo(start, n).vencimento;
  const type = deadline_type || dd.suggested_type || 'Prazo';

  await db.query(
    "UPDATE detected_deadlines SET status = 'confirmado', due_date = ?, deadline_type = ?, confirmed_by = ? WHERE id = ?",
    [due, type, user.id, id]
  );

  // Se o processo está vinculado a um caso, cria o prazo no módulo de Prazos (entra nos alertas 30/15/7/3/1)
  let deadlineId: number | null = null;
  let lp: any = null;
  if (dd.process_id) {
    [[lp]] = await db.query('SELECT case_id, client_id FROM legal_processes WHERE id = ?', [dd.process_id]) as any;

    // Auto-vincula o processo a um caso quando não há ambiguidade: se o
    // cliente já tem exatamente 1 caso, é claramente esse. Só fica pendente
    // de vínculo manual (tarefa) quando há 2+ casos possíveis pro mesmo
    // cliente — aí só ela sabe decidir qual é o certo.
    if (!lp?.case_id && lp?.client_id) {
      const [candidatos] = await db.query(
        'SELECT id FROM cases WHERE client_id = ? AND status = \'ativo\'', [lp.client_id]
      ) as any;
      if (candidatos.length === 1) {
        await db.query('UPDATE legal_processes SET case_id = ? WHERE id = ?', [candidatos[0].id, dd.process_id]);
        lp.case_id = candidatos[0].id;
      }
    }

    if (lp?.case_id) {
      // Busca o texto completo da intimação/origem
      const [[mov]] = dd.movement_id
        ? await db.query('SELECT description, id FROM process_movements WHERE id = ?', [dd.movement_id]) as any
        : [null];
      const movementText = mov?.description || dd.movement_text || null;
      const movementId = mov?.id || dd.movement_id || null;
      const [r] = await db.query(
        `INSERT INTO deadlines (user_id, client_id, case_id, description, movement_text, movement_id, deadline_date, priority, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'alta', 'pendente')`,
        [user.id, lp.client_id ?? dd.client_id ?? null, lp.case_id, `${type} (auto do monitoramento)`, movementText, movementId, due]
      ) as any;
      deadlineId = r.insertId;
    }
  }

  // Playbooks do gatilho "prazo confirmado" (ex.: tarefa para vincular processo sem caso).
  await runPrazoConfirmadoPlaybooks({
    processId: dd.process_id ?? null,
    caseId: lp?.case_id ?? null,
    deadlineType: type,
    userId: user.id,
    clientId: lp?.client_id ?? dd.client_id ?? null,
    dueDate: due,
    deadlineId,
  });

  // A tarefa "Analisar …" desta intimação está resolvida.
  await import('../services/tarefasPrazoDetectado').then((x) => x.fecharTarefasDoPrazo([id])).catch(() => {});

  return { success: true, due_date: due, deadline_id: deadlineId, linked_to_case: !!deadlineId };
}

router.post('/:id/confirmar', async (req: Request, res: Response) => {
  const r = await confirmarPrazoDetectado(req.params.id, req.user!, req.body || {});
  if (!r) { res.status(404).json({ error: 'Prazo não encontrado' }); return; }
  res.json(r);
});

// ── GET /api/prazos-detectados/mutirao — a confirmar, com vencimento já
// calculado e separados em urgentes / demais / vencidos (+ duplicados) ──
router.get('/mutirao', async (_req: Request, res: Response) => {
  const { organizar } = await import('../services/mutiraoPrazos');
  const [rows] = await db.query(
    `SELECT d.id, d.suggested_type, d.suggested_days, d.start_date, d.created_at, lp.process_number,
            COALESCE(c.name, cp.name) AS client_name, LEFT(COALESCE(pm.description, d.movement_text, ''), 300) AS trecho
       FROM detected_deadlines d
       LEFT JOIN legal_processes lp ON lp.id = d.process_id
       LEFT JOIN clients c  ON c.id  = d.client_id
       LEFT JOIN clients cp ON cp.id = lp.client_id
       LEFT JOIN process_movements pm ON pm.id = d.movement_id
      WHERE d.status = 'a_confirmar'`) as any;
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const itens = rows.map((r: any) => {
    const ini = r.start_date ? new Date(r.start_date).toISOString().slice(0, 10) : new Date(r.created_at).toISOString().slice(0, 10);
    return { ...r, vencimento: String(contarPrazo(ini, Number(r.suggested_days) || 15).vencimento).slice(0, 10) };
  });
  res.json(organizar(itens, hoje));
});

// ── POST /api/prazos-detectados/lote { acao: 'confirmar'|'descartar', ids } ──
router.post('/lote', async (req: Request, res: Response) => {
  const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean).slice(0, 200) : [];
  const acao = req.body?.acao;
  if (!ids.length || !['confirmar', 'descartar'].includes(acao)) { res.status(400).json({ error: 'Informe a ação e os prazos' }); return; }
  let ok = 0; const falhas: number[] = [];
  for (const id of ids) {
    try {
      if (acao === 'confirmar') { if (await confirmarPrazoDetectado(id, req.user!)) ok++; else falhas.push(id); }
      else {
        const [r] = await db.query("UPDATE detected_deadlines SET status = 'descartado' WHERE id = ? AND status = 'a_confirmar'", [id]) as any;
        if (r.affectedRows) { ok++; await import('../services/tarefasPrazoDetectado').then((x) => x.fecharTarefasDoPrazo([id])).catch(() => {}); }
        else falhas.push(id);
      }
    } catch { falhas.push(id); }
  }
  res.json({ ok, falhas });
});

// ── DELETE /api/prazos-detectados/antigos?before=YYYY-MM-DD ─────────────────
// Remove prazos detectados que iniciaram antes da data (já respondidos/resolvidos).
router.delete('/antigos', async (req: Request, res: Response) => {
  const before = (req.query.before as string) || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) { res.status(400).json({ error: 'Informe before=YYYY-MM-DD' }); return; }
  const [r] = await db.query(
    'DELETE FROM detected_deadlines WHERE start_date IS NOT NULL AND start_date < ?', [before]
  ) as any;
  res.json({ success: true, before, removidos: r.affectedRows });
});

// ── POST /api/prazos-detectados/:id/descartar ───────────────────────────────
router.post('/:id/descartar', async (req: Request, res: Response) => {
  const [r] = await db.query("UPDATE detected_deadlines SET status = 'descartado' WHERE id = ?", [req.params.id]) as any;
  if (!r.affectedRows) { res.status(404).json({ error: 'Prazo não encontrado' }); return; }
  await import('../services/tarefasPrazoDetectado').then((x) => x.fecharTarefasDoPrazo([req.params.id])).catch(() => {});
  res.json({ success: true });
});

export default router;
