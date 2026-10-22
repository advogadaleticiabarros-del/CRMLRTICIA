/**
 * Quando pedidos do mesmo cliente viram UM processo (regra da Jessica, 22/10/2026):
 * mesmo cliente + mesma área + mesmo réu + mesma FAMÍLIA DE TESE, antes do protocolo.
 * - cartão consignado: RMC e RCC;
 * - empréstimo consignado: um ou vários contratos, refinanciamento e portabilidade;
 * - empréstimo pessoal;
 * - cartão comum (anuidade, cartão não solicitado).
 * Famílias diferentes nunca juntam, mesmo contra o mesmo banco (teses muito diferentes).
 * Juros abusivos são pedido dentro da peça da família, não processo à parte.
 * O sistema SUGERE; a Dra. confirma (cases.unido_ao_caso).
 */

export interface Parte { nome?: string | null; cpf_cnpj?: string | null }

export type Familia = 'cartao_consignado' | 'emprestimo_consignado' | 'emprestimo_pessoal' | 'cartao_comum';

export const NOME_FAMILIA: Record<Familia, string> = {
  cartao_consignado: 'Cartão consignado (RMC/RCC)',
  emprestimo_consignado: 'Empréstimo consignado',
  emprestimo_pessoal: 'Empréstimo pessoal',
  cartao_comum: 'Cartão de crédito comum',
};

export interface CasoParaJuntar {
  id: number; client_id: number | null; legal_area: string | null;
  production_stage: string | null; partes: Parte[]; familia?: Familia | null;
}

export const ETAPAS_ANTES_DO_PROTOCOLO = ['em_analise', 'separacao_documentos', 'criacao_inicial', 'revisao_inicial', 'aguardando_protocolo'];

const semAcento = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Família da tese pelo título/descrição do pedido. Sem certeza: null (nunca junta sozinho). */
export function familiaDaTese(texto: string | null | undefined): Familia | null {
  const t = semAcento(texto || '');
  if (!t.trim()) return null;
  if (/\brmc\b|\brcc\b|reserva de margem|cartao (de credito )?consignado|cartao benef/.test(t)) return 'cartao_consignado';
  if (/emprestimo pessoal|credito pessoal|\bcdc\b|credito direto/.test(t)) return 'emprestimo_pessoal';
  if (/consignado|refinanciamento|\brefin\b|portabilidade/.test(t)) return 'emprestimo_consignado';
  if (/cartao|anuidade/.test(t)) return 'cartao_comum';
  return null;
}

/** Réu escrito no título: depois de "—", "-", "x", "×" ou "contra". */
export function reuDoTitulo(titulo: string | null | undefined): string | null {
  const partes = String(titulo || '').split(/\s+[—–-]\s+|\s+[x×]\s+|\s+contra\s+/i);
  if (partes.length < 2) return null;
  const r = partes[partes.length - 1].trim();
  return r.length >= 2 && r.length <= 80 ? r : null;
}

const RUIDO = new Set(['banco', 'sa', 's', 'a', 'ltda', 'me', 'epp', 'eireli', 'cia', 'companhia', 'de', 'do', 'da', 'dos', 'das', 'e']);

export function normalizarNomeParte(nome: string | null | undefined): string {
  return semAcento(nome || '')
    .replace(/s\s*[./]\s*a\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !RUIDO.has(w))
    .join(' ');
}

/** Os 8 primeiros dígitos do CNPJ identificam a empresa (matriz e filiais). */
function raizCnpj(doc: string | null | undefined): string | null {
  const d = String(doc || '').replace(/\D/g, '');
  return d.length === 14 ? d.slice(0, 8) : null;
}

export function mesmaParte(a: Parte, b: Parte): boolean {
  const ra = raizCnpj(a.cpf_cnpj), rb = raizCnpj(b.cpf_cnpj);
  if (ra && rb) return ra === rb;
  const na = normalizarNomeParte(a.nome), nb = normalizarNomeParte(b.nome);
  return !!na && na === nb;
}

