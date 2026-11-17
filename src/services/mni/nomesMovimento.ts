/**
 * Nome por extenso dos códigos de movimento da Tabela Processual Unificada
 * (TPU) do CNJ. O PJe manda só o código (ex.: 848); o nome ("Trânsito em
 * julgado") vem do serviço público SGT do CNJ e fica guardado na tabela
 * `tpu_movimentos`, para não consultar de novo.
 */

const SGT_URLS = ['https://sgt.cloud.cnj.jus.br/api/v1/soap', 'https://www.cnj.jus.br/sgt/sgt_ws.php'];

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ status: number; text(): Promise<string> }>;

export interface DepsNomes {
  lerCache(codigo: number): Promise<string | null>;
  gravarCache(codigo: number, nome: string): Promise<void>;
  fetch?: Fetch;
}

export function extrairNomeSgt(xml: string): string | null {
  const m = xml.match(/<nome>([\s\S]*?)<\/nome>/);
  const nome = m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
  return nome || null;
}

async function consultarSgt(codigo: number, f: Fetch): Promise<string | null> {
  const corpo = '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sgt="https://www.cnj.jus.br/sgt/sgt_ws.php">'
    + '<soapenv:Body><sgt:pesquisarItemPublicoWS><tipoTabela>M</tipoTabela><tipoPesquisa>C</tipoPesquisa>'
    + `<valorPesquisa>${Math.trunc(codigo)}</valorPesquisa></sgt:pesquisarItemPublicoWS></soapenv:Body></soapenv:Envelope>`;
  for (const url of SGT_URLS) {
    try {
      const r = await f(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '"https://www.cnj.jus.br/sgt/sgt_ws.php#pesquisarItemPublicoWS"' },
        body: corpo,
        signal: AbortSignal.timeout(20_000),
      });
      if (r.status !== 200) continue;
      const nome = extrairNomeSgt(await r.text());
      if (nome) return nome;
    } catch { /* tenta o próximo endereço */ }
  }
  return null;
}

/** Cria a função que traduz código → nome (com cache). Se o CNJ não responder, devolve null. */
export function criarNomesMovimento(deps: DepsNomes): (codigo: number | null) => Promise<string | null> {
  const f: Fetch = deps.fetch ?? ((u, i) => fetch(u, i as any) as any);
  const memoria = new Map<number, string | null>();
  return async (codigo) => {
    if (codigo == null || !Number.isFinite(codigo)) return null;
    if (memoria.has(codigo)) return memoria.get(codigo)!;
    let nome = await deps.lerCache(codigo);
    if (!nome) {
      nome = await consultarSgt(codigo, f);
      if (nome) await deps.gravarCache(codigo, nome).catch(() => undefined);
    }
    memoria.set(codigo, nome);
    return nome;
  };
}
