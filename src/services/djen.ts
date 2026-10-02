/**
 * Integração com o DJEN / Comunica API do CNJ (Diário de Justiça Eletrônico Nacional).
 * Pública e gratuita (sem chave). Busca comunicações/intimações por número da OAB —
 * ao contrário do DataJud público, que NÃO indexa advogado/OAB.
 * Doc: https://comunica.pje.jus.br  ·  API: https://comunicaapi.pje.jus.br/api/v1/comunicacao
 */

import { limparTextoJudicial } from './textCleanup';

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

const HTML_ENTITIES: Record<string, string> = {
  'amp':'&', 'lt':'<', 'gt':'>', 'quot':'"','#39':"'",
  'aacute':'á','eacute':'é','iacute':'í','oacute':'ó','uacute':'ú',
  'agrave':'à','egrave':'è','igrave':'ì','ograve':'ò','ugrave':'ù',
  'acirc':'â','ecirc':'ê','icirc':'î','ocirc':'ô','ucirc':'û',
  'atilde':'ã','otilde':'õ','ntilde':'ñ','ccedil':'ç',
  'Aacute':'Á','Eacute':'É','Iacute':'Í','Oacute':'Ó','Uacute':'Ú',
  'Agrave':'À','Egrave':'È','Igrave':'Ì','Ograve':'Ò','Ugrave':'Ù',
  'Acirc':'Â','Ecirc':'Ê','Icirc':'Î','Ocirc':'Ô','Ucirc':'Û',
  'Atilde':'Ã','Otilde':'Õ','Ntilde':'Ñ','Ccedil':'Ç',
};
function decodeHtmlEntities(text: string): string {
  return (text || '').replace(/&(#?\w+);/g, (_, code: string) => HTML_ENTITIES[code] || `&${code};`);
}

export interface DjenParty { nome: string; polo: string }

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
  parties: DjenParty[];     // destinatarios (partes representadas)
  adv_count: number;        // nº de advogados destinatários (1 = advogada é a única)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Status HTTP que indicam bloqueio/limitação (WAF do CloudFront ou rate limit),
// distintos de "acabaram as páginas" (200 com lista vazia) ou erro comum.
const BLOCKED_STATUSES = new Set([429, 403]);
// Backoff curto entre tentativas na MESMA página antes de desistir — poucas
// tentativas de propósito: se persistir, é melhor sinalizar bloqueio e parar
// (ver runDiscoveryJob) do que insistir e piorar a situação com o tribunal.
const BACKOFF_MS = [2000, 5000, 15000];

export interface DjenFetchResult {
  publications: DjenPublication[];
  /** true quando o DJEN devolveu 429/403 de forma persistente (mesmo após backoff) —
   *  diferente de "não há mais páginas". Quem chama deve tratar como bloqueio, não
   *  como fim normal da busca (ver monitoringService.discoverProcessesByOAB). */
  blocked: boolean;
}

/**
 * Busca as publicações dos últimos meses dirigidas a uma OAB.
 * Pagina até maxPages (100/página). Se o DJEN responder 429/403 de forma
 * persistente (mesmo após backoff), para e sinaliza `blocked: true` — quem
 * chama decide o que fazer (não insistir, avisar, etc.), em vez do código
 * simplesmente devolver uma lista parcial sem dizer por quê.
 */
export async function fetchDjenByOAB(
  oabNumber: string,
  oabUf: string,
  opts: { maxPages?: number; sinceDays?: number } = {}
): Promise<DjenFetchResult> {
  const num = onlyDigits(oabNumber);
  const uf = (oabUf || 'ES').toUpperCase();
  if (!num) return { publications: [], blocked: false };

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
    let data: any = null;
    let pageBlocked = false;

    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        const res = await fetch(url, { headers: DJEN_HEADERS, signal: controller.signal });
        clearTimeout(timer);

        if (BLOCKED_STATUSES.has(res.status)) {
          if (attempt < BACKOFF_MS.length) {
            console.warn(`[DJEN] HTTP ${res.status} na página ${pagina} (tentativa ${attempt + 1}/${BACKOFF_MS.length + 1}) — aguardando ${BACKOFF_MS[attempt]}ms antes de tentar de novo.`);
            await sleep(BACKOFF_MS[attempt]);
            continue;
          }
          console.error(`[DJEN] Bloqueado (HTTP ${res.status}) na página ${pagina} mesmo após ${BACKOFF_MS.length} tentativas com backoff — desistindo desta busca.`);
          pageBlocked = true;
          break;
        }
        if (!res.ok) { data = null; break; } // outro erro HTTP: fim normal da busca, não bloqueio
        data = await res.json();
        break;
      } catch {
        // erro de rede / timeout — vale uma nova tentativa com backoff também
        if (attempt < BACKOFF_MS.length) {
          await sleep(BACKOFF_MS[attempt]);
          continue;
        }
        data = null; // desiste por erro de rede: devolve o que já tem, sem marcar bloqueio
      }
    }

    if (pageBlocked) return { publications: out, blocked: true };
    if (!data) break;

    const items: any[] = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) break;
    out.push(...normalizeDjenItems(items));
    if (items.length < itens) break; // última página
  }
  return { publications: out, blocked: false };
}

