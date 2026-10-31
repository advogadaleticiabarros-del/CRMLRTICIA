/**
 * Documentos repetidos do cliente (31/10/2026, caso do Valmirio: 52 documentos, o mesmo
 * histórico de créditos várias vezes e 39 anexos no kit de cada banco). Jessica: "quando
 * atualizo a pasta deve vir apenas os documentos que não estão, caso contrário terá excesso
 * de documentos, kit incorreto e vamos gastar mais com leituras e análises duplicadas".
 *
 * Mesmo arquivo = mesmo arquivo do Google Drive (ID) ou mesmo conteúdo (md5), em qualquer
 * ação do cliente. Nada é apagado: o repetido fica marcado (`documents.duplicado_de`) e sai
 * da tela, do kit e das leituras. O arquivo que aparece em mais de uma ação passa a ser do
 * cliente (vale para todas as ações), como os documentos comuns do card do cliente.
 *
 * Regras puras; banco em documentosDuplicadosMysql.ts; testes em tests/documentosDuplicados.test.mjs.
 */

export interface DocParaDedup {
  id: number;
  case_id: number | null;
  name: string;
  type?: string | null;
  file_url?: string | null;
  /** md5 do conteúdo: o que o Drive informa (md5Checksum) ou o do arquivo guardado no CRM. */
  md5?: string | null;
  tem_texto?: boolean | number | null;
  duplicado_de?: number | null;
}

/** Gerados pelo CRM: cada versão é própria, mesmo com o mesmo conteúdo. */
const GERADO = /^(peti[cç][aã]o inicial|planilha de c[aá]lculos|demonstrativo de descontos|dossi[eê] da pe[cç]a|revis[aã]o da peti[cç][aã]o|an[aá]lise do caso)/i;

const idDrive = (url: string | null | undefined): string | null => {
  const u = String(url || '');
  if (!/drive\.google\.com/.test(u)) return null;
  const m = u.match(/\/file\/d\/([\w-]+)/) || u.match(/[?&]id=([\w-]+)/);
  return m ? m[1] : null;
};

export function chavesDoDocumento(d: DocParaDedup): string[] {
  if (GERADO.test(String(d.name || '')) || d.type === 'peca') return [];
  const out: string[] = [];
  const id = idDrive(d.file_url);
  if (id) out.push(`drive:${id}`);
  if (d.md5) out.push(`md5:${String(d.md5).toLowerCase()}`);
  return out;
}

/** Grupos de documentos que são o mesmo arquivo (ligados por qualquer chave em comum). */
function grupos<T extends DocParaDedup>(docs: T[]): T[][] {
  const pai = new Map<number, number>();
  const raiz = (i: number): number => { let r = i; while (pai.get(r) !== r) r = pai.get(r)!; pai.set(i, r); return r; };
  docs.forEach((_, i) => pai.set(i, i));
  const donoDaChave = new Map<string, number>();
  docs.forEach((d, i) => {
    for (const k of chavesDoDocumento(d)) {
      const j = donoDaChave.get(k);
      if (j == null) donoDaChave.set(k, i); else pai.set(raiz(i), raiz(j));
    }
  });
  const porRaiz = new Map<number, T[]>();
  docs.forEach((d, i) => { const r = raiz(i); porRaiz.set(r, [...(porRaiz.get(r) || []), d]); });
  return [...porRaiz.values()];
}

/** O que fica: o que já tem o texto lido (a leitura não é refeita), depois o do cliente, depois o mais antigo. */
const preferido = <T extends DocParaDedup>(g: T[]): T =>
  [...g].sort((a, b) => Number(!!Number(b.tem_texto)) - Number(!!Number(a.tem_texto))
    || Number(a.case_id != null) - Number(b.case_id != null) || a.id - b.id)[0];

export interface PlanoLimpeza {
  /** Repetidos a marcar: `id` é cópia de `de`. */
  duplicados: Array<{ id: number; de: number }>;
  /** Originais que estavam em mais de uma ação: passam a ser do cliente (valem para todas). */
  paraOCliente: number[];
}

export function planoDeLimpeza(docs: DocParaDedup[]): PlanoLimpeza {
  const ativos = docs.filter((d) => d.duplicado_de == null);
  const plano: PlanoLimpeza = { duplicados: [], paraOCliente: [] };
  for (const g of grupos(ativos)) {
    if (g.length < 2) continue;
    const fica = preferido(g);
    for (const d of g) if (d.id !== fica.id) plano.duplicados.push({ id: d.id, de: fica.id });
    const casos = new Set(g.map((d) => d.case_id));
    if (fica.case_id != null && casos.size > 1) plano.paraOCliente.push(fica.id);
  }
  plano.duplicados.sort((a, b) => a.id - b.id);
  return plano;
}

/** Lista para a tela e o kit: cada arquivo uma vez, mesmo antes da limpeza gravada no banco. */
export function semDuplicados<T extends DocParaDedup>(docs: T[]): T[] {
  const fora = new Set(planoDeLimpeza(docs).duplicados.map((x) => x.id));
  return docs.filter((d) => d.duplicado_de == null && !fora.has(d.id));
}
