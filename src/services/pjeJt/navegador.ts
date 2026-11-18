/**
 * Navegador mínimo para o robô do PJe-JT (18/11/2026): guarda cookies por site
 * e caminho e segue redirecionamentos, como um navegador faria. Não abre nada
 * sozinho: cada pedido sai pela função `http` injetada (em produção, a ponte do
 * computador do escritório, porque o TRT17 bloqueia o servidor do CRM).
 */

export interface PedidoHttp { url: string; metodo: 'GET' | 'POST'; cabecalhos: Record<string, string>; corpo?: string }
export interface RespostaHttp { status: number; corpo: string; cabecalhos: Record<string, string | string[] | undefined> }
export type Http = (p: PedidoHttp) => Promise<RespostaHttp>;

interface Cookie { nome: string; valor: string; dominio: string; soHost: boolean; caminho: string }

export interface Navegador {
  ir(url: string, opts?: { metodo?: 'GET' | 'POST'; corpo?: string; cabecalhos?: Record<string, string>; maxRedirecionamentos?: number }):
    Promise<{ url: string; status: number; corpo: string; cabecalhos: RespostaHttp['cabecalhos'] }>;
  /** Valor de um cookie guardado para o site, ou null. */
  cookie(host: string, nome: string): string | null;
  nomesDosCookies(): string[];
}

const lista = (v: string | string[] | undefined): string[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const cab = (h: RespostaHttp['cabecalhos'], nome: string) => {
  const k = Object.keys(h).find((x) => x.toLowerCase() === nome);
  return k ? h[k] : undefined;
};

function dominioCasa(host: string, c: Cookie) {
  return c.soHost ? host === c.dominio : host === c.dominio || host.endsWith(`.${c.dominio}`);
}
function caminhoCasa(caminho: string, c: Cookie) {
  if (c.caminho === '/' || caminho === c.caminho) return true;
  const base = c.caminho.endsWith('/') ? c.caminho : `${c.caminho}/`;
  return caminho.startsWith(base);
}

export function criarNavegador(http: Http): Navegador {
  let cookies: Cookie[] = [];

  function guardar(url: URL, setCookie: string[]) {
    for (const linha of setCookie) {
      const [par, ...attrs] = linha.split(';');
      const i = par.indexOf('=');
      if (i <= 0) continue;
      const nome = par.slice(0, i).trim();
      const valor = par.slice(i + 1).trim();
      let dominio = url.hostname; let soHost = true;
      let caminho = url.pathname.replace(/\/[^/]*$/, '') || '/';
      let apagar = valor === '';
      for (const a of attrs) {
        const [k, ...v] = a.split('=');
        const chave = k.trim().toLowerCase(); const val = v.join('=').trim();
        if (chave === 'domain' && val) { dominio = val.replace(/^\./, '').toLowerCase(); soHost = false; }
        else if (chave === 'path' && val) caminho = val;
        else if (chave === 'max-age' && Number(val) <= 0) apagar = true;
        else if (chave === 'expires' && Date.parse(val) < Date.now()) apagar = true;
      }
      cookies = cookies.filter((c) => !(c.nome === nome && c.dominio === dominio && c.caminho === caminho));
      if (!apagar) cookies.push({ nome, valor, dominio, soHost, caminho });
    }
  }

  function cabecalhoCookie(url: URL): string {
    return cookies.filter((c) => dominioCasa(url.hostname, c) && caminhoCasa(url.pathname, c)).map((c) => `${c.nome}=${c.valor}`).join('; ');
  }

  return {
    async ir(inicial, opts = {}) {
      let url = new URL(inicial);
      let metodo = opts.metodo ?? 'GET';
      let corpo = opts.corpo;
      const max = opts.maxRedirecionamentos ?? 10;
      for (let i = 0; i <= max; i++) {
        const cabecalhos: Record<string, string> = { ...(opts.cabecalhos || {}) };
        const ck = cabecalhoCookie(url);
        if (ck) cabecalhos.Cookie = ck;
        if (metodo === 'GET') delete cabecalhos['Content-Type'];
        const r = await http({ url: url.toString(), metodo, cabecalhos, corpo: metodo === 'POST' ? corpo : undefined });
        guardar(url, lista(cab(r.cabecalhos, 'set-cookie')));
        const loc = lista(cab(r.cabecalhos, 'location'))[0];
        if ([301, 302, 303, 307, 308].includes(r.status) && loc) {
          url = new URL(loc, url);
          if (r.status !== 307 && r.status !== 308) { metodo = 'GET'; corpo = undefined; }
          continue;
        }
        return { url: url.toString(), status: r.status, corpo: r.corpo, cabecalhos: r.cabecalhos };
      }
      throw new Error('Muitos redirecionamentos seguidos no site do tribunal.');
    },
    cookie(host, nome) {
      const c = cookies.find((x) => x.nome === nome && dominioCasa(host, x));
      return c ? c.valor : null;
    },
    nomesDosCookies() {
      return [...new Set(cookies.map((c) => c.nome))];
    },
  };
}
