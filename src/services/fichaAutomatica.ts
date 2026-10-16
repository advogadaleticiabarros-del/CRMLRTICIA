/**
 * Ficha automática (16/10/2026): o que o lead ou o cliente manda no WhatsApp
 * (texto, foto, PDF) vira cadastro sozinho. Antes, a leitura de documentos
 * existia mas nunca foi ligada, e a do texto só rodava na etapa "documentação
 * pendente", uma mensagem por vez, exigindo nome e CPF juntos (0 avisos em 60
 * dias). Regras:
 *  - campo VAZIO + leitura confiável → grava sozinho;
 *  - campo vazio + leitura incerta → pendência para a equipe conferir;
 *  - campo JÁ PREENCHIDO com valor diferente → nunca sobrescreve; pendência;
 *  - nome: só troca o nome curto (ex.: o do WhatsApp) pelo nome completo do
 *    documento quando um contém o outro.
 * Regras puras — tests/fichaAutomatica.test.mjs.
 */
import { cpfCnpjValido, normalizarDigitos } from '../utils/cpfCnpj';
import type { Sugestao } from './extracaoDocumentos';

export const CAMPOS_FICHA = [
  'nome', 'cpf', 'rg', 'data_nascimento', 'email', 'estado_civil', 'profissao', 'cep', 'street', 'number', 'neighborhood', 'city', 'state',
] as const;
export type CampoFicha = typeof CAMPOS_FICHA[number];

export const ROTULO_FICHA: Record<CampoFicha, string> = {
  nome: 'nome completo', cpf: 'CPF', rg: 'RG', data_nascimento: 'data de nascimento', email: 'e-mail', estado_civil: 'estado civil',
  profissao: 'profissão', cep: 'CEP', street: 'rua', number: 'número', neighborhood: 'bairro', city: 'cidade', state: 'UF',
};

/** Os mesmos valores do campo "estado civil" da ficha do lead. */
const ESTADOS_CIVIS = ['solteiro', 'casado', 'divorciado', 'viuvo', 'uniao_estavel', 'outro'] as const;
const semAcento = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ── Leitura determinística do texto (não depende de IA) ─────────────────────

/** CPF (só os que passam no dígito verificador), e-mail e CEP escritos nas mensagens. */
export function extrairDoTexto(texto: string): Partial<Record<CampoFicha, string>> {
  const t = String(texto || '');
  const out: Partial<Record<CampoFicha, string>> = {};
  const cpfs = [...t.matchAll(/(?<!\d)(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})(?!\d)/g)].map((m) => m.slice(1).join('')).filter((d) => cpfCnpjValido(d));
  if (new Set(cpfs).size === 1) out.cpf = formatarCpf(cpfs[0]);
  const emails = [...new Set([...t.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)].map((m) => m[0].toLowerCase().replace(/\.$/, '')))];
  if (emails.length === 1) out.email = emails[0];
  // CEP só com a palavra "CEP" perto ou no formato 00000-000 (8 dígitos soltos podem ser outra coisa).
  const cep = t.match(/cep\D{0,6}(\d{5})-?(\d{3})(?!\d)/i) || t.match(/(?<!\d)(\d{5})-(\d{3})(?!\d)/);
  if (cep) out.cep = `${cep[1]}-${cep[2]}`;
  return out;
}

export const formatarCpf = (d: string) => { const x = normalizarDigitos(d); return x.length === 11 ? `${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6, 9)}-${x.slice(9)}` : d; };

// ── Leitura da conversa pela IA ─────────────────────────────────────────────

export function promptFichaConversa(mensagens: string[]): string {
  return `Abaixo estão mensagens que uma pessoa (cliente ou possível cliente) mandou a um escritório de advocacia pelo WhatsApp.
Extraia os DADOS CADASTRAIS DELA MESMA que estiverem escritos. Nunca invente, complete nem deduza.
Ignore dados de outras pessoas (empresa, filhos, ex-cônjuge, testemunhas) e endereços que não sejam o dela.
NUNCA use o nome ou os dados da advogada ou do escritório (Dra. Letícia Elias Barros): quando a pessoa cita a advogada, isso não é o nome dela.
Responda SOMENTE com JSON:
{"campos": {"<campo>": {"valor": "...", "confianca": "alta|baixa"}}}
Campos possíveis: nome (nome completo dela), cpf, rg, data_nascimento (dd/mm/aaaa), email,
estado_civil (${ESTADOS_CIVIS.join('|')}), profissao, cep, street (rua/avenida), number, neighborhood (bairro), city, state (sigla da UF).
Inclua só o que aparece. Use "baixa" se houver dúvida de que o dado é dela ou se estiver incompleto.

MENSAGENS (mais antigas primeiro):
${mensagens.map((m) => `- ${String(m).replace(/\s+/g, ' ').slice(0, 600)}`).join('\n').slice(-14000)}`;
}

const UF_POR_NOME: Record<string, string> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO',
  maranhao: 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG', para: 'PA', paraiba: 'PB', parana: 'PR', pernambuco: 'PE',
  piaui: 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR', 'santa catarina': 'SC',
  'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
};

