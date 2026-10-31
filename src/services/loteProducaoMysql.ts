import { db } from '../config/database';
import { contratosSalvos } from './esteiraPecaMysql';
import { montarLote, classificarDocumento, nomePadrao, type AcaoLote, type DocLote, type Lote } from './loteProducao';
import { sintetizarCaso } from './sinteseCaso';
import { fontesDaSintese } from './sinteseCasoMysql';
import { textoDoDocx, idDoArquivoNoDrive, type ArquivoKit } from './kitProtocolo';
import { downloadDriveFile } from './partnerInboxService';
import { retirarSenhaInss } from './senhaInssCliente';
import { validarParagrafos, formatarPeca, docxNoTimbrado, textoDosParagrafos, paragrafosDoTexto } from './papelTimbrado';

/**
 * Banco do card único do cliente (regras em loteProducao.ts).
 * Ações: os casos do cliente na produção (sem os pedidos unidos a outro processo, que
 * contam como o processo principal), menos os recusados e os protocolados há mais de 60 dias.
 */

export async function carregarLote(clientId: number): Promise<Lote | null> {
  const [[cl]] = await db.query('SELECT id, name FROM clients WHERE id = ?', [clientId]) as any;
  if (!cl) return null;
  const [casos] = await db.query(
    `SELECT id, title, production_stage, case_number, legal_area, unido_ao_caso
       FROM cases
      WHERE client_id = ? AND production_stage IS NOT NULL AND production_stage <> 'recusado'
        AND (production_stage NOT IN ('protocolado','concluido') OR protocoled_at IS NULL OR protocoled_at >= DATE_SUB(NOW(), INTERVAL 60 DAY))
      ORDER BY id`, [clientId]) as any;
  const principais = (casos as any[]).filter((c) => !c.unido_ao_caso);
  const principalDe = new Map<number, number>((casos as any[]).map((c) => [c.id, c.unido_ao_caso || c.id]));
  const ids = (casos as any[]).map((c) => c.id);
  const [partes] = ids.length
    ? await db.query("SELECT case_id, nome, cpf_cnpj FROM case_partes WHERE papel = 'contraria' AND case_id IN (?)", [ids]) as any
    : [[]];
  const acoes: AcaoLote[] = principais.map((c) => ({
    id: c.id, titulo: c.title, production_stage: c.production_stage, case_number: c.case_number, legal_area: c.legal_area,
    partes: (partes as any[]).filter((p) => principalDe.get(p.case_id) === c.id).map((p) => ({ nome: p.nome, cpf_cnpj: p.cpf_cnpj })),
    unidos: (casos as any[]).filter((u) => u.unido_ao_caso === c.id).map((u) => ({ id: u.id, titulo: u.title })),
  }));
  const [docs] = await db.query(
    `SELECT id, case_id, name, type, mime, LEFT(content, 4000) AS content, (data IS NOT NULL) AS has_data, file_url, versao_de, final_em, created_at,
            COALESCE(drive_md5, IF(data IS NULL, NULL, MD5(data))) AS md5, duplicado_de
       FROM documents
      WHERE (client_id = ? AND (case_id IS NULL OR case_id IN (?)))
      ORDER BY id`, [clientId, ids.length ? ids : [0]]) as any;
  const documentos: DocLote[] = (docs as any[]).map((d) => ({ ...d, case_id: d.case_id == null ? null : (principalDe.get(d.case_id) ?? d.case_id) }));
  // Contrato posto num pedido unido conta na ação principal.
  const salvos = (await contratosSalvos(clientId).catch(() => []))
    .map((c) => ({ ...c, case_id: c.case_id == null ? null : (principalDe.get(c.case_id) ?? c.case_id) }));
  const lote = montarLote({ cliente: cl.name, acoes, documentos, contratos: salvos });
  // "Sobre o caso" do cliente inteiro, pelo que foi lido (31/10/2026): nunca a descrição de uma ação só.
  const fontes = await fontesDaSintese(clientId, ids).catch(() => ({ ficha: null, relatoCliente: null, origem: null }));
  lote.sintese = sintetizarCaso({
    cliente: cl.name, contratos: salvos, ...fontes,
    acoes: lote.acoes.map((a) => ({ id: a.id, reu: a.reu, titulo: a.titulo, familia: a.familia, situacao: a.situacao })),
  });
  return lote;
}

