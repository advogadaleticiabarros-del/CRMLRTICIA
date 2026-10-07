/**
 * Dados para a proposta, lidos do que o contato escreveu no WhatsApp — regras puras.
 *
 * Duas fontes, nesta ordem de confiança:
 *  1. lerDadosRotulados: o que vem rotulado na mensagem ("Nome completo: …",
 *     "CPF: …") ou é inconfundível (CPF, e-mail, CEP) — sem IA, não falha;
 *  2. a leitura por IA (feita por quem chama), que completa o resto
 *     (rua/número/bairro/cidade separados, estado civil, profissão).
 * camposParaPreencher decide o que entra no lead: só campo vazio; o que
 * diverge da ficha é devolvido para avisar, nunca sobrescrito.
 */

export interface DadosConversa {
  nome_completo?: string; cpf?: string; email?: string; cep?: string; endereco?: string;
  street?: string; number?: string; neighborhood?: string; city?: string; state?: string;
  marital_status?: string; profession?: string;
}

const limpar = (v: string) => v.replace(/\s+/g, ' ').trim();
const fmtCpf = (d: string) => d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

function rotulo(texto: string, nomes: string[]): string | undefined {
  for (const n of nomes) {
    const m = texto.match(new RegExp(`^[\\s\\-•*]*${n}\\s*[:：]\\s*(.+)$`, 'im'));
    if (m && limpar(m[1])) return limpar(m[1]);
  }
  return undefined;
}

export function lerDadosRotulados(texto: string): DadosConversa {
  const t = String(texto || '');
  const d: DadosConversa = {};
  const nome = rotulo(t, ['nome completo', 'nome']);
  if (nome && /[a-zà-ú]{2,}\s+[a-zà-ú]{2,}/i.test(nome)) d.nome_completo = nome;

  const cpf = (rotulo(t, ['cpf']) || '').replace(/\D/g, '') || (t.match(/\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/)?.[1] || '').replace(/\D/g, '');
  if (cpf.length === 11) d.cpf = fmtCpf(cpf);

  const email = t.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/);
  if (email) d.email = email[0].toLowerCase();

  const cep = t.match(/\bCEP[:\s]*(\d{2})\.?(\d{3})-?(\d{3})\b/i) || t.match(/\b(\d{2})\.?(\d{3})-(\d{3})\b/);
  if (cep) d.cep = `${cep[1]}${cep[2]}-${cep[3]}`;

  const end = rotulo(t, ['endereço completo', 'endereco completo', 'endereço', 'endereco']);
  if (end) d.endereco = end;

  const ec = rotulo(t, ['estado civil']);
  if (ec) {
    const e = ec.toLowerCase();
    d.marital_status = /uni[aã]o/.test(e) ? 'uniao_estavel' : /casad/.test(e) ? 'casado' : /divorc|separad/.test(e) ? 'divorciado' : /vi[uú]v/.test(e) ? 'viuvo' : /solteir/.test(e) ? 'solteiro' : 'outro';
  }
  const prof = rotulo(t, ['profissão', 'profissao']);
  if (prof) d.profession = prof;
  return d;
}

/** Junta as duas leituras: o rotulado (certo) vence; a IA completa os campos que faltam. */
export function juntarDados(rotulados: DadosConversa, ia: DadosConversa): DadosConversa {
  const r: DadosConversa = {};
  for (const fonte of [ia || {}, rotulados || {}]) {
    for (const [k, v] of Object.entries(fonte)) if (typeof v === 'string' && v.trim()) (r as any)[k] = v.trim();
  }
  return r;
}

const MAPA: Record<string, keyof DadosConversa> = {
  cpf_cnpj: 'cpf', email: 'email', cep: 'cep', street: 'street', number: 'number', neighborhood: 'neighborhood',
  city: 'city', state: 'state', marital_status: 'marital_status', profession: 'profession',
};
const comparavel = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\W/g, '').toLowerCase();

/** O que completar no lead (só campos vazios) e o que diverge do que já está na ficha. */
export function camposParaPreencher(lead: Record<string, any>, dados: DadosConversa) {
  const preencher: Record<string, string> = {};
  const divergencias: { campo: string; ficha: string; conversa: string }[] = [];
  for (const [col, chave] of Object.entries(MAPA)) {
    const novo = dados[chave];
    if (!novo) continue;
    const atual = lead[col];
    if (atual == null || String(atual).trim() === '') preencher[col] = col === 'state' ? novo.slice(0, 2).toUpperCase() : novo;
    else if (['cpf_cnpj', 'email', 'number', 'cep'].includes(col) && comparavel(atual) !== comparavel(novo)) {
      divergencias.push({ campo: col, ficha: String(atual), conversa: novo });
    }
  }
  return { preencher, divergencias };
}
