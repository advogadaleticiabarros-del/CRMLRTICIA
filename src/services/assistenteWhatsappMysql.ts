import { db } from '../config/database';
import { criarAssistente, AssistenteRepo, AssistenteIa, Midia, Pendencia, AndamentoInfo } from './assistenteWhatsapp';
import { COMANDANTES_PADRAO, parseNumerosComandantes, ehComandante, chaveFone, ItemAgenda, ProcessoInfo, DadosCadastro, ItemAcordo, montarAvisoAcordos } from './assistenteRegras';
import { semelhanca } from './assistenteBusca';
import { abertosDoCliente, baixarItemCliente } from './baixaAReceber';

/**
 * Peças reais do assistente do WhatsApp: banco (MySQL), IA (Groq/Gemini com
 * reserva OpenAI) e envio pela Uazapi. A lógica fica em assistenteWhatsapp.ts.
 * Gravações reaproveitam as mesmas regras das telas: baixaAReceber,
 * recebimentoCliente (Recebi um pagamento), agendaEventos (agenda + Google).
 */

async function comandantes(): Promise<string[]> {
  const [[cfg]] = await db.query(
    "SELECT setting_value FROM office_settings WHERE setting_key = 'assistente_whatsapp_numeros'"
  ).catch(() => [[null]]) as any;
  const lista = parseNumerosComandantes(cfg?.setting_value);
  return (lista.length ? lista : parseNumerosComandantes(COMANDANTES_PADRAO)).map((n) => (n.length <= 11 ? '55' + n : n));
}

/** Usuário dono das gravações (agenda/tarefas/lançamentos): a advogada com Google conectado. */
async function usuarioDono(): Promise<number> {
  const [[cfg]] = await db.query("SELECT setting_value FROM office_settings WHERE setting_key = 'assistente_usuario_id'").catch(() => [[null]]) as any;
  if (Number(cfg?.setting_value)) return Number(cfg.setting_value);
  const [[adv]] = await db.query(
    `SELECT u.id FROM users u LEFT JOIN google_accounts g ON g.user_id = u.id AND g.sync_enabled = 1
      WHERE u.active = 1 AND u.role IN ('advogado','admin')
      ORDER BY (u.role = 'advogado') DESC, (g.id IS NOT NULL) DESC, u.id LIMIT 1`) as any;
  return adv?.id ?? 1;
}

const isoDia = (d: any) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);
const BR = (col: string) => `DATE(CONVERT_TZ(${col},'+00:00','-03:00'))`;

const SQL_PROCESSOS = `SELECT cl.name AS cliente, COALESCE(lp.process_number, c.case_number) AS numero,
        COALESCE(lp.judicial_area, c.legal_area) AS area, lp.phase AS fase, lp.status AS status,
        c.title AS titulo, COALESCE(lp.court_alias, lp.court) AS tribunal
   FROM clients cl
   JOIN cases c ON c.client_id = cl.id
   LEFT JOIN legal_processes lp ON lp.case_id = c.id`;

/**
 * Parcelas em aberto de acordos (financial_records ligados a agreements), somando
 * na mesma data os honorários contratuais e os sucumbenciais do mesmo acordo.
 */
