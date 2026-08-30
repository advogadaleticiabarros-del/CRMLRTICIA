import { db } from '../config/database';

/**
 * "Pergunta com botão aguardando resposta" pelo WhatsApp — genérico o
 * suficiente pra outras perguntas de botão além de newsletter, mas hoje só
 * usado pelo opt-in de newsletter disparado na recusa de proposta
 * (ver src/routes/propostas.ts, PATCH /:id/status).
 *
 * Correlação resposta → pergunta: a Uazapi não manda a resposta de um botão
 * REPLY como campo estruturado — ela chega como texto puro da mensagem
 * (o "id" do botão vira o corpo da mensagem recebida). Por isso a única
 * forma de saber "essa mensagem é uma resposta a QUAL pergunta" é olhar
 * se existe uma pendência em aberto para aquele telefone.
 *
 * Sem cron de expiração: findOpenPendingReply só considera pendências dos
 * últimos 7 dias. Uma pendência mais velha nunca é casada — fica no banco
 * como "sem resposta", sem incomodar de novo (não repete a pergunta).
 */

export interface PendingReply {
  id: number;
  phone: string;
  tipo: string;
  lead_id: number | null;
  client_id: number | null;
  proposta_id: number | null;
  expected_yes: string;
  expected_no: string;
}

export interface CreatePendingReplyInput {
  phone: string;
  tipo: string;
  leadId?: number | null;
  clientId?: number | null;
  propostaId?: number | null;
  expectedYes: string;
  expectedNo: string;
}

const JANELA_DIAS = 7;

export async function createPendingReply(input: CreatePendingReplyInput): Promise<void> {
  await db.query(
    `INSERT INTO whatsapp_pending_replies
       (phone, tipo, lead_id, client_id, proposta_id, expected_yes, expected_no)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.phone, input.tipo,
      input.leadId ?? null, input.clientId ?? null, input.propostaId ?? null,
      input.expectedYes, input.expectedNo,
    ]
  );
}

/** Pendência mais recente, ainda sem resposta, dentro da janela de 7 dias — ou null. */
export async function findOpenPendingReply(phone: string): Promise<PendingReply | null> {
  const [rows] = await db.query(
    `SELECT id, phone, tipo, lead_id, client_id, proposta_id, expected_yes, expected_no
       FROM whatsapp_pending_replies
      WHERE phone = ?
        AND resolved_at IS NULL
        AND created_at >= NOW() - INTERVAL ${JANELA_DIAS} DAY
      ORDER BY id DESC
      LIMIT 1`,
    [phone]
  ) as any;
  return rows[0] ?? null;
}

/**
 * Interpreta o texto recebido como sim/não/desconhecido, casando primeiro
 * pelo id exato do botão clicado (expected_yes/expected_no) e, como
 * fallback, por texto digitado à mão ("sim"/"não"/variações comuns).
 * Retorna null quando não reconhece — a pendência continua aberta pra
 * uma próxima mensagem mais clara, em vez de resolver com um chute.
 */
export function interpretarResposta(texto: string, pending: PendingReply): 'sim' | 'nao' | null {
  const norm = String(texto || '').trim().toLowerCase();
  if (!norm) return null;
  if (norm === pending.expected_yes.toLowerCase()) return 'sim';
  if (norm === pending.expected_no.toLowerCase()) return 'nao';

  const semAcento = norm.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (['sim', 's', 'yes', 'y', 'quero', 'aceito'].includes(semAcento)) return 'sim';
  if (['nao', 'n', 'no', 'nunca'].includes(semAcento)) return 'nao';
  return null;
}

export async function resolvePendingReply(id: number, resposta: 'sim' | 'nao'): Promise<void> {
  await db.query(
    `UPDATE whatsapp_pending_replies SET resposta = ?, resolved_at = NOW() WHERE id = ?`,
    [resposta, id]
  );
}
