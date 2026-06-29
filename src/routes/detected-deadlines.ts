import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { runPrazoConfirmadoPlaybooks } from '../services/automationService';

const router = Router();

/** Soma N dias ÚTEIS a uma data (pula sábado/domingo). */
function addBusinessDays(startStr: string, n: number): string {
  const d = new Date(startStr + 'T00:00:00');
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().split('T')[0];
}

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
router.post('/:id/confirmar', async (req: Request, res: Response) => {
  const { deadline_type, days, start_date } = req.body;
  const [[dd]] = await db.query('SELECT * FROM detected_deadlines WHERE id = ?', [req.params.id]) as any;
  if (!dd) { res.status(404).json({ error: 'Prazo não encontrado' }); return; }

  const start = start_date || (dd.start_date ? new Date(dd.start_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
  const n = parseInt(days) || dd.suggested_days || 15;
  const due = addBusinessDays(start, n);
  const type = deadline_type || dd.suggested_type || 'Prazo';

  await db.query(
    "UPDATE detected_deadlines SET status = 'confirmado', due_date = ?, deadline_type = ?, confirmed_by = ? WHERE id = ?",
    [due, type, req.user!.id, req.params.id]
  );

  // Se o processo está vinculado a um caso, cria o prazo no módulo de Prazos (entra nos alertas 30/15/7/3/1)
  let deadlineId: number | null = null;
  let lp: any = null;
  if (dd.process_id) {
    [[lp]] = await db.query('SELECT case_id, client_id FROM legal_processes WHERE id = ?', [dd.process_id]) as any;
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
        [req.user!.id, lp.client_id ?? dd.client_id ?? null, lp.case_id, `${type} (auto do monitoramento)`, movementText, movementId, due]
      ) as any;
      deadlineId = r.insertId;
    }
  }

  // Playbooks do gatilho "prazo confirmado" (ex.: tarefa para vincular processo sem caso).
  await runPrazoConfirmadoPlaybooks({
    processId: dd.process_id ?? null,
    caseId: lp?.case_id ?? null,
    deadlineType: type,
    userId: req.user!.id,
    clientId: lp?.client_id ?? dd.client_id ?? null,
  });

  res.json({ success: true, due_date: due, deadline_id: deadlineId, linked_to_case: !!deadlineId });
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
  res.json({ success: true });
});

export default router;