/** Converte itens crus da API DJEN (ou versão enxuta vinda do navegador) em publicações. */
export function normalizeDjenItems(items: any[]): DjenPublication[] {
  const out: DjenPublication[] = [];
  for (const it of items || []) {
    const pn = onlyDigits(it.numero_processo);
    if (!pn) continue;
    const parties: DjenParty[] = Array.isArray(it.parties)
      ? it.parties.map((d: any) => ({ nome: d.nome || '', polo: d.polo || '' }))
      : (it.destinatarios || []).map((d: any) => ({ nome: d.nome || '', polo: d.polo || '' }));
    const advCount = typeof it.adv_count === 'number' ? it.adv_count : (it.destinatarioadvogados || []).length;
    out.push({
      id: Number(it.id) || 0,
      process_number: pn,
      process_masked: it.numeroprocessocommascara || it.numero_processo || pn,
      court: it.siglaTribunal || '',
      orgao: it.nomeOrgao || null,
      classe: it.nomeClasse || null,
      date: it.data_disponibilizacao || null,
      type: decodeHtmlEntities(it.tipoComunicacao || ''),
      texto: decodeHtmlEntities(it.texto || ''),
      link: it.link || null,
      parties: parties.filter((p) => p.nome),
      adv_count: advCount,
    });
  }
  return out;
}

/** Ente público — no escritório, sempre parte contrária (INSS, União, Estado, Município...). */
export function isEntePublico(name: string): boolean {
  return /\b(INSS|INSTITUTO NACIONAL DO SEGURO|UNI[AÃ]O FEDERAL|FAZENDA (P[UÚ]BLICA|NACIONAL|ESTADUAL|MUNICIPAL)|ESTADO D[OE]|MUNIC[IÍ]PIO D[EO]|MINIST[EÉ]RIO P[UÚ]BLICO|DEFENSORIA)\b/i.test(name || '');
}

/**
 * Escolhe o cliente entre as partes candidatas. Regras (perfil do escritório:
 * trabalhista/consumidor/previdenciário/família — cliente é quase sempre PF):
 *  1. uma única candidata → ela (inclui cliente PJ legítimo);
 *  2. ignora ente público e, havendo pessoa física, ignora empresas;
 *  3. sobrou 1 → ela; sobraram várias → a do polo ativo, se for só uma;
 *  4. senão null (ambíguo → cadastro manual, nunca chutar).
 */
export function escolherCliente(candidatos: Map<string, string>, polos: Map<string, string>): string | null {
  const lista = [...candidatos.entries()];
  if (lista.length === 1) return isEntePublico(lista[0][1]) ? null : lista[0][1];
  let restantes = lista.filter(([, nm]) => !isEntePublico(nm));
  const pessoas = restantes.filter(([, nm]) => !isCompanyName(nm));
  if (pessoas.length) restantes = pessoas;
  if (restantes.length === 1) return restantes[0][1];
  const ativos = restantes.filter(([k]) => /^A/.test(polos.get(k) || ''));
  return ativos.length === 1 ? ativos[0][1] : null;
}