/** Arquivo do kit: o guardado no CRM ou, se o documento veio do Google Drive (só o link), baixado de lá na hora. */
export async function arquivoDoKit(clientId: number, docId: number): Promise<ArquivoKit | null> {
  const [[d]] = await db.query('SELECT data, mime, content, file_url FROM documents WHERE id = ? AND client_id = ?', [docId, clientId]) as any;
  if (!d) return null;
  if (d.data) return { data: d.data, mime: d.mime, content: d.content };
  const idDrive = idDoArquivoNoDrive(d.file_url);
  if (idDrive) {
    const f = await downloadDriveFile(idDrive).catch(() => null);
    if (f) return { data: Buffer.from(f.base64, 'base64'), mime: f.mimeType, content: d.content };
  }
  return { data: null, mime: d.mime, content: d.content };
}

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_PECA = 15 * 1024 * 1024;

/**
 * A Dra. revisou a peça fora do CRM e envia a versão final (Word ou PDF): vira a versão
 * seguinte da petição da ação, já marcada como final (as outras deixam de ser), e é ela
 * que vai no kit, como veio. Do Word, o texto é lido para a revisão e a conferência.
 */
export type PecaFinal = { paragrafos: unknown } | { nome: string; base64: string; mime: string };

export async function enviarVersaoFinal(e: { clientId: number; caseId: number; userId: number; autor: string } & PecaFinal): Promise<{ id: number; nome: string }> {
  const [[c]] = await db.query('SELECT c.id, cl.name AS cliente FROM cases c JOIN clients cl ON cl.id = c.client_id WHERE c.id = ? AND c.client_id = ?', [e.caseId, e.clientId]) as any;
  if (!c) throw Object.assign(new Error('Ação não encontrada neste cliente'), { status: 404 });
  let data: Buffer, texto: string, mime: string, origem: string, nomeOriginal: string | null = null;
  if ('paragrafos' in e) {
    // Colada na tela: vira o .docx no papel timbrado, na formatação das peças.
    let ps;
    try { ps = validarParagrafos(e.paragrafos); } catch (err: any) { throw Object.assign(new Error(err.message), { status: 400 }); }
    data = await docxNoTimbrado(formatarPeca(ps));
    texto = textoDosParagrafos(ps); mime = MIME_DOCX; origem = 'colada pela Dra. e posta no papel timbrado';
  } else {
    const ehPdf = e.mime === 'application/pdf' || /\.pdf$/i.test(e.nome);
    const ehDocx = e.mime === MIME_DOCX || /\.docx$/i.test(e.nome);
    if (!ehPdf && !ehDocx) throw Object.assign(new Error('Envie a peça em Word (.docx) ou PDF'), { status: 400 });
    data = Buffer.from(String(e.base64).replace(/^data:[^,]*,/, ''), 'base64');
    if (!data.length) throw Object.assign(new Error('Arquivo vazio'), { status: 400 });
    if (data.length > MAX_PECA) throw Object.assign(new Error('Arquivo maior que 15 MB'), { status: 400 });
    const lido = ehDocx ? await textoDoDocx(data) : null;
    if (ehDocx && !lido) throw Object.assign(new Error('Não consegui ler esse Word. Confira se é um .docx'), { status: 400 });
    texto = lido ?? '[Versão final enviada em PDF pela Dra.: o texto está no arquivo.]';
    mime = ehPdf ? 'application/pdf' : MIME_DOCX; origem = `enviada pela Dra. (${ehPdf ? 'PDF' : 'Word'})`; nomeOriginal = e.nome.slice(0, 255);
  }
  const [irmas] = await db.query("SELECT id, name FROM documents WHERE case_id = ? AND name LIKE 'Petição Inicial%' ORDER BY id DESC", [e.caseId]) as any;
  const n = Math.max(0, ...(irmas as any[]).map((d) => Number(String(d.name).match(/\(v(\d+)/)?.[1] || 1))) + 1;
  const nome = `Petição Inicial — ${c.cliente} (v${n} · versão final da Dra.)`;
  await db.query("UPDATE documents SET final_em = NULL WHERE case_id = ? AND name LIKE 'Petição Inicial%'", [e.caseId]);
  const [ins] = await db.query(
    `INSERT INTO documents (client_id, case_id, name, type, folder, content, data, mime, status, created_by, versao_de, final_em, nome_original)
     VALUES (?, ?, ?, 'peca', 'processos', ?, ?, ?, 'pendente', ?, ?, NOW(), ?)`,
    [e.clientId, e.caseId, nome, texto, data, mime, e.userId, (irmas as any[])[0]?.id ?? null, nomeOriginal]) as any;
  await db.query("INSERT INTO production_notes (case_id, user_id, author_name, kind, text) VALUES (?, ?, ?, 'atualizacao', ?)",
    [e.caseId, e.userId, e.autor, `Versão final ${origem}: ${nome}. É ela que vai no kit de protocolo.`]).catch(() => {});
  return { id: ins.insertId, nome };
}

/** A peça da ação para baixar: a versão final (como foi guardada) ou a mais nova, no papel timbrado. */
export async function pecaParaBaixar(clientId: number, caseId: number): Promise<{ data: Buffer; nome: string; mime: string } | null> {
  const lote = await carregarLote(clientId);
  const a = lote?.acoes.find((x) => x.id === caseId);
  if (!lote || !a?.peca) return null;
  const [[d]] = await db.query('SELECT data, mime, content FROM documents WHERE id = ? AND client_id = ?', [a.peca.docId, clientId]) as any;
  if (!d) return null;
  const base = `Petição inicial - ${lote.cliente} x ${a.reu || 'caso ' + a.id} (v${a.peca.versao}${a.peca.final ? ' final' : ''})`.replace(/[\\/:*?"<>|]+/g, ' ');
  if (d.data && (d.mime === MIME_DOCX || d.mime === 'application/pdf')) return { data: d.data, mime: d.mime, nome: `${base}.${d.mime === MIME_DOCX ? 'docx' : 'pdf'}` };
  if (!d.content) return null;
  return { data: await docxNoTimbrado(formatarPeca(paragrafosDoTexto(d.content))), mime: MIME_DOCX, nome: `${base}.docx` };
}

/** Dá o nome padrão aos documentos do cliente; o nome de chegada fica em nome_original. */
export async function padronizarNomes(clientId: number): Promise<{ renomeados: number }> {
  const [[cl]] = await db.query('SELECT name FROM clients WHERE id = ?', [clientId]) as any;
  if (!cl) return { renomeados: 0 };
  const [docs] = await db.query(
    'SELECT id, name, type, mime, LEFT(content, 4000) AS content FROM documents WHERE client_id = ? AND nome_original IS NULL', [clientId]) as any;
  let renomeados = 0;
  const usados = new Map<string, number>();
  for (const d of docs as any[]) {
    const novo = nomePadrao(classificarDocumento(d), cl.name, d.name, d.mime);
    if (!novo || novo === d.name) continue;
    const n = (usados.get(novo) || 0) + 1; usados.set(novo, n);
    const final = n > 1 ? novo.replace(/(\.[a-z0-9]+)?$/i, (ext) => ` (${n})${ext}`) : novo;
    await db.query('UPDATE documents SET nome_original = name, name = ? WHERE id = ? AND client_id = ?', [final, d.id, clientId]);
    renomeados++;
  }
  return { renomeados };
}

/**
 * Tira a senha do Meu INSS dos textos do card (observação e descrição) e guarda no cofre
 * do cliente, se o cofre está vazio ou já tem a mesma senha. Senha diferente da do cofre:
 * não mexe e avisa (a equipe decide qual vale).
 */
export async function guardarSenhasDosCards(clientId?: number): Promise<{ movidas: number; divergentes: number[] }> {
  const [casos] = await db.query(
    `SELECT id, client_id, production_obs, description FROM cases
      WHERE (production_obs REGEXP '[Ss][Ee][Nn][Hh][Aa].{0,12}[Ii][Nn][Ss][Ss]' OR description REGEXP '[Ss][Ee][Nn][Hh][Aa].{0,12}[Ii][Nn][Ss][Ss]')
        ${clientId ? 'AND client_id = ?' : ''}`, clientId ? [clientId] : []) as any;
  let movidas = 0; const divergentes: number[] = [];
  for (const c of casos as any[]) {
    if (!c.client_id) continue;
    const obs = retirarSenhaInss(c.production_obs || ''), desc = retirarSenhaInss(c.description || '');
    const senha = obs.senha || desc.senha;
    if (!senha) continue;
    const [[cred]] = await db.query('SELECT senha_inss FROM client_credentials WHERE client_id = ?', [c.client_id]) as any;
    if (cred?.senha_inss && cred.senha_inss !== senha) { divergentes.push(c.id); continue; }
    if (!cred?.senha_inss) {
      await db.query(
        'INSERT INTO client_credentials (client_id, senha_inss) VALUES (?, ?) ON DUPLICATE KEY UPDATE senha_inss = VALUES(senha_inss)', [c.client_id, senha]);
    }
    await db.query('UPDATE cases SET production_obs = ?, description = ? WHERE id = ?',
      [c.production_obs == null ? null : obs.texto, c.description == null ? null : desc.texto, c.id]);
    movidas++;
  }
  return { movidas, divergentes };
}