export async function acordosEmAberto(clientId: number | null): Promise<ItemAcordo[]> {
  const [rows] = await db.query(
    `SELECT a.id AS ag, COALESCE(cl.name, '—') AS cliente, a.opposing_party AS empresa, COALESCE(a.process_number, c.case_number) AS processo,
            fr.due_date, fr.valor, fr.description
       FROM financial_records fr
       JOIN agreements a ON a.id = fr.agreement_id
       LEFT JOIN clients cl ON cl.id = a.client_id
       LEFT JOIN cases c ON c.id = a.case_id
      WHERE fr.status IN ('pendente','vencido') AND fr.due_date IS NOT NULL ${clientId ? 'AND a.client_id = ?' : ''}
      ORDER BY fr.due_date`, clientId ? [clientId] : []) as any;
  const grupos = new Map<string, ItemAcordo>();
  for (const r of rows) {
    const venc = isoDia(r.due_date)!;
    const k = `${r.ag}|${venc}`;
    const parcela = (String(r.description || '').match(/\((\d+ª parcela)\)/) || [])[1] || null;
    const g = grupos.get(k);
    if (g) { g.valor = Math.round((g.valor + Number(r.valor)) * 100) / 100; if (!g.parcela && parcela) g.parcela = parcela; }
    else {
      const empresa = r.empresa || (String(r.description || '').split(' — ').pop() || null);
      grupos.set(k, { agreementId: r.ag, cliente: r.cliente, empresa, processo: r.processo || null, vencimento: venc, parcela, valor: Number(r.valor) || 0 });
    }
  }
  return [...grupos.values()];
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
    const pago = l.tipo === 'gasto';
    const [r] = await db.query(
      `INSERT INTO cashflow_entries (user_id, type, category, description, amount, due_date, status, paid_at, installment_no, installment_total, notes, escopo)
       VALUES (?, 'saida', ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
      [await usuarioDono(), l.categoria, l.descricao, l.valor, l.data, pago ? 'realizado' : 'previsto', pago ? l.data : null,
       `Lançado pelo ${quem}${l.codigo ? ` · Código: ${l.codigo}` : ''}`, l.escopo]) as any;
    return r.insertId;
  },

  async buscarProcessos(busca) {
    const dig = busca.replace(/\D/g, '');
    if (dig.length < 7) return [];
    const [rows] = await db.query(
      `${SQL_PROCESSOS} WHERE REGEXP_REPLACE(COALESCE(lp.process_number, c.case_number, ''), '[^0-9]', '') LIKE ?
        ORDER BY cl.name LIMIT 20`, [`%${dig}%`]) as any;
    return rows as ProcessoInfo[];
  },

  async processosDoCliente(clientId) {
    const [rows] = await db.query(`${SQL_PROCESSOS} WHERE cl.id = ? ORDER BY c.id DESC LIMIT 20`, [clientId]) as any;
    return rows as ProcessoInfo[];
  },

  async agenda(de, ate) {
    const itens: ItemAgenda[] = [];
    const [ev] = await db.query(
      `SELECT ${BR('start_datetime')} AS dia, TIME_FORMAT(CONVERT_TZ(start_datetime,'+00:00','-03:00'),'%H:%i') AS hora,
              event_type, title, location
         FROM calendar_events
        WHERE status <> 'cancelado' AND deadline_id IS NULL AND task_id IS NULL
          AND ${BR('start_datetime')} BETWEEN ? AND ?`, [de, ate]) as any;
    for (const r of ev) itens.push({ data: isoDia(r.dia)!, hora: r.hora === '00:00' ? null : r.hora, tipo: r.event_type, titulo: r.title, local: r.location || null });
    const [pr] = await db.query(
      `SELECT ${BR('d.deadline_date')} AS dia, d.description, COALESCE(c.case_number, c.title) AS caso
         FROM deadlines d LEFT JOIN cases c ON c.id = d.case_id
        WHERE d.status = 'pendente' AND ${BR('d.deadline_date')} BETWEEN ? AND ?`, [de, ate]) as any;
    for (const r of pr) itens.push({ data: isoDia(r.dia)!, hora: null, tipo: 'prazo', titulo: `Prazo: ${r.description}${r.caso ? ` — ${r.caso}` : ''}`, local: null });
    const [tk] = await db.query(
      `SELECT ${BR('due_date')} AS dia, title FROM tasks
        WHERE status NOT IN ('concluida','cancelada') AND due_date IS NOT NULL AND ${BR('due_date')} BETWEEN ? AND ?`, [de, ate]) as any;
    for (const r of tk) itens.push({ data: isoDia(r.dia)!, hora: null, tipo: 'tarefa', titulo: r.title, local: null });
    // A agenda de 2 usuários espelha o mesmo Google Calendar: tira repetidos.
    const vistos = new Set<string>();
    return itens.filter((i) => { const k = `${i.data}|${i.hora}|${i.titulo}`; if (vistos.has(k)) return false; vistos.add(k); return true; });
  },

  async prazos(de, ate) {
    const [rows] = await db.query(
      `SELECT ${BR('d.deadline_date')} AS dia, d.description, c.case_number, cl.name AS cliente
         FROM deadlines d LEFT JOIN cases c ON c.id = d.case_id LEFT JOIN clients cl ON cl.id = COALESCE(d.client_id, c.client_id)
        WHERE d.status = 'pendente' AND ${BR('d.deadline_date')} BETWEEN ? AND ?
        ORDER BY d.deadline_date LIMIT 50`, [de, ate]) as any;
    return rows.map((r: any) => ({ data: isoDia(r.dia)!, descricao: r.description, processo: r.case_number || null, cliente: r.cliente || null }));
  },

  abertosDoCliente,

  async nomeCliente(id) {
    const [[c]] = await db.query('SELECT name FROM clients WHERE id = ?', [id]) as any;
    return c?.name || 'Cliente';
  },

  async baixar(item, opts) {
    return baixarItemCliente(item.fonte, item.id, { data: opts.data, valor: opts.valor }, { id: await usuarioDono(), name: opts.quem });
  },

  async clientes() {
    const [rows] = await db.query("SELECT id, name FROM clients WHERE status <> 'inativo' OR status IS NULL") as any;
    return rows;
  },

  async historico(phone) {
    const [rows] = await db.query(
      `SELECT from_me, body FROM whatsapp_messages WHERE phone = ? ORDER BY msg_time DESC, id DESC LIMIT 9`, [phone]) as any;
    // a mais recente é a própria mensagem que está sendo respondida
    const lista = rows.slice(1).reverse();
    return lista.map((r: any) => ({ deMim: !!r.from_me, texto: String(r.body || '').slice(0, 400) }));
  },

  async dadosCliente(id) {
    const [[c]] = await db.query(
      `SELECT cl.name, cl.phone, cl.email, cl.cpf_cnpj, cl.address, cl.birth_date,
              (SELECT COUNT(*) FROM cases c WHERE c.client_id = cl.id) AS processos
         FROM clients cl WHERE cl.id = ?`, [id]) as any;
    return { ...c, birth_date: isoDia(c?.birth_date), processos: Number(c?.processos) || 0 };
  },

  async andamento(clientId, numero) {
    const [procs] = clientId
      ? await db.query(
        `SELECT lp.id, lp.process_number, cl.name AS cliente FROM legal_processes lp
           LEFT JOIN cases c ON c.id = lp.case_id
           JOIN clients cl ON cl.id = COALESCE(c.client_id, lp.client_id)
          WHERE COALESCE(c.client_id, lp.client_id) = ? ORDER BY lp.last_movement_at DESC LIMIT 4`, [clientId]) as any
      : await db.query(
        `SELECT lp.id, lp.process_number, COALESCE(cl.name, '—') AS cliente FROM legal_processes lp
           LEFT JOIN cases c ON c.id = lp.case_id
           LEFT JOIN clients cl ON cl.id = COALESCE(c.client_id, lp.client_id)
          WHERE REGEXP_REPLACE(lp.process_number, '[^0-9]', '') LIKE ? LIMIT 4`, [`%${numero}%`]) as any;
    const out: AndamentoInfo[] = [];
    for (const p of procs) {
      const [movs] = await db.query(
        `SELECT movement_date, title, COALESCE(NULLIF(ai_summary,''), description) AS resumo
           FROM process_movements WHERE process_id = ? ORDER BY movement_date DESC, id DESC LIMIT 5`, [p.id]) as any;
      out.push({ processo: p.process_number, cliente: p.cliente, movimentos: movs.map((m: any) => ({ data: isoDia(m.movement_date), titulo: m.title, resumo: m.resumo })) });
    }
    return out;
  },

  async documentosDoCliente(clientId) {
    const [rows] = await db.query(
      `SELECT id, name, type, created_at FROM documents
        WHERE client_id = ? AND data IS NOT NULL AND COALESCE(type,'') <> 'ia'
        ORDER BY created_at DESC LIMIT 60`, [clientId]) as any;
    return rows;
  },

  async enviarDocumento(phone, docId, legenda) {
    const [[d]] = await db.query('SELECT client_id, name, mime, data FROM documents WHERE id = ?', [docId]) as any;
    if (!d?.data) return false;
    const ext = /pdf/.test(d.mime) ? '.pdf' : /png/.test(d.mime) ? '.png' : /jpe?g/.test(d.mime) ? '.jpg' : '';
    const nome = `${String(d.name).replace(/[\\/:*?"<>|]/g, '-').slice(0, 90)}${ext && !String(d.name).toLowerCase().endsWith(ext) ? ext : ''}`;
    const [r] = await db.query(
      'INSERT INTO whatsapp_media (phone, client_id, file_name, mime, data) VALUES (?, ?, ?, ?, ?)',
      [String(phone).replace(/\D/g, ''), d.client_id ?? null, nome, d.mime || 'application/octet-stream', d.data]) as any;
    const { sendMedia } = await import('./uazapiInstance');
    return sendMedia(phone, r.insertId, legenda, 'Assistente do CRM');
  },

  async resumoAReceber(de, ate) {
    const { montarAReceber } = await import('./aReceberMontar');
    const rows = (await montarAReceber()).filter((r: any) => !r.recebido);
    const noPeriodo = rows.filter((r: any) => { const v = isoDia(r.vencimento); return !!v && v >= de && v <= ate; });
    const vencidos = rows.filter((r: any) => r.vencido)
      .sort((a: any, b: any) => String(isoDia(a.vencimento)).localeCompare(String(isoDia(b.vencimento))))
      .map((r: any) => ({ cliente: r.cliente || '—', descricao: r.descricao, valor: Number(r.seu ?? r.valor) || 0, vencimento: isoDia(r.vencimento) }));
    const soma = (l: any[], k: string) => Math.round(l.reduce((s, r) => s + (Number(r[k] ?? r.valor) || 0), 0) * 100) / 100;
    const proximos = noPeriodo.map((r: any) => ({ cliente: r.cliente || '—', descricao: r.descricao, valor: Number(r.seu ?? r.valor) || 0, vencimento: isoDia(r.vencimento) }));
    return { aReceber: soma(noPeriodo, 'seu'), qtd: noPeriodo.length, vencidoTotal: soma(vencidos, 'valor'), vencidos, proximos };
  },

  async contasAPagar(de, ate) {
    const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    const [rows] = await db.query(
      `SELECT description, amount, due_date FROM cashflow_entries
        WHERE type = 'saida' AND status = 'previsto' AND due_date <= ? AND (due_date >= ? OR due_date < ?)
        ORDER BY due_date LIMIT 100`, [ate, de, hoje]) as any;
    const out = rows.map((r: any) => ({ descricao: r.description, valor: Number(r.amount) || 0, vencimento: isoDia(r.due_date), vencida: (isoDia(r.due_date) || '') < hoje }));
    try {
      const { buscarRepassesComoSaida } = await import('../routes/cashflow');
      for (const r of await buscarRepassesComoSaida(de, ate)) out.push({ descricao: r.description, valor: Number(r.amount) || 0, vencimento: isoDia(r.due_date), vencida: false });
    } catch { /* repasses são complemento */ }
    return out.sort((a: any, b: any) => String(a.vencimento).localeCompare(String(b.vencimento)));
  },

  async contasEmAberto() {
    const [rows] = await db.query(
      `SELECT id, description, amount, due_date FROM cashflow_entries
        WHERE type = 'saida' AND status = 'previsto' ORDER BY due_date LIMIT 300`) as any;
    return rows.map((r: any) => ({ id: r.id, descricao: r.description, valor: Number(r.amount) || 0, vencimento: isoDia(r.due_date) }));
  },

  async pagarConta(id, data, quem) {
    const [r] = await db.query(
      `UPDATE cashflow_entries SET status = 'realizado', paid_at = ?, notes = CONCAT(COALESCE(notes,''), ?)
        WHERE id = ? AND status = 'previsto'`, [data, `\nPaga (baixa) pelo ${quem}`, id]) as any;
    return r.affectedRows ? 'ok' : 'ja_pago';
  },

  async registrarRecebimento(r, quem) {
    const { registrarRecebimentoCliente } = await import('./recebimentoCliente');
    return registrarRecebimentoCliente(
      { client_id: r.clientId, case_id: null, valor: r.valor, data: r.data, descricao: r.descricao, forma: r.forma },
      { id: await usuarioDono(), name: quem });
  },

  async criarCompromisso(c, quem) {
    // Fim = início + duração, sem atravessar a meia-noite (duração máxima 8h).
    const [h, m] = c.hora.split(':').map(Number);
    const fimMin = Math.min(h * 60 + m + (c.duracao || 60), 23 * 60 + 59);
    const fim = `${c.data}T${String(Math.floor(fimMin / 60)).padStart(2, '0')}:${String(fimMin % 60).padStart(2, '0')}`;
    const { criarEventoAgenda } = await import('./agendaEventos');
    const ev = await criarEventoAgenda(await usuarioDono(), {
      title: c.titulo, description: `Marcado pelo ${quem}`, event_type: c.evento,
      start_datetime: `${c.data}T${c.hora}`, end_datetime: fim, location: c.local || undefined, client_id: c.clientId,
    });
    return ev?.id;
  },

  async criarLembrete(phone, quando, texto) {
    const { localParaUtcMysql } = await import('../utils/timezone');
    const [r] = await db.query('INSERT INTO assistente_lembretes (phone, texto, quando_utc) VALUES (?, ?, ?)',
      [phone, texto.slice(0, 400), localParaUtcMysql(quando)]) as any;
    return r.insertId;
  },

  async criarTarefa(t, quem) {
    const { localParaUtcMysql } = await import('../utils/timezone');
    const [r] = await db.query(
      `INSERT INTO tasks (user_id, client_id, case_id, title, description, due_date, priority, status)
       VALUES (?, ?, NULL, ?, ?, ?, ?, 'pendente')`,
      [await usuarioDono(), t.clientId, t.titulo, [t.descricao, `Criada pelo ${quem}`].filter(Boolean).join('\n'),
       t.data ? localParaUtcMysql(`${t.data}T12:00`) : null, t.prioridade]) as any;
    return r.insertId;
  },

  async clientePorCpfOuNome(d: DadosCadastro) {
    const dig = String(d.cpf || '').replace(/\D/g, '');
    if (dig.length === 11) {
      const [[c]] = await db.query("SELECT id, name FROM clients WHERE REGEXP_REPLACE(COALESCE(cpf_cnpj,''),'[^0-9]','') = ? LIMIT 1", [dig]) as any;
      if (c) return c;
    }
    if (!d.nome) return null;
    // Mesmo nome nos dois sentidos (todas as palavras de um estão no outro) — evita
    // confundir "Maria da Silva" com "Maria Silva Santos".
    const [rows] = await db.query('SELECT id, name FROM clients') as any;
    const iguais = rows.filter((c: any) => semelhanca(d.nome!, c.name) >= 0.9 && semelhanca(c.name, d.nome!) >= 0.9);
    return iguais.length === 1 ? iguais[0] : null;
  },

  async salvarCadastro(d, existenteId, midias, quem) {
    const extras = [d.nacionalidade, d.estado_civil, d.profissao, d.rg ? `RG ${d.rg}` : null].filter(Boolean).join(', ');
    const nota = extras ? `\n${extras}. (Dados do ${quem})` : '';
    const autor = await usuarioDono();
    let id = existenteId;
    if (id) {
      await db.query(
        `UPDATE clients SET cpf_cnpj = COALESCE(NULLIF(cpf_cnpj,''), ?), birth_date = COALESCE(birth_date, ?),
                address = COALESCE(NULLIF(address,''), ?), email = COALESCE(NULLIF(email,''), ?), phone = COALESCE(NULLIF(phone,''), ?),
                notes = CONCAT(COALESCE(notes,''), ?) WHERE id = ?`,
        [d.cpf, d.nascimento, d.endereco, d.email, d.telefone, nota, id]);
    } else {
      const [r] = await db.query(
        `INSERT INTO clients (name, tipo, cpf_cnpj, email, phone, address, birth_date, notes, status, created_by)
         VALUES (?, 'PF', ?, ?, ?, ?, ?, ?, 'ativo', ?)`,
        [d.nome || `Cliente CPF ${d.cpf}`, d.cpf, d.email, d.telefone, d.endereco, d.nascimento, `Cadastrado pelo ${quem}.${nota}`, autor]) as any;
      id = r.insertId;
    }
    for (const mid of midias) {
      const [[m]] = await db.query('SELECT file_name, mime, data FROM whatsapp_media WHERE id = ?', [mid]) as any;
      if (!m?.data) continue;
      await db.query(
        `INSERT INTO documents (client_id, name, type, folder, data, mime, status, created_by)
         VALUES (?, ?, 'anexo', 'documentos_pessoais', ?, ?, 'recebido', ?)`,
        [id, `Documento pessoal — ${m.file_name || 'WhatsApp'}`, m.data, m.mime || 'application/octet-stream', autor]);
    }
    return { id: id!, criado: !existenteId };
  },

  async acordos(clientId) {
    return acordosEmAberto(clientId);
  },

  async enviarMensagemCliente(phone, texto) {
    const { sendText } = await import('./uazapiInstance');
    return sendText(phone, texto, 'Assistente (Dra. Letícia)');
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

async function enviarTexto(phone: string, texto: string): Promise<void> {
  const { sendText } = await import('./uazapiInstance');
  await sendText(phone, texto, 'Assistente do CRM');
}

const assistente = criarAssistente({ repo, ia, enviar: enviarTexto });

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
    assistente.atenderComandante({ phone: m.phone, texto: m.texto, midia, mediaId: m.mediaId }).catch(async (e) => {
      // Nunca deixar a Dra. sem resposta: avisa que deu erro (e o motivo vai pro log).
      console.error('[assistente] falha ao atender:', e?.message || e);
      await enviarTexto(m.phone, '⚠️ Deu um erro aqui e não consegui concluir esse pedido. Tente de novo; se repetir, faça pelo CRM.').catch(() => {});
    });
    return true;
  }
  if (m.clientId && m.mediaId) {
    carregarMidia(m.mediaId).then((midia) => midia && assistente.conferirComprovanteCliente({ clientId: m.clientId!, mediaId: m.mediaId!, midia }))
      .catch((e) => console.error('[assistente] falha ao conferir comprovante:', e?.message || e));
  }
  return false;
}

/** Cron (a cada minuto): manda os lembretes pedidos ao assistente na hora marcada. */
export async function enviarLembretesAssistente(): Promise<{ enviados: number }> {
  const [rows] = await db.query(
    `SELECT id, phone, texto FROM assistente_lembretes
      WHERE enviado_at IS NULL AND quando_utc <= UTC_TIMESTAMP() AND quando_utc > UTC_TIMESTAMP() - INTERVAL 6 HOUR
      ORDER BY quando_utc LIMIT 20`) as any;
  for (const r of rows) {
    // Marca antes de enviar: melhor perder um aviso que mandar em dobro.
    const [u] = await db.query('UPDATE assistente_lembretes SET enviado_at = UTC_TIMESTAMP() WHERE id = ? AND enviado_at IS NULL', [r.id]) as any;
    if (u.affectedRows) await enviarTexto(r.phone, `⏰ *Lembrete:* ${r.texto}`).catch(() => {});
  }
  return { enviados: rows.length };
}

/**
 * Cron diário (8h): avisa 2 dias antes, 1 dia antes e no dia do vencimento de
 * parcela de acordo, e o que venceu sem baixa (pedido de 09/10/2026: "para que
 * eu fique de olho no pagamento"). Vai para office_settings.acordo_aviso_numeros
 * (padrão: o número da Dra. Letícia). Uma vez por dia (sent_reminders).
 */
export async function avisarAcordosAVencer(): Promise<{ enviado: boolean }> {
  const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const texto = montarAvisoAcordos(await acordosEmAberto(null), hoje);
  if (!texto) return { enviado: false };
  const [dup] = await db.query('INSERT IGNORE INTO sent_reminders (ref_key, channel) VALUES (?, ?)', [`acordo_aviso_${hoje}`, 'whatsapp']) as any;
  if (!dup.affectedRows) return { enviado: false };
  const [[cfg]] = await db.query("SELECT setting_value FROM office_settings WHERE setting_key = 'acordo_aviso_numeros'").catch(() => [[null]]) as any;
  const numeros = parseNumerosComandantes(cfg?.setting_value || '5544991011402').map((n) => (n.length <= 11 ? '55' + n : n));
  for (const n of numeros) await enviarTexto(n, texto).catch(() => {});
  return { enviado: true };
}
