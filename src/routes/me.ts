import { Router, Request, Response } from 'express';
import { db } from '../config/database';

const router = Router();

// ── GET /api/me/cases — processos atribuídos a mim ──────────────────────────
router.get('/cases', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT c.id, c.case_number, c.title, c.legal_area, c.phase, c.status,
            cc.role AS meu_papel, cc.commission_percent, cl.name AS client_name
     FROM case_collaborators cc
     JOIN cases c ON c.id = cc.case_id
     LEFT JOIN clients cl ON cl.id = c.client_id
     WHERE cc.user_id = ?
     ORDER BY c.created_at DESC`,
    [req.user!.id]
  ) as any;
  res.json(rows);
});

// ── GET /api/me/repasses — repasse do parceiro por processo ─────────────────
router.get('/repasses', async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const [cases] = await db.query(`
    SELECT
      c.id, c.title, cl.name AS client_name, cc.commission_percent,
      COALESCE((SELECT SUM(i.valor) FROM installments i WHERE i.case_id = c.id AND i.status = 'pago'), 0)      AS recebido_caso,
      COALESCE((SELECT SUM(i.valor) FROM installments i WHERE i.case_id = c.id AND i.status = 'pendente'), 0)  AS pendente_caso
    FROM case_collaborators cc
    JOIN cases c ON c.id = cc.case_id
    LEFT JOIN clients cl ON cl.id = c.client_id
    WHERE cc.user_id = ? AND cc.commission_percent IS NOT NULL
    ORDER BY c.created_at DESC
  `, [userId]) as any;

  let totalRealizado = 0, totalPrevisto = 0;
  const detalhado = cases.map((c: any) => {
    const pct = Number(c.commission_percent) / 100;
    const realizado = Number(c.recebido_caso) * pct;
    const previsto = (Number(c.recebido_caso) + Number(c.pendente_caso)) * pct;
    totalRealizado += realizado;
    totalPrevisto += previsto;
    return {
      case_id: c.id, title: c.title, client_name: c.client_name,
      commission_percent: c.commission_percent,
      recebido_caso: Number(c.recebido_caso),
      repasse_realizado: Math.round(realizado * 100) / 100,
      repasse_previsto: Math.round(previsto * 100) / 100,
    };
  });

  res.json({
    total_realizado: Math.round(totalRealizado * 100) / 100,
    total_previsto: Math.round(totalPrevisto * 100) / 100,
    processos: detalhado,
  });
});

export default router;