const area = (a: string | null) => String(a || '').trim().toLowerCase();

export function casosCorrelatos<T extends CasoParaJuntar>(alvo: CasoParaJuntar, candidatos: T[]): T[] {
  const vistos = new Set<number>([alvo.id]);
  return candidatos.filter((c) => {
    if (vistos.has(c.id)) return false;
    const junta = c.client_id === alvo.client_id && c.client_id != null
      && !!alvo.familia && c.familia === alvo.familia
      && area(c.legal_area) === area(alvo.legal_area)
      && ETAPAS_ANTES_DO_PROTOCOLO.includes(String(c.production_stage))
      && c.partes.some((p) => alvo.partes.some((q) => mesmaParte(p, q)));
    if (junta) vistos.add(c.id);
    return junta;
  });
}

// ── sugestões do quadro ─────────────────────────────────────────────────────

export interface CasoDoQuadro {
  id: number; client_id: number | null; cliente?: string | null; legal_area: string | null;
  production_stage: string | null; titulo: string | null; partes: Parte[];
  unido_ao_caso?: number | null; pedidos_unidos?: number;
}

export interface Sugestao {
  client_id: number; cliente: string | null; familia: Familia; nomeFamilia: string; reu: string;
  principal: number; casos: Array<{ id: number; titulo: string | null; etapa: string | null }>;
}

/** Réus do caso: a parte contrária cadastrada ou, sem ela, o banco escrito no título. */
export function reusDoCaso(c: Pick<CasoDoQuadro, 'partes' | 'titulo'>): Parte[] {
  if (c.partes.length) return c.partes;
  const r = reuDoTitulo(c.titulo);
  return r ? [{ nome: r }] : [];
}

/** Grupos de pedidos que deveriam ser UM processo (para a Dra. confirmar). */
export function sugestoesDeJuncao(casos: CasoDoQuadro[]): Sugestao[] {
  const aptos = casos
    .filter((c) => !c.unido_ao_caso && c.client_id != null && ETAPAS_ANTES_DO_PROTOCOLO.includes(String(c.production_stage)))
    .map((c) => ({ c, familia: familiaDaTese(c.titulo), reus: reusDoCaso(c) }))
    .filter((x) => x.familia && x.reus.length)
    .sort((a, b) => a.c.id - b.c.id);
  const grupos: Array<{ base: typeof aptos[number]; membros: typeof aptos }> = [];
  for (const x of aptos) {
    const g = grupos.find((gr) => gr.base.c.client_id === x.c.client_id && gr.base.familia === x.familia
      && area(gr.base.c.legal_area) === area(x.c.legal_area)
      && gr.base.reus.some((p) => x.reus.some((q) => mesmaParte(p, q))));
    if (g) g.membros.push(x); else grupos.push({ base: x, membros: [x] });
  }
  const ordem = (s: string | null) => ETAPAS_ANTES_DO_PROTOCOLO.indexOf(String(s));
  return grupos.filter((g) => g.membros.length > 1).map((g) => {
    const principal = [...g.membros].sort((a, b) =>
      (Number(b.c.pedidos_unidos || 0) > 0 ? 1 : 0) - (Number(a.c.pedidos_unidos || 0) > 0 ? 1 : 0)
      || ordem(b.c.production_stage) - ordem(a.c.production_stage)
      || a.c.id - b.c.id)[0];
    return {
      client_id: g.base.c.client_id as number, cliente: g.base.c.cliente || null,
      familia: g.base.familia as Familia, nomeFamilia: NOME_FAMILIA[g.base.familia as Familia],
      reu: String(g.base.reus[0].nome || ''), principal: principal.c.id,
      casos: g.membros.map((m) => ({ id: m.c.id, titulo: m.c.titulo, etapa: m.c.production_stage })),
    };
  });
}