/** Heurística: nome de pessoa jurídica? (para definir tipo PF/PJ do cliente). */
export function isCompanyName(name: string): boolean {
  return /\b(LTDA|S\.?A\.?|EIRELI|EPP|MEI|ME|SOCIEDADE|ASSOCIA|COOPERATIVA|INSTITUTO|FUNDA[CÇ][AÃ]O|BANCO|SEGUR|COM[EÉ]RCIO|COMERCIO|IND[UÚ]STRIA|INDUSTRIA|SERVI[CÇ]OS|TECNOLOGIA|TELECOM|ENERGIA|CONSTRU|TRANSPORTE|EMPREEND|PARTICIPA[CÇ])/i.test(name || '');
}

export interface DjenMovement {
  movement_date: string | null;
  title: string;
  description: string;
  movement_type: 'intimacao' | 'publicacao';
  djen_id: number | null;
  is_deadline_trigger: boolean;
  metadata: Record<string, any> | null;
}

export interface DjenProcess {
  process_number: string;
  process_masked: string;
  court: string;
  orgao: string | null;
  classe: string | null;
  last_date: string | null;
  client_name: string | null;     // parte que a advogada representa (ou null se ambíguo)
  client_type: 'PF' | 'PJ';
  movements: DjenMovement[];
}

/**
 * Agrupa as publicações por processo (1 movimentação por publicação) e resolve o
 * cliente: quando a advogada é a única destinatária da intimação (adv_count<=1), a
 * parte é seguramente cliente dela. Em casos ambíguos, deixa null → cadastro manual.
 */
export function groupPublicationsByProcess(pubs: DjenPublication[]): DjenProcess[] {
  type Acc = DjenProcess & { _sole: Map<string, string>; _all: Map<string, string>; _polo: Map<string, string> };
  const byProc: Record<string, Acc> = {};

  for (const p of pubs) {
    const proc = (byProc[p.process_number] ??= {
      process_number: p.process_number, process_masked: p.process_masked,
      court: p.court, orgao: p.orgao, classe: p.classe, last_date: null,
      client_name: null, client_type: 'PF', movements: [],
      _sole: new Map(), _all: new Map(), _polo: new Map(),
    });
    const pubType = (p.type || 'Publicação').toLowerCase();
    const isIntimacao = /intima[çc][ãa]o/i.test(pubType);
    proc.movements.push({
      movement_date: p.date,
      title: `${p.type || 'Publicação'}${p.classe ? ` — ${p.classe}` : ''}`,
      description: limparTextoJudicial(p.texto).slice(0, 20000),
      movement_type: isIntimacao ? 'intimacao' : 'publicacao',
      djen_id: p.id || null,
      is_deadline_trigger: isIntimacao,
      metadata: { tipoComunicacao: p.type, link: p.link, orgao: p.orgao, classe: p.classe, parties: p.parties, adv_count: p.adv_count, disponibilizacao_date: p.date },
    });
    if (p.date && (!proc.last_date || p.date > proc.last_date)) proc.last_date = p.date;
    for (const pt of p.parties || []) {
      const nm = (pt.nome || '').trim();
      if (!nm) continue;
      const key = nm.toUpperCase().replace(/\s+/g, ' ');
      proc._all.set(key, nm);
      if (pt.polo) proc._polo.set(key, String(pt.polo).toUpperCase());
      if ((p.adv_count || 0) <= 1) proc._sole.set(key, nm);
    }
  }

  return Object.values(byProc).map((proc) => {
    // Advogada única intimada → o cliente está entre as partes intimadas, mas
    // a ré também vem na lista (bug real: a 1ª parte, muitas vezes a empresa,
    // virava "cliente"). Ver escolherCliente.
    const candidatos = proc._sole.size ? proc._sole : (proc._all.size === 1 ? proc._all : new Map<string, string>());
    const name = escolherCliente(candidatos, proc._polo);
    const { _sole, _all, _polo, ...clean } = proc;
    return { ...clean, client_name: name, client_type: name && isCompanyName(name) ? 'PJ' : 'PF' };
  });
}
