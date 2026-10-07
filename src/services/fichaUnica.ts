/**
 * Uma pessoa = uma ficha (07/10/2026, pedido "unifique as fichas, sempre").
 *
 * Toda rotina que cria cliente (publicações/DJEN, e-mail, dativo, parceria,
 * proposta aceita, contrato, lead/atendimento convertido, conferência de
 * processo) passa por encontrarOuCriarCliente: se a pessoa já tem ficha, usa
 * a mesma e só completa o que estiver vazio; processos novos entram nessa ficha.
 *
 * Quem é "a mesma pessoa" (escolherFichaExistente, regra pura):
 *  1. mesmo CPF/CNPJ;
 *  2. mesmo nome (sem acento/maiúscula/pontuação), se o CPF não diverge;
 *  3. mesmo telefone (8 últimos dígitos) E mesmo primeiro nome;
 *  4. mesmo e-mail.
 */
import { db } from '../config/database';

export interface FichaResumo { id: number; name: string; cpf_cnpj?: string | null; phone?: string | null; email?: string | null }
export interface DadosPessoa { nome: string; cpf?: string | null; phone?: string | null; email?: string | null }

export const normalizarNome = (s: unknown) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const digitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const tel8 = (s: unknown) => { const d = digitos(s); return d.length >= 8 ? d.slice(-8) : ''; };
const primeiro = (s: unknown) => normalizarNome(s).split(' ')[0] || '';

export function escolherFichaExistente(fichas: FichaResumo[], p: DadosPessoa): FichaResumo | null {
  const cpf = digitos(p.cpf);
  if (cpf.length >= 11) {
    const porCpf = fichas.find((f) => digitos(f.cpf_cnpj) === cpf);
    if (porCpf) return porCpf;
  }
  const nome = normalizarNome(p.nome);
  if (nome) {
    const porNome = fichas.find((f) => normalizarNome(f.name) === nome && !(cpf.length >= 11 && digitos(f.cpf_cnpj).length >= 11 && digitos(f.cpf_cnpj) !== cpf));
    if (porNome) return porNome;
  }
  const t = tel8(p.phone);
  if (t) {
    const porTel = fichas.find((f) => tel8(f.phone) === t && primeiro(f.name) === primeiro(p.nome));
    if (porTel) return porTel;
  }
  const em = String(p.email || '').trim().toLowerCase();
  if (em.includes('@')) {
    const porEmail = fichas.find((f) => String(f.email || '').trim().toLowerCase() === em);
    if (porEmail) return porEmail;
  }
  return null;
}

const EMPRESA = /\b(LTDA|S\.?\s?A\.?|EIRELI|ME|EPP|MEI|CIA|COMERCIO|SERVICOS|INDUSTRIA|CONDOMINIO|ASSOCIACAO)\b/;
/** O "nome" junta várias pessoas? (ex.: "FULANA; BELTRANA", "FULANO e CICLANA"). Empresa não conta. */
export function ehVariasPessoas(nome: string): boolean {
  const n = normalizarNome(nome);
  if (EMPRESA.test(n)) return false;
  if (/;/.test(nome)) return true;
  const partes = String(nome).split(/,|\s+e\s+/i).map((x) => normalizarNome(x)).filter(Boolean);
  // cada parte precisa parecer um nome próprio (2+ palavras, ou 1 palavra em lista com vírgula)
  return partes.length > 1 && (partes.filter((x) => x.split(' ').length >= 2).length >= 2 || /,/.test(nome));
}

export interface NovaFicha {
  nome: string; tipo?: 'PF' | 'PJ'; cpf?: string | null; email?: string | null; phone?: string | null;
  address?: string | null; notes?: string | null; createdBy?: number | null; isDative?: boolean;
}

/**
 * Devolve a ficha da pessoa: a existente (completando só campos vazios) ou
 * uma nova. Nome com várias pessoas juntas é recusado — quem chama decide
 * (separar os nomes ou pedir revisão).
 */