export interface ValorFicha { valor: string; confianca: 'alta' | 'baixa' }

export function normalizarCampo(campo: CampoFicha, v: any): string | null {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!t || t.toLowerCase() === 'null') return null;
  switch (campo) {
    case 'cpf': { const d = normalizarDigitos(t); return d.length === 11 ? formatarCpf(d) : null; }
    case 'cep': { const d = normalizarDigitos(t); return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : null; }
    case 'state': {
      if (/^[a-z]{2}$/i.test(t)) return t.toUpperCase();
      return UF_POR_NOME[semAcento(t).replace(/^(estado d[eo] |d[eo] )/, '')] || null;
    }
    case 'email': return /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(t) ? t.toLowerCase() : null;
    case 'data_nascimento': {
      const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
    }
    case 'estado_civil': {
      const s = semAcento(t).replace(/\(a\)|\(o\)/g, '').replace(/\s+/g, '_');
      if (s.includes('separad')) return 'outro'; // a ficha não tem "separado"
      const achado = ESTADOS_CIVIS.find((e) => s.startsWith(e.slice(0, 5)) || s.includes(e));
      return achado || (/uniao/.test(s) ? 'uniao_estavel' : null);
    }
    case 'nome': return t.length >= 3 && /[a-zà-ú]/i.test(t) ? t.slice(0, 255) : null;
    default: return t.slice(0, 255);
  }
}

export function parseFichaConversa(s: string): Partial<Record<CampoFicha, ValorFicha>> {
  const limpo = String(s || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!limpo.startsWith('{')) return {};
  let o: any;
  try { o = JSON.parse(limpo); } catch { return {}; }
  const out: Partial<Record<CampoFicha, ValorFicha>> = {};
  for (const c of CAMPOS_FICHA) {
    const b = o?.campos?.[c];
    if (!b) continue;
    const valor = normalizarCampo(c, typeof b === 'object' ? b.valor : b);
    if (!valor) continue;
    out[c] = { valor, confianca: b?.confianca === 'alta' ? 'alta' : 'baixa' };
  }
  return out;
}

// ── Decisão: o que grava sozinho e o que vira pendência ─────────────────────

export interface SugestaoFicha { valor: string; confianca: 'alta' | 'baixa'; fontes: string[]; aviso?: string }
export interface Pendencia { campo: CampoFicha; atual: string | null; sugerido: string; fontes: string[]; motivo: string }

/** Junta as sugestões dos documentos (mesclarExtracoes) com as da conversa. */
export function juntarSugestoes(
  docs: Partial<Record<string, Sugestao>>,
  conversa: Partial<Record<CampoFicha, ValorFicha>>,
  deterministico: Partial<Record<CampoFicha, string>>,
): Partial<Record<CampoFicha, SugestaoFicha>> {
  const out: Partial<Record<CampoFicha, SugestaoFicha>> = {};
  for (const c of CAMPOS_FICHA) {
    const d = docs[c];
    const v = conversa[c];
    const det = deterministico[c];
    const igual = (a?: string, b?: string) => !!a && !!b && chave(c, a) === chave(c, b);
    if (d) {
      // Documento manda; a conversa só confirma ou levanta divergência.
      const conflito = (v && !igual(d.valor, v.valor)) || (det && !igual(d.valor, det));
      out[c] = { valor: d.valor, confianca: d.confianca === 'alta' && !conflito ? 'alta' : 'baixa', fontes: [...d.fontes, ...(v && igual(d.valor, v.valor) ? ['conversa'] : [])],
        aviso: d.aviso || (conflito ? `a conversa diz "${v?.valor || det}"` : undefined) };
    } else if (det) {
      // CPF/e-mail/CEP escritos e validados: confiáveis mesmo sem a IA.
      out[c] = { valor: det, confianca: !v || igual(det, v.valor) ? 'alta' : 'baixa', fontes: ['conversa'], aviso: v && !igual(det, v.valor) ? 'a IA leu outro valor' : undefined };
    } else if (v) {
      out[c] = { valor: v.valor, confianca: v.confianca, fontes: ['conversa'] };
    }
  }
  return out;
}

export function chave(campo: CampoFicha, v: string): string {
  if (['cpf', 'rg', 'cep', 'number'].includes(campo)) return normalizarDigitos(v) || semAcento(v);
  return semAcento(v).replace(/[^a-z0-9@.]+/g, ' ').trim();
}

const tokens = (s: string) => semAcento(s).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w && !['de', 'da', 'do', 'dos', 'das', 'e'].includes(w));

/** O nome atual é um pedaço do nome completo (ex.: "Maria" ou "Maria Souza" → "Maria Aparecida de Souza")? */
export function nomeMaisCompleto(atual: string, novo: string): boolean {
  const a = tokens(atual), n = tokens(novo);
  return n.length > a.length && a.length > 0 && a.every((w) => n.includes(w)) && a[0] === n[0];
}

