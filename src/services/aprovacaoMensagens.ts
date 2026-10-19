import { db } from '../config/database';

/**
 * Mensagem de agente para CLIENTE nunca sai sozinha.
 * Ordem da Jessica (19/10/2026), depois de um pedido de documentos de
 * reclamante ir para uma cliente que está sendo processada: "Não envie mais
 * nenhuma mensagem sem consentimento. Principalmente sem contexto."
 *
 * Todo agente que quer falar com o cliente chama `prepararParaAprovacao`: a
 * mensagem vira rascunho na fila (atendente_rascunhos, a mesma da Dra. Lívia),
 * com o CONTEXTO de por que ela existe, e só sai quando alguém da equipe
 * envia (pode editar ou descartar antes). Mensagens para a Dra. (avisos
 * internos) não passam por aqui.
 */

export const NOME_AGENTE: Record<string, string> = {
  atendente: 'Dra. Lívia', negociador: 'Dr. Rafael', coletor: 'Dra. Camila', fechador: 'Dr. Felipe', produtor: 'Dra. Bianca', analista: 'Dra. Helena',
};

export async function prepararParaAprovacao(d: {
  agente: keyof typeof NOME_AGENTE | string; phone: string; clientId?: number | null; nome: string | null;
  texto: string; contexto: string; area?: string | null;
}): Promise<number | null> {
  // Não empilha a mesma mensagem duas vezes para a mesma pessoa.
  const [[igual]] = await db.query(
    "SELECT id FROM atendente_rascunhos WHERE agente = ? AND phone = ? AND status = 'pendente' AND resposta = ? LIMIT 1",
    [d.agente, d.phone, d.texto]).catch(() => [[null]]) as any;
  if (igual) return igual.id;
  const [ins] = await db.query(
    `INSERT INTO atendente_rascunhos (agente, phone, client_id, nome, mensagem_cliente, resposta, intencao, area, urgente, alertas)
     VALUES (?, ?, ?, ?, ?, ?, 'aprovacao', ?, 0, '[]')`,
    [d.agente, d.phone, d.clientId ?? null, d.nome, `CONTEXTO: ${d.contexto}`.slice(0, 4000), d.texto.slice(0, 4000), d.area ?? null]) as any;
  const quem = NOME_AGENTE[d.agente] || 'Um agente';
  const [equipe] = await db.query("SELECT id FROM users WHERE role IN ('admin','advogado','staff') AND active = 1").catch(() => [[]]) as any;
  for (const u of equipe) {
    await db.query(
      `INSERT INTO notifications (user_id, client_id, title, message, notification_type, channel, scheduled_at, status)
       VALUES (?, ?, ?, ?, 'atendente_rascunho', 'sistema', NOW(), 'pendente')`,
      [u.id, d.clientId ?? null, `✉️ ${quem} preparou uma mensagem para ${d.nome || d.phone}: aprove antes de sair`,
       `${d.contexto}\n\nNada foi enviado. Confira em Escritório virtual → Mensagens para aprovar.`]).catch(() => {});
  }
  return ins.insertId;
}
