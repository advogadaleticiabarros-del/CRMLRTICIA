/**
 * Integração com a API Pública do DataJud/CNJ (gratuita).
 * Doc: https://datajud-wiki.cnj.jus.br/api-publica/
 * A chave (APIKey pública do CNJ) vem de DATAJUD_API_KEY no .env — nunca fixa no código.
 */

const BASE_URL = process.env.DATAJUD_BASE_URL || 'https://api-publica.datajud.cnj.jus.br';

// Tribunais monitorados (ES e PR) + superiores
export const TRIBUNAIS: Record<string, { sigla: string; estado: string; nome: string }> = {
  api_publica_tjes: { sigla: 'TJES',  estado: 'ES', nome: 'Tribunal de Justiça do ES' },
  api_publica_trt17:{ sigla: 'TRT17', estado: 'ES', nome: 'TRT 17ª Região (ES)' },
  api_publica_trf2: { sigla: 'TRF2',  estado: 'ES', nome: 'TRF 2ª Região' },
  api_publica_tjpr: { sigla: 'TJPR',  estado: 'PR', nome: 'Tribunal de Justiça do PR' },
  api_publica_trt9: { sigla: 'TRT9',  estado: 'PR', nome: 'TRT 9ª Região (PR)' },
  api_publica_trf4: { sigla: 'TRF4',  estado: 'PR', nome: 'TRF 4ª Região' },
  api_publica_stj:  { sigla: 'STJ',   estado: 'BR', nome: 'Superior Tribunal de Justiça' },
  api_publica_tst:  { sigla: 'TST',   estado: 'BR', nome: 'Tribunal Superior do Trabalho' },
};

// Sugestão automática de tribunal por área + estado
export function suggestCourtAlias(area: string, uf: string): string | null {
  const a = (area || '').toLowerCase();
  const u = (uf || 'ES').toUpperCase();
  if (u === 'ES') {
    if (a === 'trabalhista') return 'api_publica_trt17';
    if (a === 'previdenciario') return 'api_publica_trf2';
    return 'api_publica_tjes'; // familia, civel, etc.
  }
  if (u === 'PR') {
    if (a === 'trabalhista') return 'api_publica_trt9';
    if (a === 'previdenciario') return 'api_publica_trf4';
    return 'api_publica_tjpr';
  }
  return null;
}

// ─── Cobertura nacional para descoberta por OAB ──────────────────────────────
// Lista de tribunais (slugs DataJud) varridos numa busca nacional por OAB.
export const TRIBUNAIS_NACIONAIS = [
  'tjac','tjal','tjam','tjap','tjba','tjce','tjdft','tjes','tjgo','tjma','tjmg',
  'tjms','tjmt','tjpa','tjpb','tjpe','tjpi','tjpr','tjrj','tjrn','tjro','tjrr',
  'tjrs','tjsc','tjse','tjsp','tjto',
  'trf1','trf2','trf3','trf4','trf5','trf6',
  'trt1','trt2','trt3','trt4','trt5','trt6','trt7','trt8','trt9','trt10','trt11',
  'trt12','trt13','trt14','trt15','trt16','trt17','trt18','trt19','trt20','trt21',
  'trt22','trt23','trt24',
];

const TJ_BY_CODE: Record<number, string> = {
  1:'ac',2:'al',3:'am',4:'ap',5:'ba',6:'ce',7:'dft',8:'es',9:'go',10:'ma',
  11:'mg',12:'ms',13:'mt',14:'pa',15:'pb',16:'pe',17:'pi',18:'pr',19:'rj',
  20:'rn',21:'ro',22:'rr',23:'rs',24:'sc',25:'se',26:'sp',27:'to',
};
const TRT_BY_UF: Record<string, string> = {
  AC:'14',AL:'19',AM:'11',AP:'8',BA:'5',CE:'7',DF:'10',ES:'17',GO:'18',MA:'16',
  MG:'3',MS:'24',MT:'23',PA:'8',PB:'13',PE:'6',PI:'22',PR:'9',RJ:'1',RN:'21',
  RO:'14',RR:'11',RS:'4',SC:'12',SE:'20',SP:'2',TO:'10',
};

/** Slug do tribunal a partir do número CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO). */
export function tribunalSlugFromNumber(processNumber: string): string | null {
  const c = cleanNumber(processNumber);
  if (c.length < 20) return null;
  const justica = c.charAt(13);        // segmento de justiça (J)
  const tribunal = parseInt(c.substring(14, 16)); // código do tribunal (TR)
  if (justica === '8') return `tj${TJ_BY_CODE[tribunal] ?? ''}` || null; // estadual
  if (justica === '5') return `trf${tribunal}`;  // federal
  if (justica === '4') return `trt${tribunal}`;  // trabalhista
  if (justica === '6') return `tre${TJ_BY_CODE[tribunal] ?? ''}`;        // eleitoral
  if (justica === '7') return 'stm';   // militar da união
  return null;
}

/** Alias DataJud (api_publica_*) a partir do número CNJ, ou null se indecifrável. */
export function aliasFromProcessNumber(processNumber: string): string | null {
  const slug = tribunalSlugFromNumber(processNumber);
  return slug ? `api_publica_${slug}` : null;
}

const ALIAS_RE = /^api_publica_[a-z0-9]+$/;

export interface NormalizedMovement {
  movement_date: string | null;
  title: string;
  description: string;
}

export interface DataJudResult {
  found: boolean;
  error?: string;
  metadata?: any;
  movements: NormalizedMovement[];
}

const cleanNumber = (n: string) => (n || '').replace(/[.\-\s/]/g, '');