/** Nome da advogada/escritório: o cliente cita ("a Dra. Letícia Elias Barros") e a IA pode confundir. */
const NOME_DO_ESCRITORIO = /\bleticia\b.*\bbarros\b|\bbarros\b.*\bleticia\b|advocacia|advogad/;

/**
 * Tira o que é do ESCRITÓRIO, e não do cliente (visto em produção em 16/10/2026):
 *  - o nome da Dra. Letícia como "nome completo" do cliente;
 *  - CPF, e-mail e CEP que o próprio escritório escreveu na conversa (chave Pix
 *    da Dra., e-mail do escritório, endereço do escritório). Se o escritório só
 *    repetiu um dado do cliente, a perda é deixar o campo vazio, nunca gravar errado.
 */
export function removerDadosDoEscritorio(
  sugestoes: Partial<Record<CampoFicha, SugestaoFicha>>, textoDoEscritorio: string,
): Partial<Record<CampoFicha, SugestaoFicha>> {
  const out = { ...sugestoes };
  if (out.nome && NOME_DO_ESCRITORIO.test(semAcento(out.nome.valor))) delete out.nome;
  const doEscritorio = extrairTodos(textoDoEscritorio);
  for (const c of ['cpf', 'email', 'cep'] as const) {
    if (out[c] && doEscritorio[c].has(chave(c, out[c]!.valor))) delete out[c];
  }
  return out;
}

/** Todos os CPFs, e-mails e CEPs de um texto (para saber o que o escritório escreveu). */
function extrairTodos(texto: string): Record<'cpf' | 'email' | 'cep', Set<string>> {
  const t = String(texto || '');
  return {
    cpf: new Set([...t.matchAll(/(?<!\d)(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})(?!\d)/g)].map((m) => m.slice(1).join(''))),
    email: new Set([...t.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)].map((m) => chave('email', m[0].replace(/\.$/, '')))),
    cep: new Set([...t.matchAll(/(?<!\d)(\d{5})-?(\d{3})(?!\d)/g)].map((m) => m[1] + m[2])),
  };
}

/**
 * O documento é do contato? (RG do marido ou certidão do filho não podem virar a ficha.)
 * Só recusa quando dá para julgar: o contato tem nome e sobrenome e nenhum
 * pedaço bate com o nome do documento. Nome curto do WhatsApp ("Maria", "Mãe") aceita.
 */
export function documentoDoContato(nomeContato: string | null | undefined, nomeDocumento: string | null | undefined): boolean {
  if (!nomeDocumento || !nomeContato) return true;
  const c = tokens(nomeContato), d = tokens(nomeDocumento);
  if (c.length < 2 || !d.length) return true;
  return c.some((w) => d.includes(w));
}

export function decidir(atual: Partial<Record<CampoFicha, string | null>>, sugestoes: Partial<Record<CampoFicha, SugestaoFicha>>, camposDoAlvo: readonly CampoFicha[]) {
  const gravar: Partial<Record<CampoFicha, string>> = {};
  const pendencias: Pendencia[] = [];
  for (const c of camposDoAlvo) {
    const s = sugestoes[c];
    if (!s) continue;
    const agora = String(atual[c] ?? '').trim();
    if (agora && chave(c, agora) === chave(c, s.valor)) continue; // já está certo
    if (c === 'nome') {
      // O nome do WhatsApp ("Maria") vira o completo ("Maria Aparecida de Souza");
      // nome diferente nunca troca sozinho.
      if (!agora || nomeMaisCompleto(agora, s.valor)) {
        if (s.confianca === 'alta') gravar.nome = s.valor;
        else pendencias.push({ campo: c, atual: agora || null, sugerido: s.valor, fontes: s.fontes, motivo: 'nome completo a confirmar' });
      } else pendencias.push({ campo: c, atual: agora, sugerido: s.valor, fontes: s.fontes, motivo: 'nome diferente do cadastro' });
      continue;
    }
    if (agora) { pendencias.push({ campo: c, atual: agora, sugerido: s.valor, fontes: s.fontes, motivo: 'o cadastro tem outro valor' }); continue; }
    if (c === 'cpf' && !cpfCnpjValido(s.valor)) { pendencias.push({ campo: c, atual: null, sugerido: s.valor, fontes: s.fontes, motivo: 'CPF não confere no dígito verificador' }); continue; }
    if (s.confianca === 'alta') gravar[c] = s.valor;
    else pendencias.push({ campo: c, atual: null, sugerido: s.valor, fontes: s.fontes, motivo: s.aviso || 'leitura incerta' });
  }
  return { gravar, pendencias };
}

export function resumoFicha(nome: string, gravados: CampoFicha[], pendencias: Pendencia[]): string {
  return [
    gravados.length ? `📇 Ficha de *${nome}* completada sozinha: ${gravados.map((c) => ROTULO_FICHA[c]).join(', ')}.` : `📇 Ficha de *${nome}*:`,
    pendencias.length ? `Para conferir (${pendencias.length}): ${pendencias.map((p) => `${ROTULO_FICHA[p.campo]} (${p.motivo})`).join('; ')}. Veja em Escritório virtual → Dra. Camila.` : '',
  ].filter(Boolean).join('\n');
}
