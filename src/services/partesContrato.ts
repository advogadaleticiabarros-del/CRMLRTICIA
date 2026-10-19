/**
 * Contrato com mais de um contratante (19/10/2026): a Sandra e o marido, Daniel,
 * no mesmo processo. Um contrato em nome dos dois e, para cada um, a própria
 * procuração e a própria declaração. Os dados vêm da CONVERSA (ela mandou os
 * dos dois): antes o contrato só lia a ficha do lead e ignorava a 2ª pessoa.
 * Regras puras — tests/partesContrato.test.mjs.
 */
import { cpfCnpjValido, normalizarDigitos } from '../utils/cpfCnpj';
import type { PartyData } from './contractTemplates';

export interface PessoaConversa {
  nome: string; cpf: string | null; rg: string | null; estado_civil: string | null; profissao: string | null;
  nacionalidade: string | null; endereco: string | null; email: string | null; telefone: string | null;
  relacao: string | null; cpfValido: boolean;
}

export function promptPessoasDaConversa(mensagens: string[]): string {
  return `Abaixo estão mensagens que um cliente mandou a um escritório de advocacia pelo WhatsApp.
Liste TODAS as pessoas cujos dados pessoais o cliente mandou para o contrato (por exemplo, ele mesmo e o cônjuge, sócio ou familiar que também será representado).
Extraia SOMENTE o que está escrito; nunca invente nem complete. O que não aparece fica null.
NUNCA inclua a advogada ou o escritório (Dra. Letícia Elias Barros), nem a parte contrária (empresa, réu, autor da ação contra o cliente).
Responda SOMENTE com JSON:
{"pessoas":[{"nome":"nome completo","cpf":"...","rg":"...","estado_civil":"...","profissao":"...","nacionalidade":"...","endereco":"endereço completo com CEP","email":"...","telefone":"...","relacao":"titular|conjuge|familiar|socio|outro"}]}

MENSAGENS (mais antigas primeiro):
${mensagens.map((m) => `- ${String(m).replace(/\s+/g, ' ').slice(0, 700)}`).join('\n').slice(-16000)}`;
}

const txt = (v: any) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.replace(/\s+/g, ' ').trim().slice(0, 255) : null);
const fmtCpf = (d: string) => `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;

export function parsePessoas(s: string): PessoaConversa[] {
  const limpo = String(s || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!limpo.startsWith('{')) return [];
  let o: any;
  try { o = JSON.parse(limpo); } catch { return []; }
  const lista = Array.isArray(o?.pessoas) ? o.pessoas : [];
  const out: PessoaConversa[] = [];
  for (const p of lista) {
    const nome = txt(p?.nome);
    if (!nome || /leticia\b.*\bbarros|advocacia|advogad/i.test(nome.normalize('NFD').replace(/[̀-ͯ]/g, ''))) continue;
    const d = normalizarDigitos(txt(p?.cpf) || '');
    const cpfValido = d.length === 11 && cpfCnpjValido(d);
    out.push({
      nome, cpf: d.length === 11 ? fmtCpf(d) : txt(p?.cpf), rg: txt(p?.rg), estado_civil: txt(p?.estado_civil), profissao: txt(p?.profissao),
      nacionalidade: txt(p?.nacionalidade), endereco: txt(p?.endereco), email: txt(p?.email)?.toLowerCase() || null, telefone: txt(p?.telefone),
      relacao: txt(p?.relacao), cpfValido,
    });
  }
  // A mesma pessoa citada duas vezes (mesmo CPF ou mesmo nome) vira uma só.
  const vistos = new Set<string>();
  return out.filter((p) => { const k = normalizarDigitos(p.cpf || '') || chaveNome(p.nome); if (vistos.has(k)) return false; vistos.add(k); return true; });
}

const chaveNome = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w && !['de', 'da', 'do', 'dos', 'das', 'e'].includes(w)).join(' ');

/** Quem é o titular (o cliente do contrato) e quem são os outros contratantes. */
export function separarPartes(titular: { nome: string | null; cpf: string | null }, pessoas: PessoaConversa[]): { titular: PessoaConversa | null; outros: PessoaConversa[] } {
  const cpfT = normalizarDigitos(titular.cpf || '');
  const nomeT = chaveNome(titular.nome || '');
  const ehTitular = (p: PessoaConversa) => {
    const d = normalizarDigitos(p.cpf || '');
    if (cpfT.length === 11 && d.length === 11) return d === cpfT;
    const n = chaveNome(p.nome);
    return !!nomeT && (n === nomeT || (n.split(' ')[0] === nomeT.split(' ')[0] && n.split(' ').slice(-1)[0] === nomeT.split(' ').slice(-1)[0]));
  };
  const t = pessoas.find(ehTitular) || null;
  return { titular: t, outros: pessoas.filter((p) => p !== t) };
}

/** Pessoa da conversa → dados de parte do contrato (procuração e declaração). */
export function paraParte(p: { nome: string; cpf?: string | null; profissao?: string | null; nacionalidade?: string | null; endereco?: string | null; email?: string | null; telefone?: string | null; estado_civil?: string | null }): PartyData {
  return { name: p.nome, cpf: p.cpf || null, profissao: p.profissao || null, nacionalidade: p.nacionalidade || null, endereco: p.endereco || null, email: p.email || null, phone: p.telefone || null, estadoCivil: p.estado_civil || null };
}

/**
 * Contrato de um contratante → contrato dos dois (ou mais):
 *  - "CONTRATANTE: <A>." vira "CONTRATANTES: <A>; e <B>, doravante denominados, em conjunto, CONTRATANTE.";
 *  - a assinatura de cada contratante extra entra logo depois da do titular.
 * As cláusulas seguem dizendo "CONTRATANTE" (o conjunto). Contrato de menor
 * (representante legal) não é alterado: devolve `alterado: false`.
 */
export function aplicarCoContratantes(texto: string, extras: Array<{ qualificacao: string; nome: string; cpf: string | null }>): { texto: string; alterado: boolean } {
  if (!extras.length) return { texto, alterado: false };
  const cab = texto.match(/^CONTRATANTE: (.+)\.$/m);
  if (!cab) return { texto, alterado: false };
  let t = texto.replace(cab[0], `CONTRATANTES: ${cab[1]}; e ${extras.map((e) => e.qualificacao).join('; e ')}, doravante denominados, em conjunto, CONTRATANTE.`);
  const assinaturas = extras.map((e) => `_______________________________________\n${e.nome}\nCONTRATANTE\nCPF nº ${e.cpf || '[CPF]'}`).join('\n\n');
  const doTitular = t.match(/_{10,}\n[^\n]+\nCONTRATANTE\n(?:CPF nº [^\n]*)?/);
  if (doTitular) t = t.replace(doTitular[0], `${doTitular[0].replace(/\n$/, '')}\n\n${assinaturas}\n`);
  else {
    const daContratada = t.match(/_{10,}\n[^\n]+\nCONTRATADA/);
    t = daContratada ? t.replace(daContratada[0], `${assinaturas}\n\n${daContratada[0]}`) : `${t}\n\n${assinaturas}`;
  }
  return { texto: t, alterado: true };
}
