/**
 * Briefing da véspera da audiência trabalhista (07/10/2026) — busca as
 * fontes do caso, pede o briefing à IA e manda pelo WhatsApp.
 *
 * Fontes (pedido da Dra. Letícia): petição inicial, contestação, documentos
 * anexados ao caso e movimentações do processo — e os dados do caso no CRM.
 * A IA (Gemini) lê os PDFs/imagens direto. Regras e textos em
 * briefingAudienciaRegras.ts. Envio: números de office_settings.briefing_whatsapp
 * (os mesmos do briefing matinal). Cada briefing fica salvo nos documentos do caso.
 */
import { db } from '../config/database';
import { agruparAudiencias } from './audienciaUnica';
import { ehAudienciaTrabalhista, selecionarDocumentos, montarInstrucao, dividirMensagem, janelaDeAmanha } from './briefingAudienciaRegras';

const LIMITE_DOCS_BYTES = 14 * 1024 * 1024; // cabe num envio ao Gemini (base64 ≈ +33%)
const fmtQuando = (d: Date) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ' às');

async function chamarGemini(instrucao: string, arquivos: { mime: string; data: Buffer }[]): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY não configurada');
  const model = process.env.GEMINI_MODEL_BRIEFING || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const parts: any[] = [{ text: instrucao }, ...arquivos.map((a) => ({ inline_data: { mime_type: a.mime, data: a.data.toString('base64') } }))];
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts }] }),
  });
  const d: any = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || 'Erro na IA (Gemini)');
  const texto = d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
  if (!texto.trim()) throw new Error('A IA não devolveu o briefing');
  return texto.trim();
}

/** Gera o briefing de um caso para a audiência informada. Não envia nada. */
export async function gerarBriefingAudiencia(caseId: number, quando: Date, local?: string | null): Promise<{ texto: string; fontes: string[]; foraDoEnvio: string[] }> {
  const [[c]] = await db.query(
    `SELECT c.id, c.title, c.case_number, c.description, c.polo_cliente, c.valor_causa, cl.name AS cliente
       FROM cases c JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?`, [caseId]) as any;
  if (!c) throw new Error('Caso não encontrado');
  const [partes] = await db.query('SELECT papel, nome, advogado FROM case_partes WHERE case_id = ?', [caseId]) as any;
  const [movs] = await db.query(
    `SELECT pm.movement_date, pm.title, pm.description FROM process_movements pm
       JOIN legal_processes lp ON lp.id = pm.process_id
      WHERE lp.case_id = ? OR REGEXP_REPLACE(lp.process_number,'[^0-9]','') = REGEXP_REPLACE(?, '[^0-9]', '')
      ORDER BY pm.movement_date DESC LIMIT 40`, [caseId, c.case_number || '']) as any;
  const [docs] = await db.query(
    `SELECT id, name, mime, LENGTH(data) AS bytes FROM documents
      WHERE case_id = ? AND data IS NOT NULL AND COALESCE(type,'') <> 'briefing_audiencia'`, [caseId]) as any;
  const { escolhidos, deFora } = selecionarDocumentos(docs.map((d: any) => ({ ...d, bytes: Number(d.bytes) || 0 })), LIMITE_DOCS_BYTES);
  const arquivos: { mime: string; data: Buffer }[] = [];
  for (const d of escolhidos) {
    const [[x]] = await db.query('SELECT data FROM documents WHERE id = ?', [d.id]) as any;
    if (x?.data) arquivos.push({ mime: d.mime, data: Buffer.from(x.data) });
  }
  const vistos = new Set<string>();
  const linhasMov = movs.filter((m: any) => { const k = `${String(m.movement_date)}|${m.title}`; if (vistos.has(k)) return false; vistos.add(k); return true; })
    .map((m: any) => `- ${new Date(m.movement_date).toLocaleDateString('pt-BR')}: ${m.title}${m.description && m.description !== m.title ? ' — ' + String(m.description).replace(/\s+/g, ' ').slice(0, 1500) : ''}`);
  const contexto = [
    `Caso no CRM: ${c.title}. Valor da causa: ${c.valor_causa ? 'R$ ' + Number(c.valor_causa).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : 'não informado'}.`,
    local ? `Local/link da audiência (agenda): ${local}` : '',
    partes.length ? `Partes: ${partes.map((p: any) => `${p.papel}: ${p.nome}${p.advogado ? ' (adv. ' + p.advogado + ')' : ''}`).join('; ')}` : '',
    c.description ? `Anotações do caso no CRM:\n${String(c.description).slice(0, 6000)}` : '',
    `Documentos anexados (lidos pela IA): ${escolhidos.map((d) => d.name).join('; ') || 'nenhum'}`,
    deFora.length ? `Documentos do caso NÃO enviados à IA (formato ou tamanho): ${deFora.map((d) => d.name).join('; ')}` : '',
    `Movimentações do processo (mais recentes primeiro):\n${linhasMov.join('\n') || 'nenhuma registrada no CRM'}`,
  ].filter(Boolean).join('\n\n');
  const texto = await chamarGemini(montarInstrucao({
    cliente: c.cliente, processo: c.case_number || 'sem número', quando: fmtQuando(quando), polo: c.polo_cliente || 'ativo', contexto,
  }), arquivos);
  return { texto, fontes: [...escolhidos.map((d) => d.name), `${linhasMov.length} movimentações`], foraDoEnvio: deFora.map((d) => d.name) };
}

