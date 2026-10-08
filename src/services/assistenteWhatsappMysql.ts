import { db } from '../config/database';
import { criarAssistente, AssistenteRepo, AssistenteIa, Midia, Pendencia } from './assistenteWhatsapp';
import { COMANDANTES_PADRAO, parseNumerosComandantes, ehComandante, chaveFone, ItemAgenda, ProcessoInfo } from './assistenteRegras';
import { abertosDoCliente, baixarItemCliente } from './baixaAReceber';

/**
 * Peças reais do assistente do WhatsApp: banco (MySQL), IA (Groq/Gemini com
 * reserva OpenAI) e envio pela Uazapi. A lógica fica em assistenteWhatsapp.ts.
 */

async function comandantes(): Promise<string[]> {
  const [[cfg]] = await db.query(
    "SELECT setting_value FROM office_settings WHERE setting_key = 'assistente_whatsapp_numeros'"
  ).catch(() => [[null]]) as any;
  const lista = parseNumerosComandantes(cfg?.setting_value);
  return (lista.length ? lista : parseNumerosComandantes(COMANDANTES_PADRAO)).map((n) => (n.length <= 11 ? '55' + n : n));
}

/** Exportado também para diagnóstico no servidor (consultas reais, só leitura). */
export const repo: AssistenteRepo = {
  comandantes,

  async pendencias(phone) {
    const [rows] = await db.query(
      `SELECT id, phone, tipo, payload, resumo, grupo FROM assistente_pendencias
        WHERE phone_chave = ? AND status = 'aberta' AND created_at > NOW() - INTERVAL 48 HOUR
        ORDER BY id ASC`, [chaveFone(phone)]) as any;
    return rows.map((r: any) => ({ ...r, payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload })) as Pendencia[];
  },

  async criarPendencia(p) {
    const [r] = await db.query(
      `INSERT INTO assistente_pendencias (phone, phone_chave, tipo, payload, resumo, grupo) VALUES (?, ?, ?, ?, ?, ?)`,
      [p.phone, chaveFone(p.phone), p.tipo, JSON.stringify(p.payload), String(p.resumo).slice(0, 300), p.grupo ?? null]) as any;
    return r.insertId;
  },

  async fecharPendencia(id, status) {
    const [[p]] = await db.query('SELECT grupo FROM assistente_pendencias WHERE id = ?', [id]) as any;
    await db.query(
      `UPDATE assistente_pendencias SET status = ?, resolved_at = NOW()
        WHERE status = 'aberta' AND (id = ? OR (grupo IS NOT NULL AND grupo = ?))`, [status, id, p?.grupo ?? null]);
  },

  async lancar(l, quem) {
    const [[u]] = await db.query("SELECT id FROM users WHERE role IN ('admin','advogado') AND active = 1 ORDER BY id LIMIT 1") as any;
    const pago = l.tipo === 'gasto';
    const [r] = await db.query(
      `INSERT INTO cashflow_entries (user_id, type, category, description, amount, due_date, status, paid_at, installment_no, installment_total, notes, escopo)
       VALUES (?, 'saida', ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
      [u?.id ?? 1, l.categoria, l.descricao, l.valor, l.data, pago ? 'realizado' : 'previsto', pago ? l.data : null,
       `Lançado pelo ${quem}${l.codigo ? ` · Código: ${l.codigo}` : ''}`, l.escopo]) as any;
    return r.insertId;
  },

  async buscarProcessos(busca) {
    const digitos = busca.replace(/\D/g, '');
    let where: string; let params: any[];
    if (digitos.length >= 7) {
      where = "REGEXP_REPLACE(COALESCE(lp.process_number, c.case_number, ''), '[^0-9]', '') LIKE ?";
      params = [`%${digitos}%`];
    } else {
      const palavras = busca.split(/\s+/).filter((w) => w.length >= 2).slice(0, 5);
      if (!palavras.length) return [];
      where = palavras.map(() => 'cl.name LIKE ?').join(' AND ');
      params = palavras.map((w) => `%${w}%`);
    }
    const [rows] = await db.query(
      `SELECT cl.name AS cliente, COALESCE(lp.process_number, c.case_number) AS numero,
              COALESCE(lp.judicial_area, c.legal_area) AS area, lp.phase AS fase, lp.status AS status,
              c.title AS titulo, COALESCE(lp.court_alias, lp.court) AS tribunal
         FROM clients cl
         LEFT JOIN cases c ON c.client_id = cl.id
         LEFT JOIN legal_processes lp ON lp.case_id = c.id
        WHERE ${where}
        ORDER BY cl.name, c.id DESC LIMIT 20`, params) as any;
    // Busca por número: só linhas com processo (cliente sem caso não tem número pra casar).
    return rows as ProcessoInfo[];
  },

  async agenda(de, ate) {
    const br = (col: string) => `DATE(CONVERT_TZ(${col},'+00:00','-03:00'))`;
    const iso = (d: any) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
    const itens: ItemAgenda[] = [];
    const [ev] = await db.query(
      `SELECT ${br('start_datetime')} AS dia, TIME_FORMAT(CONVERT_TZ(start_datetime,'+00:00','-03:00'),'%H:%i') AS hora,
              event_type, title, location
         FROM calendar_events
        WHERE status <> 'cancelado' AND deadline_id IS NULL AND task_id IS NULL
          AND ${br('start_datetime')} BETWEEN ? AND ?`, [de, ate]) as any;
    for (const r of ev) itens.push({ data: iso(r.dia), hora: r.hora === '00:00' ? null : r.hora, tipo: r.event_type, titulo: r.title, local: r.location || null });
    const [pr] = await db.query(
      `SELECT ${br('d.deadline_date')} AS dia, d.description, COALESCE(c.case_number, c.title) AS caso
         FROM deadlines d LEFT JOIN cases c ON c.id = d.case_id
        WHERE d.status = 'pendente' AND ${br('d.deadline_date')} BETWEEN ? AND ?`, [de, ate]) as any;
    for (const r of pr) itens.push({ data: iso(r.dia), hora: null, tipo: 'prazo', titulo: `Prazo: ${r.description}${r.caso ? ` — ${r.caso}` : ''}`, local: null });
    const [tk] = await db.query(
      `SELECT ${br('due_date')} AS dia, title FROM tasks
        WHERE status NOT IN ('concluida','cancelada') AND due_date IS NOT NULL AND ${br('due_date')} BETWEEN ? AND ?`, [de, ate]) as any;
    for (const r of tk) itens.push({ data: iso(r.dia), hora: null, tipo: 'tarefa', titulo: r.title, local: null });
    // A agenda de 2 usuários espelha o mesmo Google Calendar: tira repetidos.
    const vistos = new Set<string>();
    return itens.filter((i) => { const k = `${i.data}|${i.hora}|${i.titulo}`; if (vistos.has(k)) return false; vistos.add(k); return true; });
  },

  abertosDoCliente,

  async nomeCliente(id) {
    const [[c]] = await db.query('SELECT name FROM clients WHERE id = ?', [id]) as any;
    return c?.name || 'Cliente';
  },

  async baixar(item, opts) {
    return baixarItemCliente(item.fonte, item.id, { data: opts.data, valor: opts.valor }, { id: null, name: opts.quem });
  },
};

const ia: AssistenteIa = {
  async interpretar(prompt) {
    const { aiCompleteJson, aiComplete } = await import('./aiAssistant');
    const r = await aiCompleteJson(prompt, 'groq').catch(() => ({ ok: false } as any));
    if (r.ok && r.text) return r.text;
    const o = await aiComplete(prompt, 'openai').catch(() => ({ ok: false } as any));
    return o.ok && o.text ? o.text : null;
  },
  async lerDocumento(midia, instrucao) {
    if (midia.data.length > 8 * 1024 * 1024) return null;
    const { aiLerArquivo } = await import('./aiAssistant');
    const r = await aiLerArquivo(midia.data.toString('base64'), midia.mime, instrucao);
    return r.ok && r.text ? r.text : null;
  },
  async transcrever(midia) {
    const { transcreverAudio } = await import('./whatsappTranscricao');
    const r = await transcreverAudio({ id: 0, file_name: midia.file_name || 'audio.ogg', mime: midia.mime, data: midia.data });
    return r.ok ? r.texto : null;
  },
};

const assistente = criarAssistente({
  repo, ia,
  enviar: async (phone, texto) => {
    const { sendText } = await import('./uazapiInstance');
    await sendText(phone, texto, 'Assistente do CRM');
  },
});

async function carregarMidia(mediaId: number | null): Promise<Midia | undefined> {
  if (!mediaId) return undefined;
  const [[m]] = await db.query('SELECT mime, data, file_name FROM whatsapp_media WHERE id = ?', [mediaId]) as any;
  return m ? { mime: String(m.mime), data: Buffer.from(m.data), file_name: m.file_name } : undefined;
}

/**
 * Ponto de entrada do webhook (mensagem NOVA, recebida). Devolve true quando a
 * mensagem é de uma comandante — aí ela é do assistente e não segue o fluxo
 * de cliente/lead. Para cliente que manda foto/PDF, confere comprovante em
 * segundo plano.
 */
export async function assistenteNoWebhook(m: { phone: string; texto: string; mediaId: number | null; clientId: number | null }): Promise<boolean> {
  if (ehComandante(m.phone, await comandantes())) {
    const midia = await carregarMidia(m.mediaId);
    assistente.atenderComandante({ phone: m.phone, texto: m.texto, midia }).catch(async (e) => {
      // Nunca deixar a Dra. sem resposta: avisa que deu erro (e o motivo vai pro log).
      console.error('[assistente] falha ao atender:', e?.message || e);
      const { sendText } = await import('./uazapiInstance');
      await sendText(m.phone, '⚠️ Deu um erro aqui e não consegui concluir esse pedido. Tente de novo; se repetir, faça pelo CRM.', 'Assistente do CRM').catch(() => {});
    });
    return true;
  }
  if (m.clientId && m.mediaId) {
    carregarMidia(m.mediaId).then((midia) => midia && assistente.conferirComprovanteCliente({ clientId: m.clientId!, mediaId: m.mediaId!, midia }))
      .catch((e) => console.error('[assistente] falha ao conferir comprovante:', e?.message || e));
  }
  return false;
}
