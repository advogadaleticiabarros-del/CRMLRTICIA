import { db } from '../config/database';
import { aiComplete, aiLerArquivo } from './aiAssistant';
import { sendText } from './uazapiInstance';
import { registrarAcaoAgente } from './usoIa';
import { NUMERO_DRA } from './esteiraComercialServico';
import {
  promptLeituraCritica, parseLeituraCritica, promptFatosDaHistoria, parseFatos, cruzar, promptCruzamentoLivre, parseApontamentosIa,
  relatorioAnalise, mensagemAnaliseDra, pedidosDeReenvio, mensagemReenvio, comoLerDocumento, lidoPelaAnalise, type LeituraDoc,
} from './analistaDocumentos';
import { downloadDriveFile } from './partnerInboxService';
import { idDoArquivoNoDrive } from './kitProtocolo';

/**
 * Dra. Helena com banco, IA e WhatsApp (regras em analistaDocumentos.ts).
 * Lê todos os arquivos do cliente (WhatsApp e documentos do CRM), cruza com a
 * história contada, grava o relatório nos documentos do caso e avisa a Dra.
 * Ao cliente, só o pedido neutro de reenvio (ilegível, cortado, comprovante antigo).
 */

const MAX_ARQUIVOS = 15;
const MAX_BYTES = 8 * 1024 * 1024;
const fim8 = (p: string | null | undefined) => String(p || '').replace(/\D/g, '').slice(-8);
const foneWa = (p: string | null | undefined) => {
  let d = String(p || '').replace(/\D/g, '');
  if (d && d.length <= 11) d = '55' + d;
  return d.length >= 12 ? d : null;
};

interface Arquivo { ref: string; fonte: string; mime: string; tam: number; carregar: () => Promise<Buffer | null> }

async function arquivosDoCliente(clientId: number, caseId: number, phone: string | null): Promise<Arquivo[]> {
  const out: Arquivo[] = [];
  const [midias] = await db.query(
    `SELECT id, file_name, mime, LENGTH(data) AS tam FROM whatsapp_media
      WHERE (client_id = ? OR (? <> '' AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 8) = ?))
        AND (mime LIKE 'image/%' OR mime = 'application/pdf')
      ORDER BY created_at DESC LIMIT ?`, [clientId, fim8(phone), fim8(phone), MAX_ARQUIVOS]).catch(() => [[]]) as any;
  for (const m of midias) {
    out.push({ ref: `media:${m.id}`, fonte: m.file_name || `arquivo ${m.id}`, mime: m.mime, tam: Number(m.tam) || 0,
      carregar: async () => { const [[r]] = await db.query('SELECT data FROM whatsapp_media WHERE id = ?', [m.id]) as any; return r?.data ? Buffer.from(r.data) : null; } });
  }
  // Guardados no CRM ou só com o link do Drive (pasta do caso): os do Drive são baixados na leitura.
  const [docs] = await db.query(
    `SELECT id, name, mime, LENGTH(data) AS tam, (data IS NOT NULL) AS tem_arquivo, file_url FROM documents
      WHERE (client_id = ? OR case_id = ?) AND (data IS NOT NULL OR file_url LIKE '%drive.google.com%')
      ORDER BY created_at DESC LIMIT ?`, [clientId, caseId, MAX_ARQUIVOS * 3]).catch(() => [[]]) as any;
  let n = 0;
  for (const d of docs) {
    const como = comoLerDocumento(d);
    if (!como || n >= MAX_ARQUIVOS) continue;
    n++;
    const a: Arquivo = { ref: `doc:${d.id}`, fonte: d.name || `documento ${d.id}`, mime: d.mime, tam: Number(d.tam) || 0, carregar: async () => null };
    if (como === 'guardado') {
      a.carregar = async () => { const [[r]] = await db.query('SELECT data FROM documents WHERE id = ?', [d.id]) as any; return r?.data ? Buffer.from(r.data) : null; };
    } else {
      a.carregar = async () => {
        const id = idDoArquivoNoDrive(d.file_url);
        const f = id ? await downloadDriveFile(id).catch(() => null) : null;
        if (!f || !lidoPelaAnalise(f.mimeType)) return null;
        a.mime = f.mimeType;
        return Buffer.from(f.base64, 'base64');
      };
    }
    out.push(a);
  }
  return out.slice(0, MAX_ARQUIVOS * 2);
}

/** Lê o arquivo uma vez só (cache em documento_leituras). */
async function lerArquivo(a: Arquivo): Promise<LeituraDoc | null> {
  const [[c]] = await db.query('SELECT leitura FROM documento_leituras WHERE ref = ?', [a.ref]) as any;
  if (c) return typeof c.leitura === 'string' ? JSON.parse(c.leitura) : c.leitura;
  if (a.tam > MAX_BYTES) return null;
  const buf = await a.carregar();
  if (!buf || buf.length > MAX_BYTES) return null;
  const r = await aiLerArquivo(buf.toString('base64'), a.mime, promptLeituraCritica());
  const l = r.ok && r.text ? parseLeituraCritica(r.text) : null;
  if (l) await db.query('INSERT IGNORE INTO documento_leituras (ref, fonte, leitura) VALUES (?, ?, ?)', [a.ref, a.fonte.slice(0, 255), JSON.stringify(l)]);
  return l;
}

