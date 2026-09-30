/**
 * Leitura de dados dos documentos recebidos (RG, CNH, CTPS, comprovante) →
 * SUGESTÕES por campo para o cadastro. Regras puras (sem I/O):
 *  - `parseExtracao`: valida e normaliza a resposta JSON da IA de UM documento;
 *  - `mesclarExtracoes`: junta vários documentos, guardando a fonte de cada
 *    dado e marcando "baixa" confiança quando a IA não tem certeza, quando os
 *    documentos divergem ou quando o CPF não passa no dígito verificador.
 * Nada aqui grava: a advogada confere e escolhe o que entra (tela de confirmação).
 */
import { cpfCnpjValido, normalizarDigitos } from '../utils/cpfCnpj';

export const CAMPOS_EXTRAIDOS = [
  'nome', 'cpf', 'rg', 'data_nascimento', 'cep', 'street', 'number', 'neighborhood', 'city', 'state',
] as const;
export type CampoExtraido = typeof CAMPOS_EXTRAIDOS[number];

export const ROTULO_CAMPO: Record<CampoExtraido, string> = {
  nome: 'Nome completo', cpf: 'CPF', rg: 'RG', data_nascimento: 'Data de nascimento',
  cep: 'CEP', street: 'Rua', number: 'Número', neighborhood: 'Bairro', city: 'Cidade', state: 'UF',
};

export const PROMPT_EXTRACAO = `Você está lendo UM documento pessoal brasileiro (RG, CNH, CPF, CTPS, comprovante de residência ou outro).
Responda SOMENTE com JSON, sem texto fora dele:
{"tipo_documento": "RG|CNH|CPF|CTPS|comprovante_residencia|outro",
 "campos": { "<campo>": {"valor": "...", "confianca": "alta|baixa"} }}
Campos possíveis: ${CAMPOS_EXTRAIDOS.join(', ')}.
Inclua SOMENTE campos que estão escritos no documento. NUNCA invente, complete ou deduza.
Use confianca "baixa" se a leitura estiver borrada, cortada ou incerta.
data_nascimento em dd/mm/aaaa. state = sigla da UF.`;

export interface ValorLido { valor: string; confianca: 'alta' | 'baixa' }
export interface Extracao { tipo: string; campos: Partial<Record<CampoExtraido, ValorLido>> }

function normalizar(campo: CampoExtraido, v: string): string | null {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  switch (campo) {
    case 'cpf': {
      const d = normalizarDigitos(t);
      return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : t;
    }
    case 'cep': {
      const d = normalizarDigitos(t);
      return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : t;
    }
    case 'state': return /^[a-z]{2}$/i.test(t) ? t.toUpperCase() : null;
    case 'data_nascimento': {
      const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) || null;
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
      return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
    }
    default: return t.slice(0, 255);
  }
}

export function parseExtracao(texto: string): Extracao | null {
  const limpo = String(texto || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!limpo.startsWith('{')) return null;
  let o: any;
  try { o = JSON.parse(limpo); } catch { return null; }
  if (!o || typeof o.campos !== 'object') return null;
  const campos: Extracao['campos'] = {};
  for (const c of CAMPOS_EXTRAIDOS) {
    const bruto = o.campos[c];
    if (!bruto) continue;
    const valor = normalizar(c, typeof bruto === 'object' ? bruto.valor : bruto);
    if (!valor) continue;
    campos[c] = { valor, confianca: bruto?.confianca === 'alta' ? 'alta' : 'baixa' };
  }
  return { tipo: String(o.tipo_documento || 'outro').slice(0, 40), campos };
}

export interface Sugestao {
  valor: string;
  confianca: 'alta' | 'baixa';
  fontes: string[];
  alternativas: { valor: string; fontes: string[] }[];
  aviso?: string;
}

const chave = (campo: CampoExtraido, v: string) =>
  campo === 'cpf' || campo === 'rg' || campo === 'cep' ? normalizarDigitos(v) || v.toLowerCase()
    : v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function mesclarExtracoes(lidas: { fonte: string; r: Extracao | null }[]): Partial<Record<CampoExtraido, Sugestao>> {
  const out: Partial<Record<CampoExtraido, Sugestao>> = {};
  for (const campo of CAMPOS_EXTRAIDOS) {
    const grupos = new Map<string, { valor: string; fontes: string[]; incerto: boolean }>();
    for (const { fonte, r } of lidas) {
      const v = r?.campos[campo];
      if (!v) continue;
      const k = chave(campo, v.valor);
      const g = grupos.get(k) ?? { valor: v.valor, fontes: [], incerto: false };
      g.fontes.push(fonte);
      g.incerto = g.incerto || v.confianca === 'baixa';
      grupos.set(k, g);
    }
    if (!grupos.size) continue;
    const ordenados = [...grupos.values()].sort((a, b) => b.fontes.length - a.fontes.length);
    const [melhor, ...resto] = ordenados;
    let aviso: string | undefined;
    if (campo === 'cpf' && !cpfCnpjValido(melhor.valor)) aviso = 'CPF não confere no dígito verificador — confira no documento';
    else if (resto.length) aviso = 'Documentos trazem valores diferentes';
    else if (melhor.incerto) aviso = 'Leitura incerta';
    out[campo] = {
      valor: melhor.valor,
      confianca: aviso ? 'baixa' : 'alta',
      fontes: melhor.fontes,
      alternativas: resto.map((g) => ({ valor: g.valor, fontes: g.fontes })),
      ...(aviso ? { aviso } : {}),
    };
  }
  return out;
}