export async function encontrarOuCriarCliente(n: NovaFicha): Promise<{ id: number; criado: boolean }> {
  const nome = String(n.nome || '').trim().slice(0, 255);
  if (!nome) throw new Error('Nome do cliente vazio');
  if (ehVariasPessoas(nome)) throw new Error(`"${nome}" junta mais de uma pessoa — cadastre cada uma separadamente`);
  const [fichas] = await db.query('SELECT id, name, cpf_cnpj, phone, email FROM clients') as any;
  const achada = escolherFichaExistente(fichas, { nome, cpf: n.cpf, phone: n.phone, email: n.email });
  if (achada) {
    await db.query(
      `UPDATE clients SET cpf_cnpj = COALESCE(NULLIF(cpf_cnpj,''), ?), email = COALESCE(NULLIF(email,''), ?),
              phone = COALESCE(NULLIF(phone,''), ?), address = COALESCE(NULLIF(address,''), ?)${n.isDative ? ', is_dative = 1' : ''} WHERE id = ?`,
      [n.cpf || null, n.email || null, n.phone || null, n.address || null, achada.id]);
    return { id: achada.id, criado: false };
  }
  const [ins] = await db.query(
    `INSERT INTO clients (name, tipo, cpf_cnpj, email, phone, address, status, notes, created_by, is_dative)
     VALUES (?, ?, ?, ?, ?, ?, 'ativo', ?, ?, ?)`,
    [nome, n.tipo === 'PJ' ? 'PJ' : 'PF', n.cpf || null, n.email || null, n.phone || null, n.address || null,
     n.notes || null, n.createdBy ?? null, n.isDative ? 1 : 0]) as any;
  return { id: ins.insertId, criado: true };
}

/**
 * Une a ficha `de` na ficha `para`: move tudo que aponta para `de` (processos,
 * casos, financeiro, documentos, conversas…), completa campos vazios de
 * `para`, junta as observações e apaga `de`.
 */
export async function unirFichas(de: number, para: number): Promise<{ movidos: Record<string, number> }> {
  if (de === para) throw new Error('Mesma ficha');
  const [[a]] = await db.query('SELECT * FROM clients WHERE id = ?', [de]) as any;
  const [[b]] = await db.query('SELECT * FROM clients WHERE id = ?', [para]) as any;
  if (!a || !b) throw new Error('Ficha não encontrada');
  const [ts] = await db.query(
    "SELECT table_name AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'client_id' AND table_name <> 'clients'") as any;
  const movidos: Record<string, number> = {};
  for (const { t } of ts) {
    const [r] = await db.query(`UPDATE IGNORE \`${t}\` SET client_id = ? WHERE client_id = ?`, [para, de]) as any;
    if (r.affectedRows) movidos[t] = r.affectedRows;
    await db.query(`DELETE FROM \`${t}\` WHERE client_id = ?`, [de]).catch(() => {}); // sobra só o que colidiu (ex.: 1 por cliente)
  }
  const campos = ['cpf_cnpj', 'email', 'phone', 'address', 'birth_date'].filter((c) => c in b);
  // birth_date é DATE: NULLIF(data, '') dá erro no MySQL estrito — só COALESCE.
  const sets = campos.map((c) => (c === 'birth_date' ? `${c} = COALESCE(${c}, ?)` : `${c} = COALESCE(NULLIF(${c}, ''), ?)`)).join(', ');
  const nota = [b.notes, a.notes ? `[Unificada da ficha #${de} "${a.name}" em ${new Date().toLocaleDateString('pt-BR')}] ${a.notes}` : `[Unificada da ficha #${de} "${a.name}"]`].filter(Boolean).join('\n');
  await db.query(`UPDATE clients SET ${sets}${sets ? ', ' : ''}notes = ?${a.is_dative ? ', is_dative = 1' : ''} WHERE id = ?`,
    [...campos.map((c) => a[c] || null), nota, para]);
  await db.query('DELETE FROM clients WHERE id = ?', [de]);
  return { movidos };
}