/** A história contada: relato da Dra. Camila, resumo do atendimento e as falas do cliente no WhatsApp. */
async function historiaDoCliente(caseId: number, clientId: number, phone: string | null): Promise<string> {
  const partes: string[] = [];
  const [[rel]] = await db.query(
    `SELECT d.content FROM coletas_documentos cd JOIN documents d ON d.id = cd.relato_doc_id WHERE cd.case_id = ?`, [caseId]).catch(() => [[null]]) as any;
  if (rel?.content) partes.push(`RELATO DO CLIENTE:\n${rel.content}`);
  const [[cs]] = await db.query('SELECT title, description FROM cases WHERE id = ?', [caseId]).catch(() => [[null]]) as any;
  if (cs?.description) partes.push(`RESUMO DO CASO: ${cs.description}`);
  const [leads] = await db.query('SELECT case_summary, notes FROM leads WHERE client_id = ? ORDER BY id DESC LIMIT 2', [clientId]).catch(() => [[]]) as any;
  for (const l of leads) partes.push([l.case_summary, l.notes].filter(Boolean).join('\n'));
  if (phone) {
    const [msgs] = await db.query(
      `SELECT body FROM whatsapp_messages WHERE from_me = 0 AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 8) = ? AND body <> ''
        ORDER BY msg_time ASC LIMIT 300`, [fim8(phone)]).catch(() => [[]]) as any;
    if (msgs.length) partes.push(`FALAS DO CLIENTE NO WHATSAPP:\n${msgs.map((m: any) => `- ${String(m.body).replace(/\s+/g, ' ').slice(0, 500)}`).join('\n')}`);
  }
  return partes.filter((p) => p.trim()).join('\n\n');
}

async function marcar(ref: string, marco: string): Promise<boolean> {
  const [r] = await db.query('INSERT IGNORE INTO esteira_avisos (ref, marco) VALUES (?, ?)', [ref, marco]) as any;
  return r.affectedRows === 1;
}

