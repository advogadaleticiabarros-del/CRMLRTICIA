/**
 * TRT17 pelo site do PJe-JT, com o login da Dra. (18/11/2026).
 *
 * Por quê: o TRT17 recusa o MNI (a ligação oficial usada no TJES) para quem não
 * é credenciado ("403 – Request forbidden by administrative rules", de qualquer
 * rede). A Dra. escolheu o robô: ele entra no site como ela entraria e lê o que
 * ela veria na tela. Riscos aceitos por ela: o site pode mudar sem aviso; se o
 * login pedir código no celular ou "não sou um robô", o robô PARA (não contorna).
 *
 * Como (descoberto no código público do site, pje.trt17.jus.br/pjekz):
 *  1. login: /{grau}/authenticateSSO.seam → plataforma nacional (Keycloak,
 *     sso.cloud.pje.jus.br) com CPF e senha → volta ao PJe, que entrega os
 *     cookies `access_token` (JWT com o id do usuário) e `Xsrf-Token`;
 *  2. intimações: painel do advogado "Meus Expedientes"
 *     (/pje-comum-api/api/paineladvogado/{id}/processos?tipoPainelAdvogado=2);
 *  3. processos da Dra.: o mesmo painel, "Acervo geral" (tipoPainelAdvogado=1);
 *  4. andamentos: /processos/id/{idProcesso}/timeline?buscarMovimentos=true.
 * Só leitura: nada é aberto, assinado ou enviado no tribunal (não dá ciência).
 *
 * Fala a mesma "língua" do cliente MNI (avisosPendentes/consultarProcesso), e
 * por isso a rodada, os avisos e a gravação dos andamentos são os mesmos do TJES.
 */
import { AvisoMni, ClienteMni, CredencialMni, ErroLoginMni, ErroRespostaMni, MovimentoMni, ProcessoMni } from '../mni/cliente';
import { Http, Navegador, criarNavegador } from './navegador';

export const BASE_TRT17 = 'https://pje.trt17.jus.br';
const API = `${BASE_TRT17}/pje-comum-api/api`;
const TAMANHO_PAGINA = 100;
const MAX_PAGINAS = 20;

export interface ClientePjeJt extends ClienteMni {
  /** Só o login (usado ao salvar a senha na tela). */
  entrar(cred: CredencialMni): Promise<void>;
  /** Nomes (não valores) do que o site devolveu — para conferir o formato sem expor dados. */
  diagnostico(): string[];
}

const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** Data do PJe (ISO com ou sem fuso, ou milissegundos) → AAAA-MM-DDThh:mm:ss no horário de Brasília. */
export function dataPjeParaIso(v: unknown): string | null {
  if (v == null || v === '') return null;
  const local = (d: Date) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 19);
  if (typeof v === 'number') return Number.isFinite(v) ? local(new Date(v)) : null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return null;
  if (m[4]) { const d = new Date(s); return Number.isNaN(d.getTime()) ? null : local(d); }
  return `${m[1]}T${m[2] || '00:00'}:${m[3] || '00'}`;
}

function textoDoErro(html: string): string | null {
  const m = html.match(/id="input-error"[^>]*>([\s\S]*?)</i) || html.match(/class="[^"]*(?:alert-error|kc-feedback-text)[^"]*"[^>]*>([\s\S]*?)</i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

function lerFormulario(html: string): { acao: string; campos: Record<string, string> } | null {
  const f = html.match(/<form[^>]*id="kc-form-login"[^>]*>[\s\S]*?<\/form>/i);
  if (!f) return null;
  const acao = f[0].match(/action="([^"]+)"/i);
  if (!acao) return null;
  const campos: Record<string, string> = {};
  for (const inp of f[0].match(/<input[^>]*>/gi) || []) {
    const nome = inp.match(/name="([^"]+)"/i)?.[1];
    if (!nome || /type="submit"/i.test(inp)) continue;
    campos[nome] = inp.match(/value="([^"]*)"/i)?.[1] ?? '';
  }
  return { acao: acao[1].replace(/&amp;/g, '&'), campos };
}

