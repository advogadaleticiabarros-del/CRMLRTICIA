import { db } from '../config/database';
import { montarLote, classificarDocumento, nomePadrao, type AcaoLote, type DocLote, type Lote } from './loteProducao';
import type { ArquivoKit } from './kitProtocolo';
import { retirarSenhaInss } from './senhaInssCliente';

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
  }));
  const [docs] = await db.query(
    `SELECT id, case_id, name, type, mime, LEFT(content, 4000) AS content, (data IS NOT NULL) AS has_data, file_url, versao_de, final_em, created_at
       FROM documents
      WHERE (client_id = ? AND (case_id IS NULL OR case_id IN (?)))
      ORDER BY id`, [clientId, ids.length ? ids : [0]]) as any;
  const documentos: DocLote[] = (docs as any[]).map((d) => ({ ...d, case_id: d.case_id == null ? null : (principalDe.get(d.case_id) ?? d.case_id) }));
  return montarLote({ cliente: cl.name, acoes, documentos });
}

export async function arquivoDoKit(clientId: number, docId: number): Promise<ArquivoKit | null> {
  const [[d]] = await db.query('SELECT data, mime, content FROM documents WHERE id = ? AND client_id = ?', [docId, clientId]) as any;
  return d ? { data: d.data || null, mime: d.mime, content: d.content } : null;
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