export async function analisarCaso(caseId: number, opts: { avisar?: boolean; pedirReenvio?: boolean; etapa?: (rotulo: string, feito?: number | null, total?: number | null) => void } = {}) {
  const avisar = opts.avisar !== false, pedirReenvio = opts.pedirReenvio !== false;
  // Andamento para a barra da tela (30/10/2026); nunca derruba a análise.
  const andamento = (r: string, f?: number | null, t?: number | null) => { try { opts.etapa?.(r, f, t); } catch { /* só a barra */ } };
  const [[c]] = await db.query(
    `SELECT cs.id, cs.client_id, cl.name, cl.cpf_cnpj, cl.phone FROM cases cs JOIN clients cl ON cl.id = cs.client_id WHERE cs.id = ?`, [caseId]) as any;
  if (!c) return { ok: false as const, erro: 'Caso não encontrado' };

  const arquivos = await arquivosDoCliente(c.client_id, c.id, c.phone);
  if (!arquivos.length) return { ok: false as const, erro: 'O cliente ainda não mandou nenhuma foto ou PDF.' };
  const docs: Array<{ fonte: string; l: LeituraDoc }> = [];
  const falhas: string[] = [];
  // A leitura dos arquivos é a maior parte do tempo: ocupa até 80% da barra.
  const total = arquivos.length + 2;
  for (const [i, a] of arquivos.entries()) {
    andamento(`Lendo ${a.fonte} (${i + 1} de ${arquivos.length})`, i, total);
    const l = await lerArquivo(a).catch(() => null);
    if (l) docs.push({ fonte: a.fonte, l }); else falhas.push(a.fonte);
  }
  if (!docs.length) {
    const doDrive = arquivos.filter((a) => a.tam === 0).length;
    return { ok: false as const, erro: doDrive
      ? `Não consegui ler nenhum dos ${arquivos.length} arquivos (${doDrive} estão só no Google Drive). Confira se a pasta do cliente está compartilhada com a conta Google do CRM.`
      : `Não consegui ler nenhum dos ${arquivos.length} arquivos do cliente (grandes demais ou ilegíveis). Conferir à mão.` };
  }

  andamento('Conferindo os documentos com a história contada', arquivos.length, total);
  const historia = await historiaDoCliente(c.id, c.client_id, c.phone);
  let fatos = {};
  if (historia.trim()) {
    const r = await aiComplete(promptFatosDaHistoria(historia), 'openai');
    if (r.ok && r.text) fatos = parseFatos(r.text);
  }
  const achados = cruzar({ cadastro: { nome: c.name, cpf: c.cpf_cnpj }, fatos, docs, hoje: new Date() });
  if (historia.trim() && docs.length) {
    const r = await aiComplete(promptCruzamentoLivre(historia, docs, achados), 'openai');
    if (r.ok && r.text) achados.push(...parseApontamentosIa(r.text));
  }
  for (const f of falhas) achados.push({ nivel: 'info', tema: 'não lido', texto: `${f}: não consegui ler (arquivo grande demais ou formato ruim). Conferir à mão.`, fontes: [f] });

  andamento('Salvando a análise', arquivos.length + 1, total);
  const relatorio = relatorioAnalise(c.name, achados, docs.map((d) => ({ fonte: d.fonte, tipo: d.l.tipo })));
  const [[admin]] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1") as any;
  const [doc] = await db.query(
    `INSERT INTO documents (client_id, case_id, name, type, folder, content, status, created_by) VALUES (?, ?, ?, 'ia', 'processos', ?, 'pendente', ?)`,
    [c.client_id, c.id, `Análise dos documentos — ${c.name}`, relatorio, admin?.id ?? null]) as any;
  const graves = achados.filter((a) => a.nivel === 'grave').length, atencao = achados.filter((a) => a.nivel === 'atencao').length;
  await db.query(
    'INSERT INTO analises_documentos (case_id, client_id, documentos, graves, atencao, achados, relatorio_doc_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [c.id, c.client_id, docs.length, graves, atencao, JSON.stringify(achados), doc.insertId]);

  if (avisar) await sendText(NUMERO_DRA, mensagemAnaliseDra(c.name, achados), 'Agente Dra. Helena').catch(() => false);
  const pedidos = pedidosDeReenvio(achados);
  const fone = foneWa(c.phone);
  const dia = new Date().toISOString().slice(0, 10);
  if (pedirReenvio && pedidos.length && fone && await marcar(`analise:${c.id}`, `reenvio_${dia}`)) {
    // Nunca envia sozinho (19/10/2026): vira rascunho para a equipe aprovar.
    await import('./aprovacaoMensagens').then((m) => m.prepararParaAprovacao({ agente: 'analista', phone: fone, clientId: c.client_id, nome: c.name,
      texto: mensagemReenvio(c.name, pedidos), contexto: `A Dra. Helena analisou os documentos do caso nº ${c.id}: ${pedidos.length} precisam ser reenviados (ilegível, cortado ou comprovante antigo).` })).catch(() => null);
  }
  registrarAcaoAgente('analista', `analisou ${docs.length} documento(s) de ${c.name}: ${graves} grave(s), ${atencao} de atenção`);
  return { ok: true as const, documentos: docs.length, graves, atencao, achados, relatorioDocId: doc.insertId };
}

/** Coleta concluída e chegou arquivo novo depois da última análise: analisa de novo. */
export async function reanalisarComNovos(limite = 3) {
  const [casos] = await db.query(
    `SELECT cd.case_id, cl.phone, (SELECT MAX(a.created_at) FROM analises_documentos a WHERE a.case_id = cd.case_id) AS ultima
       FROM coletas_documentos cd JOIN clients cl ON cl.id = cd.client_id
      WHERE cd.concluido_em IS NOT NULL AND cd.case_id IS NOT NULL AND cd.concluido_em >= NOW() - INTERVAL 120 DAY`) as any;
  let feitas = 0;
  for (const c of casos) {
    if (feitas >= limite) break;
    const desde = c.ultima || '1970-01-01';
    const [[novo]] = await db.query(
      `SELECT (SELECT COUNT(*) FROM whatsapp_media m WHERE m.created_at > ? AND (m.mime LIKE 'image/%' OR m.mime = 'application/pdf')
                 AND (m.client_id = (SELECT client_id FROM cases WHERE id = ?) OR (? <> '' AND RIGHT(REGEXP_REPLACE(m.phone, '[^0-9]', ''), 8) = ?)))
            + (SELECT COUNT(*) FROM documents d WHERE d.created_at > ? AND d.data IS NOT NULL AND d.case_id = ?) AS n`,
      [desde, c.case_id, fim8(c.phone), fim8(c.phone), desde, c.case_id]) as any;
    if (!Number(novo?.n)) continue;
    const r = await analisarCaso(c.case_id).catch((e) => ({ ok: false, erro: e?.message }));
    if (r.ok) feitas++;
  }
  return { reanalisados: feitas };
}

export async function analisesRecentes() {
  const [analises] = await db.query(
    `SELECT a.id, a.case_id, a.documentos, a.graves, a.atencao, a.achados, a.relatorio_doc_id, a.created_at, cl.name AS cliente, cs.title AS caso
       FROM analises_documentos a JOIN cases cs ON cs.id = a.case_id JOIN clients cl ON cl.id = a.client_id
      ORDER BY a.created_at DESC LIMIT 20`).catch(() => [[]]) as any;
  const [casos] = await db.query(
    `SELECT cs.id, cs.title, cl.name AS cliente FROM cases cs JOIN clients cl ON cl.id = cs.client_id
      WHERE cs.status <> 'encerrado' ORDER BY cs.created_at DESC LIMIT 60`).catch(() => [[]]) as any;
  return { analises, casos };
}
