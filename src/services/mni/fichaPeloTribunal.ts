/**
 * Completa a ficha do cliente com os dados que o próprio tribunal devolve
 * (MNI, dados básicos do processo): CPF/CNPJ, nascimento e endereço.
 *
 * Regras (18/11/2026):
 *  - só preenche campo VAZIO; nunca sobrescreve o que a equipe gravou;
 *  - só quando o nome da ficha é IGUAL (sem acento/caixa/pontuação) ao de
 *    exatamente uma parte do processo — nome parecido não basta, e o mesmo
 *    nome com documentos diferentes (homônimo) não completa nada;
 *  - CPF/CNPJ só entra se os dígitos verificadores conferem.
 */
import type { ParteMni } from './cliente';

export interface FichaAtual { name: string; cpf_cnpj: string | null; birth_date: string | Date | null; address: string | null }
export interface Complemento { cpf_cnpj?: string; birth_date?: string; address?: string }

export const normalizarNomeParte = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function cpfValido(c: string): boolean {
  if (!/^\d{11}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  for (const t of [9, 10]) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(c[t])) return false;
  }
  return true;
}

export function cnpjValido(c: string): boolean {
  if (!/^\d{14}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((a, p, i) => a + Number(c[i]) * p, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

const formatarDoc = (d: string) => (d.length === 11
  ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  : `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`);

const vazio = (v: unknown) => v == null || (typeof v === 'string' && !v.trim());

export function dadosParaCompletar(ficha: FichaAtual, partes: ParteMni[]): Complemento {
  const alvo = normalizarNomeParte(ficha.name);
  if (!alvo) return {};
  const iguais = partes.filter((p) => normalizarNomeParte(p.nome) === alvo);
  if (!iguais.length) return {};
  const docs = new Set(iguais.map((p) => p.documento).filter(Boolean));
  if (docs.size > 1) return {}; // mesmo nome, pessoas diferentes
  const p = iguais.find((x) => x.documento) || iguais[0];
  const out: Complemento = {};
  const doc = p.documento || '';
  if (vazio(ficha.cpf_cnpj) && (cpfValido(doc) || cnpjValido(doc))) out.cpf_cnpj = formatarDoc(doc);
  if (p.tipoPessoa !== 'juridica') {
    if (vazio(ficha.birth_date) && p.dataNascimento && /^\d{4}-\d{2}-\d{2}$/.test(p.dataNascimento) && p.dataNascimento > '1900') out.birth_date = p.dataNascimento;
    if (vazio(ficha.address) && p.endereco) out.address = p.endereco.slice(0, 255);
  }
  return out;
}

export interface ParteResumida { polo: 'ativo' | 'passivo' | 'terceiro' | 'outro'; nome: string; tipo: 'fisica' | 'juridica' | null }

const POLOS: Record<string, ParteResumida['polo']> = { AT: 'ativo', PA: 'passivo', TC: 'terceiro' };
const ORDEM_POLO = ['ativo', 'passivo', 'terceiro', 'outro'];

/**
 * Lista das partes para mostrar no processo: só polo, nome e tipo de pessoa.
 * CPF, nascimento e endereço ficam de fora (vão só para a ficha do cliente,
 * pela regra de `dadosParaCompletar`).
 */
export function resumoDasPartes(partes: ParteMni[]): ParteResumida[] {
  const vistos = new Set<string>();
  const out: ParteResumida[] = [];
  for (const p of partes) {
    const nome = String(p.nome || '').trim();
    if (!nome) continue;
    const polo = POLOS[String(p.polo || '').toUpperCase()] || 'outro';
    const chave = `${polo}|${normalizarNomeParte(nome)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const t = String(p.tipoPessoa || '').toLowerCase();
    out.push({ polo, nome: nome.slice(0, 200), tipo: t.startsWith('fis') ? 'fisica' : t.startsWith('jur') ? 'juridica' : null });
  }
  return out.sort((a, b) => ORDEM_POLO.indexOf(a.polo) - ORDEM_POLO.indexOf(b.polo));
}
