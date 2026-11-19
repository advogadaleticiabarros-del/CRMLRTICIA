import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { resumirWhatsapp, montarAvisos, type ConversaBruta } from '../services/painelTv';
import { AGENTES } from '../services/escritorioVirtual';

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

/**
 * GET /api/tv/avisos?desde=ISO — o que aconteceu desde a última consulta da TV
 * (processo protocolado, mensagem para aprovar, prazo novo, conversa que passou
 * de 30 min sem resposta, rotina com erro, audiência em 30 min). A TV toca um
 * som e mostra o aviso. Sem `desde` (TV acabou de ligar), não devolve nada:
 * só o `agora` para a próxima pergunta. A janela vai no máximo 10 min para trás,
 * para a TV que ficou desligada não disparar tudo de uma vez.
 */
const JANELA_MAX_MS = 10 * 60000;
const ESPERA_CONVERSA_MS = 30 * 60000;
const utc = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

const NOMES_AGENTES: Record<string, string> = Object.fromEntries(AGENTES.map((a) => [a.id, a.nome]));
NOMES_AGENTES.cobranca = NOMES_AGENTES.financeiro || 'Cobrança';
const agenteDaRotina = (job: string) => (AGENTES.find((a) => a.jobs.includes(job)) || { id: null as string | null }).id;

router.get('/avisos', async (req: Request, res: Response) => {
  const agora = new Date();
  res.setHeader('Cache-Control', 'no-store');
  const pedido = new Date(String(req.query.desde || ''));
  if (!req.query.desde || isNaN(pedido.getTime())) { res.json({ agora: agora.toISOString(), avisos: [] }); return; }
  const desde = new Date(Math.min(agora.getTime(), Math.max(pedido.getTime(), agora.getTime() - JANELA_MAX_MS)));
  const [de, ate] = [utc(desde), utc(agora)];

  const lista = <T>(sql: string, params: any[]) => safe(async () => (await db.query(sql, params) as any)[0] as T[], [] as T[]);

  const [protocolados, conversasEsperando, rascunhos, prazos, errosRotina, audiencias] = await Promise.all([
    lista<{ nome: string; area: string }>(
      `SELECT cl.name AS nome, c.legal_area AS area FROM client_timeline ct
         JOIN cases c ON c.id = ct.case_id JOIN clients cl ON cl.id = c.client_id
        WHERE ct.event_type = 'etapa_protocolado' AND ct.created_at > ? AND ct.created_at <= ?`, [de, ate]),
    // Última mensagem da conversa é do contato e completou 30 min nesta janela.
    lista<{ nome: string | null }>(
      `SELECT COALESCE(cl.name, m.lead_nome, m.triagem_nome, m.push_name) AS nome
         FROM whatsapp_messages w
         JOIN (SELECT phone, MAX(id) AS id FROM whatsapp_messages WHERE msg_time >= ? - INTERVAL 1 DAY GROUP BY phone) u ON u.id = w.id
         LEFT JOIN clients cl ON cl.id = w.client_id
         LEFT JOIN whatsapp_chat_meta m ON m.phone = w.phone
        WHERE w.from_me = 0 AND w.msg_time > ? AND w.msg_time <= ?
          AND COALESCE(m.archived, 0) = 0 AND COALESCE(m.blocked, 0) = 0`,
      [de, utc(new Date(desde.getTime() - ESPERA_CONVERSA_MS)), utc(new Date(agora.getTime() - ESPERA_CONVERSA_MS))]),
    lista<{ agente: string; nome: string; urgente: number }>(
      "SELECT agente, nome, urgente FROM atendente_rascunhos WHERE status = 'pendente' AND created_at > ? AND created_at <= ?", [de, ate]),
    lista<{ n: number }>('SELECT COUNT(*) AS n FROM detected_deadlines WHERE created_at > ? AND created_at <= ?', [de, ate]),
    lista<{ job: string }>("SELECT job FROM job_runs WHERE status = 'erro' AND ran_at > ? AND ran_at <= ?", [de, ate]),
    lista<{ inicio: Date }>(
      `SELECT start_datetime AS inicio FROM calendar_events
        WHERE event_type = 'audiencia' AND sync_status <> 'cancelado' AND start_datetime > ? AND start_datetime <= ?`,
      [utc(new Date(desde.getTime() + ESPERA_CONVERSA_MS)), utc(new Date(agora.getTime() + ESPERA_CONVERSA_MS))]),
  ]);

  res.json({
    agora: agora.toISOString(),
    avisos: montarAvisos({
      protocolados, conversasEsperando, audiencias, errosRotina,
      rascunhos: rascunhos.map((r) => ({ agente: r.agente, nome: r.nome, urgente: Number(r.urgente) === 1 })),
      prazosNovos: Number(prazos[0] && prazos[0].n) || 0,
    }, NOMES_AGENTES, agenteDaRotina),
  });
});

export default router;
