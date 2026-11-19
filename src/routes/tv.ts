import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { resumirWhatsapp, type ConversaBruta } from '../services/painelTv';

/**
 * GET /api/tv/whatsapp?discreto=1 — resumo do WhatsApp para a tela da TV
 * (public/tv.html). Discreto por padrão: a TV fica à vista de clientes.
 * Montada com authenticate + requireStaff + requireWhatsappAccess (app.ts).
 * Só leitura. Cada consulta é isolada: se uma falhar, o resto aparece.
 */
const router = Router();

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// O banco guarda em UTC; o "hoje" é o dia em Brasília.
const HOJE_BR = "DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))";

router.get('/whatsapp', async (req: Request, res: Response) => {
  const discreto = String(req.query.discreto ?? '1') !== '0';

  const conectado = await safe(async () => (await (await import('../services/uazapiInstance')).getStatus()).connected as boolean, null as boolean | null);

  const dia = await safe(async () => {
    const [[r]] = await db.query(
      `SELECT SUM(from_me = 0) AS recebidas, SUM(from_me = 1) AS enviadas
         FROM whatsapp_messages
        WHERE msg_time >= NOW() - INTERVAL 1 DAY AND DATE(CONVERT_TZ(msg_time,'+00:00','-03:00')) = ${HOJE_BR}`) as any;
    return { recebidas: Number(r?.recebidas) || 0, enviadas: Number(r?.enviadas) || 0 };
  }, { recebidas: 0, enviadas: 0 });

  const ultimaRecebidaEm = await safe(async () => {
    const [[r]] = await db.query('SELECT MAX(msg_time) AS t FROM whatsapp_messages WHERE from_me = 0') as any;
    return r?.t || null;
  }, null as Date | null);

  const rascunhos = await safe(async () => {
    const [[r]] = await db.query("SELECT COUNT(*) AS n FROM atendente_rascunhos WHERE status = 'pendente'") as any;
    return Number(r?.n) || 0;
  }, 0);

  // Última mensagem de cada conversa dos últimos 3 dias.
  const conversas = await safe(async () => {
    const [rows] = await db.query(
      `SELECT w.phone, w.msg_time, w.from_me, w.body,
              COALESCE(cl.name, m.lead_nome, m.triagem_nome, m.push_name) AS nome,
              m.unread, m.archived, m.blocked
         FROM whatsapp_messages w
         JOIN (SELECT phone, MAX(id) AS id FROM whatsapp_messages
                WHERE msg_time >= NOW() - INTERVAL 3 DAY GROUP BY phone) u ON u.id = w.id
         LEFT JOIN clients cl ON cl.id = w.client_id
         LEFT JOIN whatsapp_chat_meta m ON m.phone = w.phone
        ORDER BY w.msg_time DESC LIMIT 80`) as any;
    return (rows as any[]).map((r): ConversaBruta => ({
      phone: String(r.phone), nome: r.nome || null, ultimaEm: r.msg_time, ultimaDeMim: Number(r.from_me) === 1,
      naoLidas: Number(r.unread) || 0, previa: r.body || null, arquivada: Number(r.archived) === 1 || Number(r.blocked) === 1,
    }));
  }, [] as ConversaBruta[]);

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ...resumirWhatsapp({ conectado, ultimaRecebidaEm, recebidasHoje: dia.recebidas, enviadasHoje: dia.enviadas, rascunhosPendentes: rascunhos, conversas }, new Date(), { discreto }),
    discreto,
    atualizadoEm: new Date().toISOString(),
  });
});

export default router;
