import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { logActivity } from '../services/JourneyService';
import { notificationService } from '../services/NotificationService';

const router = Router();

// ── GET /api/public/proposta/:token — proposta para o cliente (sem login) ────
router.get('/proposta/:token', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    `SELECT p.title, p.contact_name, p.legal_area, p.tipo_causa, p.description, p.valor,
            p.validade, p.observacoes, p.honorarios, p.dependentes, p.status, p.aceito_em, p.created_at,
            u.name AS advogada_nome
       FROM propostas p
       LEFT JOIN users u ON u.id = p.user_id
      WHERE p.public_token = ?`, [req.params.token]
  ) as any;
  if (!rows.length) { res.status(404).json({ error: 'Proposta não encontrada' }); return; }
  res.json(rows[0]);
});

// ── POST /api/public/proposta/:token/aceitar — cliente aceita (registra) ─────
router.post('/proposta/:token/aceitar', async (req: Request, res: Response) => {
  const [rows] = await db.query(
    'SELECT id, user_id, lead_id, client_id, contact_name, title, aceito_em FROM propostas WHERE public_token = ?',
    [req.params.token]
  ) as any;
  if (!rows.length) { res.status(404).json({ error: 'Proposta não encontrada' }); return; }
  const p = rows[0];

  if (!p.aceito_em) {
    await db.query("UPDATE propostas SET aceito_em = NOW(), status = 'em_negociacao' WHERE id = ?", [p.id]);
    await logActivity({
      leadId: p.lead_id ?? null, clientId: p.client_id ?? null,
      actorId: p.user_id, actorName: p.contact_name || 'Cliente',
      eventType: 'proposal_status', title: 'Proposta ACEITA pelo cliente',
      description: `${p.title} — aceite registrado pelo link público.`,
    });
    const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
    for (const a of admins) {
      await notificationService.create({
        userId: a.id, title: 'Proposta aceita pelo cliente',
        message: `${p.contact_name || 'O cliente'} aceitou a proposta "${p.title}". Confirme para gerar o contrato.`,
        notificationType: 'proposta_aceita', channel: 'sistema', scheduledAt: new Date(),
      });
    }
  }
  res.json({ success: true });
});

export default router;