function idDoUsuario(jwt: string): number | null {
  try {
    const p = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    const id = Number(p.id ?? p.idUsuario ?? p.sub);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

const linhas = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.resultado) ? r.resultado : []);

export function criarClientePjeJt(opts: { grau: 'primeirograu' | 'segundograu'; http: Http }): ClientePjeJt {
  let nav: Navegador | null = null;
  let usuario: number | null = null;
  let logado: string | null = null; // CPF da sessão aberta
  let acervo: Map<string, number> | null = null;
  const formato = new Set<string>();

  async function entrar(cred: CredencialMni): Promise<void> {
    if (logado === cred.cpf && nav && usuario) return;
    nav = criarNavegador(opts.http);
    acervo = null;
    const inicio = await nav.ir(`${BASE_TRT17}/${opts.grau}/authenticateSSO.seam`);
    const form = lerFormulario(inicio.corpo);
    if (!form) throw new ErroRespostaMni(`O site do TRT17 não mostrou a tela de login esperada (HTTP ${inicio.status}). O site pode ter mudado.`);
    const campos = { ...form.campos, username: cred.cpf, password: cred.senha };
    const fim = await nav.ir(form.acao, {
      metodo: 'POST',
      corpo: new URLSearchParams(campos).toString(),
      cabecalhos: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (/name="(otp|totp)"|kc-otp-login-form/i.test(fim.corpo)) {
      throw new ErroLoginMni('o login do TRT17 pediu um código de verificação (2 fatores). O robô não consegue digitar esse código; o CRM parou de tentar.');
    }
    if (new URL(fim.url).hostname !== new URL(BASE_TRT17).hostname) {
      const erro = textoDoErro(fim.corpo);
      if (erro || lerFormulario(fim.corpo)) throw new ErroLoginMni(erro ? `o TRT17 respondeu: ${erro}` : 'usuário ou senha não aceitos pelo TRT17');
      throw new ErroLoginMni('o login do TRT17 pediu uma ação no site (por exemplo, trocar a senha ou aceitar um termo). Entre uma vez pelo navegador e tente de novo.');
    }
    let token = nav.cookie('pje.trt17.jus.br', 'access_token');
    if (!token) {
      // O site novo (pjekz) às vezes só entrega a chave ao ser aberto.
      await nav.ir(`${BASE_TRT17}/pjekz/`).catch(() => null);
      token = nav.cookie('pje.trt17.jus.br', 'access_token');
    }
    nav.nomesDosCookies().forEach((n) => formato.add(`cookie:${n}`));
    usuario = token ? idDoUsuario(token) : null;
    if (!usuario) throw new ErroRespostaMni('O login foi aceito, mas o site do TRT17 não entregou a chave de acesso esperada. O site pode ter mudado.');
    logado = cred.cpf;
  }

  async function api(caminho: string): Promise<any> {
    if (!nav) throw new ErroRespostaMni('Sem sessão no TRT17.');
    const xsrf = nav.cookie('pje.trt17.jus.br', 'Xsrf-Token') || nav.cookie('pje.trt17.jus.br', 'XSRF-TOKEN') || '';
    const r = await nav.ir(`${API}${caminho}`, { cabecalhos: { Accept: 'application/json', 'X-XSRF-TOKEN': xsrf }, maxRedirecionamentos: 2 });
    const rota = caminho.split('?')[0].replace(/\d+/g, ':n');
    if (r.status === 401 || r.status === 403) { logado = null; throw new ErroRespostaMni(`O TRT17 recusou a consulta (HTTP ${r.status}).`); }
    if (r.status !== 200) throw new ErroRespostaMni(`O TRT17 respondeu HTTP ${r.status}.`);
    try {
      const j = JSON.parse(r.corpo);
      const amostra = linhas(j)[0] ?? j;
      formato.add(`${rota}:${Array.isArray(j) ? 'lista' : 'objeto'}:${amostra && typeof amostra === 'object' ? Object.keys(amostra).slice(0, 25).join(',') : typeof amostra}`);
      return j;
    } catch {
      throw new ErroRespostaMni('O TRT17 devolveu uma resposta que não é JSON. O site pode ter mudado.');
    }
  }

  async function painel(tipo: 1 | 2): Promise<any[]> {
    const todas: any[] = [];
    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      const q = new URLSearchParams({
        pagina: String(pagina), tamanhoPagina: String(TAMANHO_PAGINA), tipoPainelAdvogado: String(tipo),
        idPainelAdvogadoEnum: String(tipo), ordenacaoCrescente: 'false',
      });
      const r = await api(`/paineladvogado/${usuario}/processos?${q}`);
      const l = linhas(r);
      todas.push(...l);
      const total = Number(r?.totalRegistros);
      if (!l.length || l.length < TAMANHO_PAGINA || (Number.isFinite(total) && todas.length >= total)) break;
    }
    return todas;
  }

  async function idDoProcesso(numero: string): Promise<number | null> {
    if (!acervo) {
      acervo = new Map();
      for (const l of await painel(1)) {
        const id = Number(l.idProcesso ?? l.id);
        const n = soDigitos(l.numeroProcesso ?? l.numeroProcessoCompleto ?? l.numero);
        if (id && n.length === 20) acervo.set(n, id);
      }
    }
    return acervo.get(numero) ?? null;
  }

  return {
    entrar,
    diagnostico: () => [...formato],

    async avisosPendentes(cred) {
      await entrar(cred);
      const out: AvisoMni[] = [];
      const expedientesPorProcesso = new Map<number, any[]>();
      for (const l of await painel(2)) {
        const idProcesso = Number(l.idProcesso ?? l.id);
        const numero = soDigitos(l.numeroProcesso ?? l.numeroProcessoCompleto);
        const idExp = l.idProcessoParteExpediente ?? l.idExpediente ?? null;
        // Detalhe do expediente (data, tipo): só o desta linha, que é o da Dra.
        let exp: any = null;
        if (idProcesso) {
          if (!expedientesPorProcesso.has(idProcesso)) {
            const q = 'completo=true&somenteAbertas=true&somenteComDocumentosAssinados=false';
            expedientesPorProcesso.set(idProcesso, linhas(await api(`/processos/id/${idProcesso}/expedientes?${q}`).catch(() => [])));
          }
          exp = expedientesPorProcesso.get(idProcesso)!.find((e) => idExp != null && String(e.id ?? e.idProcessoParteExpediente) === String(idExp)) ?? null;
        }
        if (exp?.dataCiencia) continue; // já com ciência: não está mais pendente de abrir
        out.push({
          idAviso: String(idExp ?? `${idProcesso}-${l.dataPrazoFinal ?? ''}`),
          tipoComunicacao: (exp?.tipoExpediente && String(exp.tipoExpediente)) || l.tipoExpediente || 'Expediente',
          numeroProcesso: numero.length === 20 ? numero : null,
          orgaoJulgador: l.descricaoOrgaoJulgador ?? l.orgaoJulgador?.descricao ?? (typeof l.orgaoJulgador === 'string' ? l.orgaoJulgador : null),
          disponibilizadoEm: dataPjeParaIso(exp?.dataCriacao ?? l.dataCriacao ?? null),
        });
      }
      return out;
    },

    async consultarProcesso(cred, numeroProcesso) {
      await entrar(cred);
      const numero = soDigitos(numeroProcesso);
      const id = await idDoProcesso(numero);
      if (!id) throw new ErroRespostaMni('Processo não está no painel da Dra. neste grau do TRT17.');
      const q = 'somenteDocumentosAssinados=false&buscarMovimentos=true&buscarDocumentos=false';
      const itens = linhas(await api(`/processos/id/${id}/timeline?${q}`));
      const movimentos: MovimentoMni[] = itens
        .map((i) => ({
          dataHora: dataPjeParaIso(i.data ?? i.dataMovimento ?? i.atualizadoEm),
          identificador: i.id != null ? String(i.id) : null,
          codigoNacional: null,
          descricao: String(i.titulo ?? i.descricao ?? '').replace(/\s+/g, ' ').trim() || null,
          complementos: [],
        }))
        .filter((m) => m.descricao && m.dataHora);
      const p: ProcessoMni = { numero, orgaoJulgador: null, movimentos, partes: [], valorCausa: null };
      return p;
    },
  };
}
