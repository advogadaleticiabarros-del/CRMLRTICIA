/**
 * Partes do processo — regras puras. Quem está do outro lado (parte
 * contrária), testemunhas e perito ficam no caso, nunca no cadastro de
 * clientes. O caso também diz de que lado o cliente está (polo ativo = autor,
 * passivo = réu), para não confundir defesa com ação proposta.
 */

export const PAPEIS: Record<string, string> = {
  contraria: 'Parte contrária', testemunha: 'Testemunha', perito: 'Perito', outro: 'Outro interessado',
};
export const POLOS: Record<string, string> = { ativo: 'Autor / reclamante', passivo: 'Réu / reclamado' };

export interface Parte {
  papel: string; nome: string; cpf_cnpj: string | null; endereco: string | null;
  email: string | null; advogado: string | null; advogado_oab: string | null;
}

const so = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const txt = (v: unknown, max = 255) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max) || null;

function formatarDoc(v: unknown): string | null {
  const d = so(v);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return txt(v, 20);
}

export function validarParte(b: any): { erro: string | null; dados: Parte } {
  const dados: Parte = {
    papel: PAPEIS[b?.papel] ? String(b.papel) : 'contraria',
    nome: (txt(b?.nome) || '').toUpperCase(),
    cpf_cnpj: formatarDoc(b?.cpf_cnpj),
    endereco: txt(b?.endereco, 500),
    email: txt(b?.email)?.toLowerCase() ?? null,
    advogado: txt(b?.advogado),
    advogado_oab: txt(b?.advogado_oab, 30)?.replace(/\s+/g, '').toUpperCase() ?? null,
  };
  return { erro: dados.nome ? null : 'Informe o nome da parte', dados };
}

const nomeNorm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** A parte informada é o próprio cliente do caso? (mesmo CPF/CNPJ ou mesmo nome) */
export function ehParteDoCliente(parte: { cpf_cnpj?: string | null; nome?: string }, cliente: { cpf_cnpj?: string | null; name?: string }): boolean {
  const a = so(parte.cpf_cnpj), b = so(cliente.cpf_cnpj);
  if (a && b) return a === b;
  return !!parte.nome && nomeNorm(parte.nome) === nomeNorm(cliente.name);
}
