/**
 * Integração com o DJEN / Comunica API do CNJ (Diário de Justiça Eletrônico Nacional).
 * Pública e gratuita (sem chave). Busca comunicações/intimações por número da OAB —
 * ao contrário do DataJud público, que NÃO indexa advogado/OAB.
 * Doc: https://comunica.pje.jus.br  ·  API: https://comunicaapi.pje.jus.br/api/v1/comunicacao
 */

const DJEN_BASE = process.env.DJEN_BASE_URL || 'https://comunicaapi.pje.jus.br';

// Cabeçalhos de navegador — o DJEN fica atrás de CloudFront e bloqueia (403)
// requisições sem User-Agent realista.
export const DJEN_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  Referer: 'https://comunica.pje.jus.br/',
  Origin: 'https://comunica.pje.jus.br',
};

const onlyDigits = (s: string | null | undefined) => (s || '').replace(/\D/g, '');

export interface DjenPublication {
  id: number;
  process_number: string;   // só dígitos
  process_masked: string;   // com máscara
  court: string;            // siglaTribunal (TJES, TRT17…)
  orgao: string | null;     // nomeOrgao
  classe: string | null;    // nomeClasse
  date: string | null;      // data_disponibilizacao (YYYY-MM-DD)
  type: string | null;      // tipoComunicacao (Intimação, Citação…)
  texto: string;            // teor da publicação
  link: string | null;
}

/**
 * Busca as publicações dos últimos meses dirigidas a uma OAB.
 * Pagina até maxPages (100/página). Retorna a lista crua de publicações.
 */
export async function fetchDjenByOAB(
  oabNumber: string,
  oabUf: string,
  opts: { maxPages?: number; sinceDays?: number } = {}
): Promise<DjenPublication[]> {
  const num = onlyDigits(oabNumber);
  const uf = (oabUf || 'ES').toUpperCase();
  if (!num) return [];

  const itens = 100;
  const maxPages = opts.maxPages ?? 10; // até ~1000 publicações
  const out: DjenPublication[] = [];

  // Janela opcional por data de disponibilização
  let dateParams = '';
  if (opts.sinceDays && opts.sinceDays > 0) {
    const from = new Date(); from.setDate(from.getDate() - opts.sinceDays);
    dateParams = `&dataDisponibilizacaoInicio=${from.toISOString().split('T')[0]}`;
  }

  for (let pagina = 1; pagina <= maxPages; pagina++) {
    const url = `${DJEN_BASE}/api/v1/comunicacao?pagina=${pagina}&itensPorPagina=${itens}&numeroOab=${num}&ufOab=${uf}${dateParams}`;
    let data: any;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(url, { headers: DJEN_HEADERS, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) break;
      data = await res.json();
    } catch {
      break; // erro de rede / timeout: devolve o que já tem
    }

    const items: any[] = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) break;
    out.push(...normalizeDjenItems(items));
    if (items.length < itens) break; // última página
  }
  return out;
}

/** Converte itens crus da API DJEN (ou versão enxuta vinda do navegador) em publicações. */
export function normalizeDjenItems(items: any[]): DjenPublication[] {
  const out: DjenPublication[] = [];
  for (const it of items || []) {
    const pn = onlyDigits(it.numero_processo);
    if (!pn) continue;
    out.push({
      id: Number(it.id) || 0,
      process_number: pn,
      process_masked: it.numeroprocessocommascara || it.numero_processo || pn,
      court: it.siglaTribunal || '',
      orgao: it.nomeOrgao || null,
      classe: it.nomeClasse || null,
      date: it.data_disponibilizacao || null,
      type: it.tipoComunicacao || null,
      texto: it.texto || '',
      link: it.link || null,
    });
  }
  return out;
}

export interface DjenProcess {
  process_number: string;
  process_masked: string;
  court: string;
  orgao: string | null;
  classe: string | null;
  last_date: string | null;
  movements: { movement_date: string | null; title: string; description: string }[];
}

/** Agrupa as publicações por processo, virando movimentações (1 por intimação). */
export function groupPublicationsByProcess(pubs: DjenPublication[]): DjenProcess[] {
  const byProc: Record<string, DjenProcess> = {};
  for (const p of pubs) {
    const proc = (byProc[p.process_number] ??= {
      process_number: p.process_number, process_masked: p.process_masked,
      court: p.court, orgao: p.orgao, classe: p.classe, last_date: null, movements: [],
    });
    proc.movements.push({
      movement_date: p.date,
      title: `${p.type || 'Publicação'}${p.classe ? ` — ${p.classe}` : ''}`,
      description: (p.texto || '').replace(/\s+/g, ' ').trim().slice(0, 1200),
    });
    if (p.date && (!proc.last_date || p.date > proc.last_date)) proc.last_date = p.date;
  }
  return Object.values(byProc);
}
