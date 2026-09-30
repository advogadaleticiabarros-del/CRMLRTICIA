/**
 * Lê os documentos recebidos por WhatsApp de um contato e devolve SUGESTÕES
 * para o cadastro (lead ou cliente) — nunca grava sozinho. `aplicarDados`
 * grava só os campos que a advogada confirmou na tela.
 * Regras de leitura/mescla em `extracaoDocumentos.ts`.
 */
import { db } from '../config/database';
import { aiExtractFromFile } from './aiAssistant';
import { PROMPT_EXTRACAO, parseExtracao, mesclarExtracoes, CAMPOS_EXTRAIDOS, type CampoExtraido } from './extracaoDocumentos';

const MAX_ARQUIVOS = 6;
const MAX_BYTES = 8 * 1024 * 1024;
const LEAD_COL: Record<CampoExtraido, string> = {
  nome: 'name', cpf: 'cpf_cnpj', rg: 'rg', data_nascimento: 'birth_date', cep: 'cep', street: 'street',
  number: 'number', neighborhood: 'neighborhood', city: 'city', state: 'state',
};

const telLike = (phone: string) => `%${phone.replace(/\D/g, '').slice(-8)}`;
const SEM_MASCARA = "REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''),'(',''),')',''),'-',''),' ','')";

async function alvoDoTelefone(phone: string): Promise<{ tipo: 'client' | 'lead'; row: any } | null> {
  const [[cl]] = await db.query(`SELECT id, name, cpf_cnpj, birth_date, address FROM clients WHERE ${SEM_MASCARA} LIKE ? LIMIT 1`, [telLike(phone)]) as any;
  if (cl) return { tipo: 'client', row: cl };
  const [[ld]] = await db.query(
    `SELECT id, name, cpf_cnpj, rg, birth_date, cep, street, number, neighborhood, city, state FROM leads
      WHERE ${SEM_MASCARA} LIKE ? ORDER BY id DESC LIMIT 1`, [telLike(phone)]) as any;
  return ld ? { tipo: 'lead', row: ld } : null;
}

function valoresAtuais(alvo: { tipo: 'client' | 'lead'; row: any }): Partial<Record<CampoExtraido, string>> {
  const r = alvo.row;
  const d = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : '');
  if (alvo.tipo === 'client') return { nome: r.name || '', cpf: r.cpf_cnpj || '', data_nascimento: d(r.birth_date), street: r.address || '' };
  const out: Partial<Record<CampoExtraido, string>> = {};
  for (const c of CAMPOS_EXTRAIDOS) out[c] = c === 'data_nascimento' ? d(r[LEAD_COL[c]]) : (r[LEAD_COL[c]] || '');
  return out;
}

export async function lerDadosDosDocumentos(phone: string) {
  const alvo = await alvoDoTelefone(phone);
  if (!alvo) return { erro: 'Este número não é cliente nem lead — cadastre primeiro.' };
  const [midias] = await db.query(
    `SELECT id, file_name, mime, data FROM whatsapp_media
      WHERE phone LIKE ? AND (mime LIKE 'image/%' OR mime = 'application/pdf')
      ORDER BY created_at DESC LIMIT ?`, [telLike(phone), MAX_ARQUIVOS]) as any;
  if (!midias.length) return { erro: 'Nenhuma foto ou PDF recebido deste contato.' };

  const lidas: { fonte: string; r: ReturnType<typeof parseExtracao> }[] = [];
  const falhas: string[] = [];
  for (const m of midias) {
    const fonte = m.file_name || `arquivo ${m.id}`;
    if (!m.data || m.data.length > MAX_BYTES) { falhas.push(`${fonte} (grande demais)`); continue; }
    const r = await aiExtractFromFile(Buffer.from(m.data).toString('base64'), m.mime, PROMPT_EXTRACAO);
    const parsed = r.ok && r.text ? parseExtracao(r.text) : null;
    if (!parsed) { falhas.push(fonte); continue; }
    lidas.push({ fonte, r: parsed });
  }
  return {
    alvo: { tipo: alvo.tipo, id: alvo.row.id, nome: alvo.row.name },
    atuais: valoresAtuais(alvo),
    sugestoes: mesclarExtracoes(lidas),
    lidos: lidas.map((l) => ({ fonte: l.fonte, tipo: l.r?.tipo })),
    falhas,
  };
}

/** Grava SOMENTE os campos confirmados. Cliente: endereço vira uma linha só. */
export async function aplicarDados(phone: string, campos: Partial<Record<CampoExtraido, string>>): Promise<{ ok: boolean; erro?: string; gravados?: string[] }> {
  const alvo = await alvoDoTelefone(phone);
  if (!alvo) return { ok: false, erro: 'Contato não encontrado' };
  const validos = Object.fromEntries(
    Object.entries(campos).filter(([k, v]) => (CAMPOS_EXTRAIDOS as readonly string[]).includes(k) && String(v ?? '').trim())
      .map(([k, v]) => [k, String(v).trim().slice(0, 255)])
  ) as Partial<Record<CampoExtraido, string>>;
  if (validos.data_nascimento && !/^\d{4}-\d{2}-\d{2}$/.test(validos.data_nascimento)) return { ok: false, erro: 'Data de nascimento inválida' };
  const sets: string[] = []; const params: any[] = [];
  if (alvo.tipo === 'lead') {
    for (const [c, v] of Object.entries(validos)) { sets.push(`${LEAD_COL[c as CampoExtraido]} = ?`); params.push(v); }
  } else {
    if (validos.nome) { sets.push('name = ?'); params.push(validos.nome); }
    if (validos.cpf) { sets.push('cpf_cnpj = ?'); params.push(validos.cpf); }
    if (validos.data_nascimento) { sets.push('birth_date = ?'); params.push(validos.data_nascimento); }
    const end = [
      [validos.street, validos.number].filter(Boolean).join(', '),
      validos.neighborhood,
      [validos.city, validos.state].filter(Boolean).join('/'),
      validos.cep ? `CEP ${validos.cep}` : '',
    ].filter(Boolean).join(' - ');
    if (end) { sets.push('address = ?'); params.push(end); }
  }
  if (!sets.length) return { ok: false, erro: 'Nenhum campo marcado' };
  params.push(alvo.row.id);
  await db.query(`UPDATE ${alvo.tipo === 'lead' ? 'leads' : 'clients'} SET ${sets.join(', ')} WHERE id = ?`, params);
  return { ok: true, gravados: Object.keys(validos) };
}
