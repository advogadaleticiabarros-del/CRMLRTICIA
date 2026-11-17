/**
 * Ligação oficial com os sistemas dos tribunais (MNI — Modelo Nacional de
 * Interoperabilidade do CNJ, versão 2.2.2), com o login da advogada.
 *
 * SÓ LEITURA, por construção. Este módulo conhece apenas duas operações:
 *  - consultarAvisosPendentes: lista as intimações ainda não abertas;
 *  - consultarProcesso: dados básicos e movimentações (SEM documentos).
 * Ele NÃO tem (e não deve ganhar) consultarTeorComunicacao nem
 * confirmarRecebimento — abrir a intimação pelo sistema pode registrar a
 * ciência e começar a contar o prazo — nem entregarManifestacaoProcessual
 * (protocolo). O teste tests/mniCliente.test.mjs trava isso.
 *
 * Formato das respostas conferido em 17/11/2026 no PJe do TJES (1º grau) e no
 * eproc da JFES, a partir de um esqueleto sem dados pessoais.
 */

export interface CredencialMni { cpf: string; senha: string }

export interface AvisoMni {
  idAviso: string;
  tipoComunicacao: string | null;
  numeroProcesso: string | null;
  orgaoJulgador: string | null;
  /** Data e hora em que a intimação foi disponibilizada (ISO, horário de Brasília sem fuso). */
  disponibilizadoEm: string | null;
}

export interface MovimentoMni {
  /** ISO local (AAAA-MM-DDThh:mm:ss), horário do tribunal. */
  dataHora: string | null;
  identificador: string | null;
  /** Código da Tabela Processual Unificada do CNJ (PJe manda só ele). */
  codigoNacional: number | null;
  /** Nome por extenso quando o sistema manda (eproc manda em movimentoLocal). */
  descricao: string | null;
  complementos: string[];
}

export interface ProcessoMni {
  numero: string | null;
  orgaoJulgador: string | null;
  movimentos: MovimentoMni[];
}

/** Login recusado pelo tribunal. Quem chama deve PARAR de tentar (risco de bloquear a senha). */
export class ErroLoginMni extends Error {
  constructor(mensagem: string) { super(mensagem); this.name = 'ErroLoginMni'; }
}

/** Resposta veio, mas sem sucesso (ex.: processo não encontrado, sigilo). */
export class ErroRespostaMni extends Error {
  constructor(mensagem: string) { super(mensagem); this.name = 'ErroRespostaMni'; }
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ status: number; text(): Promise<string> }>;

// ── XML ─────────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function decodificarEntidades(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function montarEnvelope(operacao: 'consultarAvisosPendentes' | 'consultarProcesso', cred: CredencialMni, extra = ''): string {
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"'
    + ' xmlns:ser="http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/"'
    + ' xmlns:tip="http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2">'
    + `<soapenv:Header/><soapenv:Body><ser:${operacao}>`
    + `<tip:idConsultante>${esc(cred.cpf.replace(/\D/g, ''))}</tip:idConsultante>`
    + `<tip:senhaConsultante>${esc(cred.senha)}</tip:senhaConsultante>`
    + extra
    + `</ser:${operacao}></soapenv:Body></soapenv:Envelope>`;
}

/** Atributos de uma tag de abertura, sem prefixo de namespace. */
function atributos(tagAbertura: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tagAbertura.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const nome = m[1].replace(/^[\w-]+:/, '');
    if (m[1].startsWith('xmlns')) continue;
    out[nome] = decodificarEntidades(m[2] ?? m[3] ?? '');
  }
  return out;
}

/** Blocos <nome ...>...</nome> (ou auto-fechados) em qualquer prefixo, não aninhados entre si. */
function blocos(xml: string, nome: string): Array<{ abertura: string; conteudo: string }> {
  const re = new RegExp(`<((?:[\\w-]+:)?${nome})(\\s[^>]*?)?(/?)>`, 'g');
  const out: Array<{ abertura: string; conteudo: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const abertura = m[0];
    if (m[3] === '/') { out.push({ abertura, conteudo: '' }); continue; }
    const fecha = `</${m[1]}>`;
    // Profundidade, para o caso (raro) de tag com o mesmo nome dentro.
    let prof = 1;
    const i = re.lastIndex;
    const reTag = new RegExp(`<(/?)${m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s[^>]*?)?(/?)>`, 'g');
    reTag.lastIndex = i;
    let fim = -1;
    let t: RegExpExecArray | null;
    while ((t = reTag.exec(xml))) {
      if (t[3] === '/') continue;
      if (t[1] === '/') { prof--; if (prof === 0) { fim = t.index; break; } } else prof++;
    }
    if (fim < 0) { fim = xml.indexOf(fecha, i); if (fim < 0) break; }
    out.push({ abertura, conteudo: xml.slice(i, fim) });
    re.lastIndex = fim + fecha.length;
  }
  return out;
}

function textoDe(xml: string, nome: string): string | null {
  const b = blocos(xml, nome)[0];
  if (!b) return null;
  const t = decodificarEntidades(b.conteudo.replace(/<[^>]+>/g, '')).trim();
  return t || null;
}