export async function consultarProcessoDataJud(
  numeroProcesso: string,
  tribunalAlias?: string | null
): Promise<DataJudResult> {
  const apiKey = process.env.DATAJUD_API_KEY;
  if (!apiKey) return { found: false, error: 'DATAJUD_API_KEY não configurada', movements: [] };

  // Usa o alias informado se válido; senão tenta deduzir do próprio número CNJ.
  const alias = (tribunalAlias && ALIAS_RE.test(tribunalAlias))
    ? tribunalAlias
    : aliasFromProcessNumber(numeroProcesso);
  if (!alias) return { found: false, error: 'Não foi possível identificar o tribunal pelo número', movements: [] };

  const numero = cleanNumber(numeroProcesso);
  const url = `${BASE_URL}/${alias}/_search`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `APIKey ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { match: { numeroProcesso: numero } } }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return { found: false, error: `DataJud HTTP ${res.status}`, movements: [] };

    const data: any = await res.json();
    const hit = data?.hits?.hits?.[0]?._source;
    if (!hit) return { found: false, error: 'Processo não encontrado', movements: [] };

    const movimentos: any[] = Array.isArray(hit.movimentos) ? hit.movimentos : [];
    const movements: NormalizedMovement[] = movimentos.map((m) => ({
      movement_date: m.dataHora ?? null,
      title: m.nome ?? (m.complementosTabelados?.[0]?.nome) ?? 'Movimentação',
      description: [m.nome, ...(m.complementosTabelados || []).map((c: any) => c.descricao || c.nome)]
        .filter(Boolean).join(' — '),
    }));

    return {
      found: true,
      metadata: {
        classe: hit.classe?.nome, orgao: hit.orgaoJulgador?.nome,
        grau: hit.grau, distribuicao: hit.dataAjuizamento,
      },
      movements,
    };
  } catch (err: any) {
    const msg = err.name === 'AbortError' ? 'Timeout na consulta DataJud' : (err.message || 'Erro na consulta');
    return { found: false, error: msg, movements: [] };
  }
}

// ─── Descoberta por OAB ───────────────────────────────────────────────────────

export interface DiscoveredProcess {
  process_number: string;
  court_slug: string;        // tjes, trt17, ...
  court_alias: string;       // api_publica_tjes
  court_name: string;        // sigla amigável
  classe: string | null;
  orgao: string | null;
  distribution_date: string | null;
  sigilo: number;
  movements: NormalizedMovement[];
}

/** Consulta UM tribunal buscando processos onde a OAB aparece como advogado. */
async function searchTribunalByOAB(slug: string, oabNumber: string, oabUf: string): Promise<DiscoveredProcess[]> {
  const apiKey = process.env.DATAJUD_API_KEY;
  if (!apiKey) return [];
  const url = `${BASE_URL}/api_publica_${slug}/_search`;
  const advQuery = (oabValue: string) => ({
    nested: {
      path: 'partes',
      query: { nested: { path: 'partes.advogados', query: { bool: { must: [
        { match: { 'partes.advogados.OAB': oabValue } },
      ] } } } },
    },
  });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `APIKey ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        size: 100,
        sort: [{ dataUltimaAtualizacao: { order: 'desc' } }],
        query: { bool: {
          should: [advQuery(`${oabUf}${oabNumber}`), advQuery(oabNumber)],
          minimum_should_match: 1,
        } },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return []; // 404 = tribunal sem dados / sem índice — ignora

    const data: any = await res.json();
    const hits: any[] = data?.hits?.hits ?? [];
    return hits.map((h) => {
      const s = h._source ?? {};
      const movimentos: any[] = Array.isArray(s.movimentos) ? s.movimentos : [];
      return {
        process_number: s.numeroProcesso,
        court_slug: slug,
        court_alias: `api_publica_${slug}`,
        court_name: slug.toUpperCase(),
        classe: s.classe?.nome ?? null,
        orgao: s.orgaoJulgador?.nome ?? null,
        distribution_date: s.dataAjuizamento ?? null,
        sigilo: Number(s.nivelSigilo ?? 0),
        movements: movimentos.map((m) => ({
          movement_date: m.dataHora ?? null,
          title: m.nome ?? 'Movimentação',
          description: [m.nome, ...((m.complementosTabelados || []).map((c: any) => c.descricao || c.nome))]
            .filter(Boolean).join(' — '),
        })),
      } as DiscoveredProcess;
    }).filter((p) => p.process_number);
  } catch {
    return [];
  }
}

/** Busca todos os processos de uma OAB. scope 'state' = TJ+TRT do estado; 'national' = país todo. */
export async function searchByOAB(
  oabNumber: string,
  oabUf: string,
  scope: 'national' | 'state' = 'national'
): Promise<{ total: number; processes: DiscoveredProcess[]; tribunaisConsultados: number }> {
  const uf = (oabUf || 'ES').toUpperCase();
  const tribunais = scope === 'state'
    ? [`tj${uf.toLowerCase()}`, `trt${TRT_BY_UF[uf] ?? '17'}`]
    : TRIBUNAIS_NACIONAIS;

  const all: DiscoveredProcess[] = [];
  const BATCH = 8; // lotes para não estourar rate limit
  for (let i = 0; i < tribunais.length; i += BATCH) {
    const batch = tribunais.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((t) => searchTribunalByOAB(t, oabNumber, uf)));
    results.forEach((procs) => all.push(...procs));
  }

  // Dedup por número de processo
  const seen = new Set<string>();
  const unique = all.filter((p) => (seen.has(p.process_number) ? false : (seen.add(p.process_number), true)));
  return { total: unique.length, processes: unique, tribunaisConsultados: tribunais.length };
}
