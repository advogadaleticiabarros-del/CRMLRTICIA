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
  tribunalAlias: string
): Promise<DataJudResult> {
  const apiKey = process.env.DATAJUD_API_KEY;
  if (!apiKey) return { found: false, error: 'DATAJUD_API_KEY não configurada', movements: [] };
  if (!TRIBUNAIS[tribunalAlias]) return { found: false, error: 'Tribunal (alias) inválido', movements: [] };

  const numero = cleanNumber(numeroProcesso);
  const url = `${BASE_URL}/${tribunalAlias}/_search`;

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