/** "20261110120000" → "2026-11-10T12:00:00" (horário local do tribunal). */
export function dataMni(v: string | null | undefined): string | null {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length < 8) return null;
  const hh = d.slice(8, 10) || '00', mi = d.slice(10, 12) || '00', ss = d.slice(12, 14) || '00';
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${hh}:${mi}:${ss}`;
}

/** Sucesso + mensagem; lança ErroLoginMni se a recusa for de login. */
export function verificarResposta(xml: string): { sucesso: boolean; mensagem: string } {
  const fault = textoDe(xml, 'faultstring');
  const sucesso = /^true$/i.test(textoDe(xml, 'sucesso') || '');
  // O tribunal costuma repetir o CPF na mensagem de erro: mascara antes de
  // a mensagem ir para o banco, o sino ou o log das rotinas (LGPD).
  const mensagem = mascararCpf((textoDe(xml, 'mensagem') || fault || '').replace(/\s+/g, ' ').trim());
  if (!sucesso && ehRecusaDeLogin(mensagem)) throw new ErroLoginMni(mensagem || 'Login recusado pelo tribunal');
  return { sucesso, mensagem };
}

/** "usuário 12345678901" / "123.456.789-01" → "usuário ***.***.***-**". */
export function mascararCpf(texto: string): string {
  return String(texto || '').replace(/(?<!\d)(\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?!\d)/g, '***.***.***-**');
}

/** Mensagens de login recusado vistas nos tribunais (PJe e eproc). */
export function ehRecusaDeLogin(mensagem: string): boolean {
  return /login|senha|autentica|n[ãa]o est[áa] corretamente cadastrado|bloquead|usu[áa]rio inv[áa]lido/i.test(mensagem || '');
}

export function lerAvisos(xml: string): AvisoMni[] {
  return blocos(xml, 'aviso').map(({ abertura, conteudo }) => {
    const a = atributos(abertura);
    const proc = blocos(conteudo, 'processo')[0];
    const pa = proc ? atributos(proc.abertura) : {};
    const orgao = proc ? blocos(proc.conteudo, 'orgaoJulgador')[0] : undefined;
    return {
      idAviso: a.idAviso || '',
      tipoComunicacao: a.tipoComunicacao || null,
      numeroProcesso: (pa.numero || '').replace(/\D/g, '') || null,
      orgaoJulgador: orgao ? (atributos(orgao.abertura).nomeOrgao || null) : null,
      disponibilizadoEm: dataMni(textoDe(conteudo, 'dataDisponibilizacao')),
    };
  }).filter((a) => a.idAviso);
}

export function lerProcesso(xml: string): ProcessoMni {
  const proc = blocos(xml, 'processo')[0];
  if (!proc) return { numero: null, orgaoJulgador: null, movimentos: [] };
  const db = blocos(proc.conteudo, 'dadosBasicos')[0];
  const dba = db ? atributos(db.abertura) : {};
  const orgao = db ? blocos(db.conteudo, 'orgaoJulgador')[0] : undefined;
  const movimentos = blocos(proc.conteudo, 'movimento').map(({ abertura, conteudo }) => {
    const a = atributos(abertura);
    const nac = blocos(conteudo, 'movimentoNacional')[0];
    const loc = blocos(conteudo, 'movimentoLocal')[0];
    const la = loc ? atributos(loc.abertura) : {};
    const na = nac ? atributos(nac.abertura) : {};
    const codigo = Number(na.codigoNacional || la.codigoPaiNacional || NaN);
    const complementos = blocos(conteudo, 'complemento')
      .map((c) => decodificarEntidades(c.conteudo.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return {
      dataHora: dataMni(a.dataHora),
      identificador: a.identificadorMovimento || null,
      codigoNacional: Number.isFinite(codigo) ? codigo : null,
      descricao: (la.descricao || '').trim() || null,
      complementos,
    };
  });
  return {
    numero: (dba.numero || '').replace(/\D/g, '') || null,
    orgaoJulgador: orgao ? (atributos(orgao.abertura).nomeOrgao || null) : null,
    movimentos,
  };
}

// ── Cliente ─────────────────────────────────────────────────────────────────

export interface ClienteMni {
  avisosPendentes(cred: CredencialMni): Promise<AvisoMni[]>;
  consultarProcesso(cred: CredencialMni, numeroProcesso: string): Promise<ProcessoMni>;
}

export function criarClienteMni(opts: { url: string; fetch?: Fetch; timeoutMs?: number }): ClienteMni {
  const f: Fetch = opts.fetch ?? ((u, i) => fetch(u, i as any) as any);
  const timeoutMs = opts.timeoutMs ?? 90_000;

  async function chamar(corpo: string): Promise<string> {
    const r = await f(opts.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""' },
      body: corpo,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const xml = await r.text();
    if (r.status === 403) throw new ErroRespostaMni('O tribunal recusou a conexão (HTTP 403) — o serviço pode exigir credenciamento.');
    if (r.status >= 500 && !/Envelope/.test(xml)) throw new ErroRespostaMni(`Tribunal fora do ar (HTTP ${r.status}).`);
    return xml;
  }

  return {
    async avisosPendentes(cred) {
      const xml = await chamar(montarEnvelope('consultarAvisosPendentes', cred));
      const { sucesso, mensagem } = verificarResposta(xml);
      if (!sucesso) throw new ErroRespostaMni(mensagem || 'Consulta de avisos sem sucesso');
      return lerAvisos(xml);
    },
    async consultarProcesso(cred, numeroProcesso) {
      const numero = numeroProcesso.replace(/\D/g, '');
      const extra = `<tip:numeroProcesso>${numero}</tip:numeroProcesso>`
        + '<tip:movimentos>true</tip:movimentos>'
        + '<tip:incluirCabecalho>true</tip:incluirCabecalho>'
        + '<tip:incluirDocumentos>false</tip:incluirDocumentos>';
      const xml = await chamar(montarEnvelope('consultarProcesso', cred, extra));
      const { sucesso, mensagem } = verificarResposta(xml);
      if (!sucesso) throw new ErroRespostaMni(mensagem || 'Consulta do processo sem sucesso');
      return lerProcesso(xml);
    },
  };
}