async function numerosBriefing(): Promise<string[]> {
  const [[cfg]] = await db.query("SELECT setting_value FROM office_settings WHERE setting_key = 'briefing_whatsapp'") as any;
  return String(cfg?.setting_value || '').split(/[,;\s]+/).map((n) => n.replace(/\D/g, '')).filter((n) => n.length >= 10).map((n) => (n.length <= 11 ? '55' + n : n));
}

async function enviarWhatsapp(texto: string): Promise<number> {
  const { sendText } = await import('./uazapiInstance');
  let ok = 0;
  for (const n of await numerosBriefing()) {
    let enviouTudo = true;
    for (const parte of dividirMensagem(texto, 3500)) enviouTudo = (await sendText(n, parte, 'Automático — briefing de audiência').catch(() => false)) && enviouTudo;
    if (enviouTudo) ok++;
  }
  return ok;
}

/** 1 dia antes: um briefing por audiência trabalhista de amanhã (cópias da agenda contam uma vez). */
export async function enviarBriefingsDeAmanha(agora = new Date()) {
  const { inicio, fim } = janelaDeAmanha(agora);
  const [evs] = await db.query(
    `SELECT ce.id, ce.title, ce.start_datetime, ce.location, ce.video_link, ce.case_id,
            COALESCE(ce.client_id, c.client_id) AS client_id, c.legal_area, c.case_number
       FROM calendar_events ce LEFT JOIN cases c ON c.id = ce.case_id
      WHERE ce.event_type = 'audiencia' AND ce.start_datetime >= ? AND ce.start_datetime < ?
        AND COALESCE(ce.sync_status,'') <> 'cancelado'`, [inicio, fim]) as any;
  const res = { enviados: 0, semCaso: [] as string[], falhas: [] as string[] };
  for (const g of agruparAudiencias(evs as any[])) {
    const ev: any = g.evento;
    const ref = `briefing_aud_${g.chave}`;
    const [[ja]] = await db.query('SELECT id FROM sent_reminders WHERE ref_key = ?', [ref]) as any;
    if (ja) continue;
    if (!ev.case_id) { res.semCaso.push(`${ev.title} (${fmtQuando(ev.start_datetime)})`); continue; }
    if (!ehAudienciaTrabalhista(ev)) continue;
    try {
      const local = ev.video_link || ev.location || null;
      const b = await gerarBriefingAudiencia(ev.case_id, ev.start_datetime, local);
      const cabecalho = `⚖️ *Briefing — audiência de amanhã*\n${ev.title}\n${fmtQuando(ev.start_datetime)}${local ? ` · ${local}` : ''}\nProc. ${ev.case_number || '—'}\n_Fontes: ${b.fontes.join(', ')}_\n`;
      const msg = `${cabecalho}\n${b.texto}`;
      await db.query(
        "INSERT INTO documents (client_id, case_id, name, type, folder, data, mime, status, created_by) VALUES (?, ?, ?, 'briefing_audiencia', 'processos', ?, 'text/plain', 'recebido', NULL)",
        [ev.client_id, ev.case_id, `Briefing da audiência de ${fmtQuando(ev.start_datetime)}`, Buffer.from(msg, 'utf8')]);
      await enviarWhatsapp(msg);
      await db.query('INSERT IGNORE INTO sent_reminders (ref_key, channel) VALUES (?, ?)', [ref, 'whatsapp']);
      res.enviados++;
    } catch (e: any) { res.falhas.push(`${ev.title}: ${e?.message || e}`); }
  }
  // Audiência amanhã sem caso ligado: avisa para ligar (não dá para montar briefing sem as fontes).
  if (res.semCaso.length) {
    const ref = `briefing_semcaso_${janelaDeAmanha(agora).inicio.toISOString().slice(0, 10)}`;
    const [[ja]] = await db.query('SELECT id FROM sent_reminders WHERE ref_key = ?', [ref]) as any;
    if (!ja) {
      await enviarWhatsapp(`⚖️ *Audiências de amanhã sem processo ligado no CRM* — não deu para montar o briefing:\n${res.semCaso.map((s) => `• ${s}`).join('\n')}\nSe alguma for trabalhista, ligue o caso ao compromisso na Agenda e peça o briefing na ficha do caso.`);
      await db.query('INSERT IGNORE INTO sent_reminders (ref_key, channel) VALUES (?, ?)', [ref, 'whatsapp']);
    }
  }
  if (res.falhas.length) throw new Error(`Briefing não gerado: ${res.falhas.join(' | ')}`);
  return res;
}
