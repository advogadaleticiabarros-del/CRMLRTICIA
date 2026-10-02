/**
 * Números de WhatsApp (30 dias) sem lead/cliente e ainda em "Novo contato"
 * (ou sem etapa): lista, sugere categoria pela IA (guarda em
 * whatsapp_chat_meta.triagem_*) e aplica em lote o que a advogada confirmar.
 * Regras em `triagemSemCadastro.ts`.
 */
import { db } from '../config/database';
import { aiCompleteJson } from './aiAssistant';
import { PROMPT_TRIAGEM, lerTriagem, destinoDaCategoria, type Categoria } from './triagemSemCadastro';

const SEM_CADASTRO = `
  SELECT x.phone, m.push_name, m.triagem_categoria, m.triagem_nome, m.triagem_motivo, x.ultima
    FROM (SELECT phone, MAX(msg_time) AS ultima FROM whatsapp_messages
           WHERE msg_time > UTC_TIMESTAMP() - INTERVAL 30 DAY GROUP BY phone HAVING MAX(client_id) IS NULL) x
    LEFT JOIN whatsapp_chat_meta m ON m.phone = x.phone
   WHERE NOT EXISTS (SELECT 1 FROM leads l WHERE REGEXP_REPLACE(COALESCE(l.phone,''), '[^0-9]', '') LIKE CONCAT('%', RIGHT(x.phone, 8)))
     AND NOT EXISTS (SELECT 1 FROM clients c WHERE REGEXP_REPLACE(COALESCE(c.phone,''), '[^0-9]', '') LIKE CONCAT('%', RIGHT(x.phone, 8)))
     AND (m.stage_id IS NULL OR m.stage_id = (SELECT id FROM whatsapp_stages ORDER BY position LIMIT 1))
     AND COALESCE(m.blocked, 0) = 0`;

export async function listarSemCadastro() {
  const [rows] = await db.query(`${SEM_CADASTRO} ORDER BY x.ultima DESC`) as any;
  for (const r of rows) {
    const [ult] = await db.query(
      "SELECT body FROM whatsapp_messages WHERE phone = ? AND from_me = 0 AND body <> '' ORDER BY msg_time DESC LIMIT 1", [r.phone]) as any;
    r.ultima_msg = String(ult[0]?.body || '').slice(0, 140);
  }
  return rows;
}

/** Sugere categoria para até `limite` números ainda sem triagem. Chamado em rodadas pela tela. */
export async function sugerirLote(limite = 25): Promise<{ sugeridos: number; faltam: number }> {
  const [rows] = await db.query(`${SEM_CADASTRO} AND m.triagem_categoria IS NULL ORDER BY x.ultima DESC`) as any;
  let sugeridos = 0;
  for (const r of rows.slice(0, limite)) {
    const [msgs] = await db.query(
      `SELECT from_me, body FROM whatsapp_messages WHERE phone = ? AND body <> '' ORDER BY msg_time DESC LIMIT 12`, [r.phone]) as any;
    const conversa = msgs.reverse().map((m: any) => `${m.from_me ? 'Escritório' : 'Contato'}: ${String(m.body).slice(0, 300)}`).join('\n');
    const resp = await aiCompleteJson(`${PROMPT_TRIAGEM}\n\nNome no WhatsApp: ${r.push_name || '(sem nome)'}\nMENSAGENS:\n${conversa}`, 'groq').catch(() => null);
    const t = resp?.ok && resp.text ? lerTriagem(resp.text) : null;
    await db.query(
      `INSERT INTO whatsapp_chat_meta (phone, triagem_categoria, triagem_nome, triagem_motivo) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE triagem_categoria = VALUES(triagem_categoria), triagem_nome = VALUES(triagem_nome), triagem_motivo = VALUES(triagem_motivo)`,
      [r.phone, t?.categoria || 'outro', t?.nome || null, t?.motivo || (t ? null : 'IA não conseguiu classificar')]);
    sugeridos++;
  }
  return { sugeridos, faltam: Math.max(0, rows.length - sugeridos) };
}

export async function aplicarLote(itens: { phone: string; categoria: Categoria; nome?: string }[], userId: number) {
  const [etapas] = await db.query('SELECT id, name FROM whatsapp_stages') as any;
  const etapaId = (nome: string) => etapas.find((e: any) => e.name.toLowerCase() === nome.toLowerCase())?.id ?? null;
  let leads = 0, movidos = 0;
  for (const it of itens.slice(0, 200)) {
    const phone = String(it.phone || '').replace(/\D/g, '');
    if (!phone) continue;
    const dest = destinoDaCategoria(it.categoria);
    if (dest.acao === 'lead') {
      const [[ja]] = await db.query(
        "SELECT id FROM leads WHERE REGEXP_REPLACE(COALESCE(phone,''), '[^0-9]', '') LIKE ? LIMIT 1", [`%${phone.slice(-8)}`]) as any;
      if (!ja) {
        const [[meta]] = await db.query('SELECT push_name FROM whatsapp_chat_meta WHERE phone = ?', [phone]) as any;
        const nome = String(it.nome || meta?.push_name || '').replace(/^~\s*/, '').trim() || `WhatsApp ${phone.slice(-4)}`;
        await db.query(
          "INSERT INTO leads (user_id, name, phone, source, status, notes) VALUES (?, ?, ?, 'whatsapp', 'triagem', 'Cadastrado na triagem em lote do WhatsApp.')",
          [userId, nome.slice(0, 255), phone]);
        leads++;
      }
    } else if (dest.acao === 'etapa' && dest.etapa) {
      const id = etapaId(dest.etapa);
      if (id) { await db.query('INSERT INTO whatsapp_chat_meta (phone, stage_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE stage_id = VALUES(stage_id)', [phone, id]); movidos++; }
    }
  }
  return { leads, movidos };
}
