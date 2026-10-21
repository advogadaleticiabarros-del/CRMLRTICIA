/**
 * Pesquisa de Leis — regras puras (sem banco, sem rede, sem IA).
 *
 * O acervo vem do repositório público ctresb/leis (Constituição, leis e
 * decretos federais, leis do ES, súmulas/OJs/temas do STF, STJ, TST e TNU e
 * atos do INSS e do MTE), um arquivo Markdown por norma com cabeçalho YAML.
 * Aqui ficam as regras que o resto do módulo usa:
 *  - lerNorma / dividirEmDispositivos: um arquivo → norma + artigos;
 *  - extrairCitacoes: acha "art. 482 da CLT", "Lei 8.213/91, art. 42",
 *    "Súmula 331 do TST", "OJ 394 da SDI-1", "Tema 1046 do STF" num texto;
 *  - montarConsulta / ordenarResultados: a busca por palavras;
 *  - formatarCitacao / avaliarCitacao / blocoFundamentos / relatorioConferencia:
 *    o que a Dra. Júlia (pesquisa) e a Dra. Vera (conferência) entregam.
 */

export type Esfera = 'constituicao' | 'federal' | 'estadual' | 'jurisprudencia' | 'regulador';

export interface NormaLida {
  caminho: string;
  titulo: string;
  tipo: string;
  tipoChave: string;
  numero: string;
  data: string | null;
  ano: number | null;
  ementa: string;
  situacao: string;
  revogada: boolean;
  uf: string | null;
  tribunal: string | null;
  orgao: string | null;
  esfera: Esfera;
  fonte: string;
  urn: string;
  versao: string;
  apelido: string | null;
  corpo: string;
}

export interface Dispositivo {
  ordem: number;
  parte: number;
  principal: boolean;
  rotulo: string;
  numero: string;
  revogado: boolean;
  texto: string;
}

/** minúsculas sem acento, mantendo o tamanho do texto (posições valem no original). */
export const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s: string) => semAcento(String(s || '')).toLowerCase();

/**
 * Versão das regras de leitura (artigos, partes, limpeza). Suba o número ao
 * mudar lerNorma/dividirEmDispositivos: a próxima atualização relê o acervo todo.
 */
export const VERSAO_REGRAS = 4;

// ── O que entra no acervo ───────────────────────────────────────────────────
/** Pastas do repositório que o CRM baixa (sparse checkout) e indexa. */
export const PASTAS_DO_ACERVO = [
  '/constituicao.md',
  '/federal/leis-ordinarias/', '/federal/leis-complementares/', '/federal/decretos-lei/',
  '/federal/leis-delegadas/', '/federal/emendas-constitucionais/', '/federal/regulamentos/',
  '/federal/decretos/1988/', '/federal/decretos/1989/', '/federal/decretos/199*/', '/federal/decretos/20*/',
  '/estaduais/ES/',
  '/jurisprudencia/stf/', '/jurisprudencia/stj/', '/jurisprudencia/tst/', '/jurisprudencia/tnu/',
  '/reguladores/inss/', '/reguladores/mte/',
];

const PREFIXOS = PASTAS_DO_ACERVO.filter((p) => !p.includes('*') && p.endsWith('/')).map((p) => p.slice(1));

/** O arquivo faz parte do acervo? (só .md das pastas acima, sem as pastas internas "_..."). */
export function caminhoNoAcervo(caminho: string): boolean {
  const c = String(caminho || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (c === 'constituicao.md') return true;
  if (!c.endsWith('.md')) return false;
  if (c.split('/').some((seg) => seg.startsWith('_'))) return false;
  const dec = c.match(/^federal\/decretos\/(\d{4})\//);
  if (dec) return Number(dec[1]) >= 1988;
  return PREFIXOS.some((p) => c.startsWith(p));
}

// ── Códigos e leis conhecidas pelo apelido ─────────────────────────────────
export interface RefNorma {
  tipo: string;
  numero?: string;
  ano?: number | null;
  apelido?: string;
  uf?: string;
  parte?: 'adct';
}

interface Codigo {
  apelido: string;
  nomes: string[];
  ref: RefNorma;
  /** aparece na citação formatada ("art. 482 da CLT"); senão sai pelo número. */
  exibir: boolean;
  feminino: boolean;
  nomeLongo?: string;
}

export const CODIGOS: Codigo[] = [
  { apelido: 'CF', nomes: ['constituicao federal de 1988', 'constituicao federal', 'constituicao da republica', 'carta magna', 'crfb/1988', 'crfb/88', 'crfb', 'cf/1988', 'cf/88', 'cf'], ref: { tipo: 'cf' }, exibir: true, feminino: true, nomeLongo: 'Constituição Federal' },
  { apelido: 'ADCT', nomes: ['adct', 'ato das disposicoes constitucionais transitorias'], ref: { tipo: 'cf', parte: 'adct' }, exibir: true, feminino: false, nomeLongo: 'ADCT' },
  { apelido: 'CE/ES', nomes: ['constituicao estadual', 'constituicao do estado do espirito santo', 'constituicao do estado'], ref: { tipo: 'ce', uf: 'ES' }, exibir: true, feminino: true, nomeLongo: 'Constituição do Estado do Espírito Santo' },
  { apelido: 'CLT', nomes: ['clt', 'consolidacao das leis do trabalho'], ref: { tipo: 'dl', numero: '5452', ano: 1943 }, exibir: true, feminino: true },
  { apelido: 'CPC', nomes: ['cpc/2015', 'cpc/15', 'novo cpc', 'cpc', 'codigo de processo civil'], ref: { tipo: 'lei', numero: '13105', ano: 2015 }, exibir: true, feminino: false },
  { apelido: 'CC', nomes: ['cc/2002', 'cc/02', 'codigo civil', 'cc'], ref: { tipo: 'lei', numero: '10406', ano: 2002 }, exibir: true, feminino: false },
  { apelido: 'CDC', nomes: ['cdc', 'codigo de defesa do consumidor'], ref: { tipo: 'lei', numero: '8078', ano: 1990 }, exibir: true, feminino: false },
  { apelido: 'CPP', nomes: ['cpp', 'codigo de processo penal'], ref: { tipo: 'dl', numero: '3689', ano: 1941 }, exibir: true, feminino: false },
  { apelido: 'CP', nomes: ['codigo penal', 'cp'], ref: { tipo: 'dl', numero: '2848', ano: 1940 }, exibir: true, feminino: false },
  { apelido: 'CTN', nomes: ['ctn', 'codigo tributario nacional'], ref: { tipo: 'lei', numero: '5172', ano: 1966 }, exibir: true, feminino: false },
  { apelido: 'ECA', nomes: ['eca', 'estatuto da crianca e do adolescente'], ref: { tipo: 'lei', numero: '8069', ano: 1990 }, exibir: true, feminino: false },
  { apelido: 'LINDB', nomes: ['lindb', 'lei de introducao as normas do direito brasileiro'], ref: { tipo: 'dl', numero: '4657', ano: 1942 }, exibir: true, feminino: true },
  { apelido: 'LGPD', nomes: ['lgpd', 'lei geral de protecao de dados'], ref: { tipo: 'lei', numero: '13709', ano: 2018 }, exibir: true, feminino: true },
  { apelido: 'Lei de Benefícios', nomes: ['lei de beneficios da previdencia social', 'plano de beneficios da previdencia social', 'lei de beneficios', 'lbps'], ref: { tipo: 'lei', numero: '8213', ano: 1991 }, exibir: false, feminino: true },
  { apelido: 'Lei de Custeio', nomes: ['lei de custeio', 'lei organica da seguridade social', 'pcss'], ref: { tipo: 'lei', numero: '8212', ano: 1991 }, exibir: false, feminino: true },
  { apelido: 'LOAS', nomes: ['loas', 'lei organica da assistencia social'], ref: { tipo: 'lei', numero: '8742', ano: 1993 }, exibir: false, feminino: true },
  { apelido: 'RPS', nomes: ['rps', 'regulamento da previdencia social'], ref: { tipo: 'decreto', numero: '3048', ano: 1999 }, exibir: false, feminino: false },
  { apelido: 'Estatuto da Pessoa Idosa', nomes: ['estatuto da pessoa idosa', 'estatuto do idoso'], ref: { tipo: 'lei', numero: '10741', ano: 2003 }, exibir: false, feminino: true },
  { apelido: 'Estatuto da Pessoa com Deficiência', nomes: ['estatuto da pessoa com deficiencia', 'lei brasileira de inclusao', 'lbi'], ref: { tipo: 'lei', numero: '13146', ano: 2015 }, exibir: false, feminino: true },
  { apelido: 'Lei Maria da Penha', nomes: ['lei maria da penha'], ref: { tipo: 'lei', numero: '11340', ano: 2006 }, exibir: false, feminino: true },
  { apelido: 'Lei de Alimentos', nomes: ['lei de alimentos'], ref: { tipo: 'lei', numero: '5478', ano: 1968 }, exibir: false, feminino: true },
  { apelido: 'Estatuto da OAB', nomes: ['estatuto da advocacia', 'estatuto da oab', 'eaoab'], ref: { tipo: 'lei', numero: '8906', ano: 1994 }, exibir: false, feminino: true },
  { apelido: 'Lei do FGTS', nomes: ['lei do fgts'], ref: { tipo: 'lei', numero: '8036', ano: 1990 }, exibir: false, feminino: true },
  { apelido: 'Reforma Trabalhista', nomes: ['reforma trabalhista'], ref: { tipo: 'lei', numero: '13467', ano: 2017 }, exibir: false, feminino: true },
  { apelido: 'Lei do Trabalho Doméstico', nomes: ['lei do trabalho domestico', 'lei das domesticas'], ref: { tipo: 'lc', numero: '150', ano: 2015 }, exibir: false, feminino: true },
  { apelido: 'Lei do Trabalho Temporário', nomes: ['lei do trabalho temporario', 'lei da terceirizacao'], ref: { tipo: 'lei', numero: '6019', ano: 1974 }, exibir: false, feminino: true },
  { apelido: 'Lei dos Juizados Especiais', nomes: ['lei dos juizados especiais federais'], ref: { tipo: 'lei', numero: '10259', ano: 2001 }, exibir: false, feminino: true },
  { apelido: 'Lei dos Juizados Especiais', nomes: ['lei dos juizados especiais'], ref: { tipo: 'lei', numero: '9099', ano: 1995 }, exibir: false, feminino: true },
  { apelido: 'Lei do Inquilinato', nomes: ['lei do inquilinato'], ref: { tipo: 'lei', numero: '8245', ano: 1991 }, exibir: false, feminino: true },
  { apelido: 'Lei do Mandado de Segurança', nomes: ['lei do mandado de seguranca'], ref: { tipo: 'lei', numero: '12016', ano: 2009 }, exibir: false, feminino: true },
  { apelido: 'Lei de Execução Fiscal', nomes: ['lei de execucao fiscal', 'lef'], ref: { tipo: 'lei', numero: '6830', ano: 1980 }, exibir: false, feminino: true },
];

/** Atalhos da tela (os mais usados nas áreas do escritório). */
export const ATALHOS = ['CF', 'CLT', 'CPC', 'CC', 'CDC', 'Lei de Benefícios', 'Lei de Custeio', 'RPS', 'LOAS', 'ECA', 'Lei de Alimentos', 'Lei do Trabalho Doméstico', 'Estatuto da Pessoa Idosa', 'Lei Maria da Penha']
  .map((a) => CODIGOS.find((c) => c.apelido === a)!)
  .map((c) => ({ apelido: c.apelido, ref: c.ref }));

function codigoDaNorma(tipoChave: string, numero: string, ano: number | null): Codigo | null {
  return CODIGOS.find((c) => c.ref.tipo === tipoChave && c.ref.numero === numero && (c.ref.ano == null || c.ref.ano === ano) && !c.ref.parte) || null;
}

// ── Ler a norma ────────────────────────────────────────────────────────────
const TIPO_CHAVE: Record<string, string> = {
  'lei ordinaria': 'lei', 'lei': 'lei', 'lei complementar': 'lc', 'decreto-lei': 'dl', 'decreto lei': 'dl',
  'decreto': 'decreto', 'lei delegada': 'ldel', 'emenda constitucional': 'ec', 'emenda constitucional de revisao': 'ecr',
  'constituicao estadual': 'ce', 'constituicao federal': 'cf', 'decreto legislativo': 'dleg', 'resolucao': 'resolucao',
  'portaria': 'portaria', 'instrucao normativa': 'in', 'recomendacao': 'recomendacao', 'sumula': 'sumula',
  'sumula vinculante': 'sumula_vinculante', 'orientacao jurisprudencial': 'oj', 'tema de repercussao geral': 'tema_rg',
  'tema repetitivo': 'tema_rep', 'adi': 'controle', 'adc': 'controle', 'ado': 'controle', 'adpf': 'controle', 'puil': 'puil',
};

function tirarAspas(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try { return JSON.parse(t); } catch { return t.slice(1, -1); }
  }
  return t;
}

function lerCabecalho(md: string): { campos: Record<string, string>; corpo: string } {
  const texto = md.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  const m = texto.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { campos: {}, corpo: texto };
  const campos: Record<string, string> = {};
  for (const linha of m[1].split('\n')) {
    const i = linha.indexOf(':');
    if (i <= 0 || /^\s/.test(linha)) continue;
    campos[linha.slice(0, i).trim()] = tirarAspas(linha.slice(i + 1));
  }
  return { campos, corpo: texto.slice(m[0].length) };
}

function esferaDoCaminho(c: string): Esfera {
  if (c === 'constituicao.md') return 'constituicao';
  if (c.startsWith('estaduais/')) return 'estadual';
  if (c.startsWith('jurisprudencia/')) return 'jurisprudencia';
  if (c.startsWith('reguladores/')) return 'regulador';
  return 'federal';
}

const numeroLimpo = (n: string) => (/^[\d.]+$/.test(n.trim()) ? n.replace(/\./g, '').replace(/^0+(?=\d)/, '') : n.trim().toUpperCase());

export function lerNorma(caminho: string, md: string): NormaLida {
  const c = String(caminho || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const { campos, corpo } = lerCabecalho(String(md || ''));
  const esfera = esferaDoCaminho(c);
  const segs = c.split('/');
  const tituloMd = (corpo.match(/^#\s+(.+)$/m) || [])[1]?.trim() || '';
  const constituicao = esfera === 'constituicao';
  const tipo = campos.tipo || (constituicao ? 'Constituição Federal' : '');
  const tipoChave = TIPO_CHAVE[norm(tipo)] || norm(tipo).replace(/[^a-z0-9]+/g, '_') || 'outro';
  const numero = numeroLimpo(campos.numero || '');
  const data = /^\d{4}-\d{2}-\d{2}$/.test(campos.data || '') ? campos.data : null;
  const anoTxt = data ? data.slice(0, 4) : (campos.ano || (constituicao ? '1988' : ''));
  const ano = /^\d{4}$/.test(anoTxt) ? Number(anoTxt) : null;
  // Súmula/OJ cancelada às vezes só diz isso no próprio enunciado ("(cancelada em
  // decorrência…)"), com o cabeçalho ainda "revogada: false": olha o começo do texto.
  const inicioJuris = esfera === 'jurisprudencia'
    ? norm(corpo.replace(/^#.*$/m, '').replace(/-\r?\n/g, '').slice(0, 400)) : '';
  const revogada = campos.revogada === 'true' || /cancelad|revogad/.test(norm(campos.situacao || ''))
    || /\(\s*cancelad[ao]/.test(inicioJuris);
  return {
    caminho: c,
    titulo: campos.titulo || tituloMd || c,
    tipo,
    tipoChave,
    numero,
    data,
    ano,
    ementa: campos.ementa || '',
    situacao: campos.situacao || '',
    revogada,
    uf: campos.uf || (esfera === 'estadual' ? segs[1] || null : null),
    tribunal: campos.tribunal || (esfera === 'jurisprudencia' ? (segs[1] || '').toUpperCase() || null : null),
    orgao: esfera === 'regulador' ? (segs[1] || '').toUpperCase() || null : null,
    esfera,
    fonte: campos.fonte || (constituicao ? 'https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm' : ''),
    urn: campos.urn || '',
    versao: campos.versao_texto || (constituicao ? 'texto vigente (Planalto)' : ''),
    apelido: constituicao ? 'CF' : esfera === 'federal' ? codigoDaNorma(tipoChave, numero, ano)?.apelido || null : null,
    corpo,
  };
}

// ── Artigos ────────────────────────────────────────────────────────────────
/** "1º" → "1", "1.025" → "1025", "477-a" → "477-A", "único" → "unico". */
export function normalizarArtigo(a: string): string {
  const t = norm(a).replace(/\s+/g, '');
  if (/^unico/.test(t)) return 'unico';
  const m = t.match(/^(\d[\d.]*)(?:º|°|ª|o)?(?:-([a-z]))?/);
  if (!m) return t;
  return m[1].replace(/\./g, '') + (m[2] ? '-' + m[2].toUpperCase() : '');
}

// Início de artigo: no começo da linha (citação, blockquote ">" e negrito aceitos,
// aspas não — "Art. 2º ..." entre aspas é redação dada a outra lei).
const INICIO_ARTIGO = /^[\s>]*art(?:igo)?\.?\s*(?:(\d{1,3}(?:\.\d{3})+|\d+)(º|°|ª|o(?![a-z]))?(-[a-z](?![a-z]))?|(único|unico)\b)/i;
const FECHO = /^\s*(bras[ií]lia|rio de janeiro|pal[aá]cio anchieta|vit[oó]ria|sala das sess[oõ]es)\s*[,(]?\s*(\d|em\s+\d|aos?\s)/i;
const limparMarcacao = (s: string) => s.replace(/~~[^~]*~~/g, '').replace(/[*_]+/g, '');
const limparTexto = (linhas: string[]) => linhas
  .map((l) => limparMarcacao(l).replace(/^\s*(>\s*)+/, '').replace(/[ \t]+$/g, ''))
  .join('\n').replace(/\n{3,}/g, '\n\n').trim();

const TAM_TRECHO = 4000;
function emTrechos(texto: string): string[] {
  const out: string[] = [];
  let atual = '';
  for (const p of texto.split(/\n{2,}/)) {
    let par = p.trim();
    if (!par) continue;
    while (par.length > TAM_TRECHO) { if (atual) { out.push(atual); atual = ''; } out.push(par.slice(0, TAM_TRECHO)); par = par.slice(TAM_TRECHO); }
    if (atual && atual.length + par.length + 2 > TAM_TRECHO) { out.push(atual); atual = ''; }
    atual = atual ? `${atual}\n\n${par}` : par;
  }
  if (atual) out.push(atual);
  return out;
}

export function dividirEmDispositivos(norma: Pick<NormaLida, 'corpo' | 'esfera' | 'titulo'>): Dispositivo[] {
  const juris = norma.esfera === 'jurisprudencia';
  let corpo = norma.corpo.replace(/\r\n?/g, '\n');
  // Jurisprudência: blocos de dados brutos da fonte (```json```) saem; a
  // hifenização de fim de linha dos cadernos em PDF ("alimen-\ntante") é desfeita.
  if (juris) {
    corpo = corpo.replace(/```[\s\S]*?```/g, '').replace(/([a-zà-ú])-\n([a-zà-ú])/gi, '$1$2')
      .replace(/^#{2,6}\s+(.+)$/gm, '$1'); // "## Tese" → "Tese"
  }
  const linhas = corpo.split('\n');
  const brutos: { rotulo: string; numero: string; linhas: string[] }[] = [];
  let atual: { rotulo: string; numero: string; linhas: string[] } | null = null;
  let fechado = false;
  for (const linha of linhas) {
    if (/^#{1,6}\s/.test(linha)) continue; // títulos e seções não são texto de artigo
    const limpa = limparMarcacao(linha);
    const m = juris ? null : limpa.match(INICIO_ARTIGO); // "Art." em precedente é citação, não artigo
    if (m) {
      const unico = !!m[4];
      const numero = unico ? 'unico' : normalizarArtigo(m[1] + (m[2] || '') + (m[3] || ''));
      const rotulo = unico ? 'Art. único' : `Art. ${m[1]}${m[2] ? 'º' : ''}${m[3] ? m[3].toUpperCase() : ''}`;
      atual = { rotulo, numero, linhas: [linha] };
      brutos.push(atual);
      fechado = false;
      continue;
    }
    if (!atual) continue;
    if (FECHO.test(limpa)) { fechado = true; continue; }
    if (!fechado) atual.linhas.push(linha);
  }

  if (!brutos.length) {
    const texto = limparTexto(linhas.filter((l) => !/^#\s/.test(l)));
    const trechos = emTrechos(texto);
    return trechos.map((t, i) => ({
      ordem: i, parte: 0, principal: true, numero: '', revogado: false, texto: t,
      rotulo: juris ? (trechos.length > 1 ? `${norma.titulo} (parte ${i + 1})` : norma.titulo) : `Trecho ${i + 1}`,
    }));
  }

  // Partes: a numeração recomeça em 1 (decreto que aprova + texto anexo, CF + ADCT).
  const valor = (n: string) => (n === 'unico' ? 1 : parseInt(n, 10) || 0);
  let parte = 0, anterior = 0;
  const comParte = brutos.map((b) => {
    const v = valor(b.numero);
    if (v === 1 && anterior >= 1) parte++;
    anterior = v;
    return { ...b, parte };
  });
  const porParte = new Map<number, number>();
  for (const b of comParte) porParte.set(b.parte, (porParte.get(b.parte) || 0) + 1);
  const partePrincipal = [...porParte.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  const naPrincipal = new Set(comParte.filter((b) => b.parte === partePrincipal).map((b) => b.numero));
  const jaVisto = new Set<string>();

  return comParte.map((b, ordem) => {
    const texto = limparTexto(b.linhas).slice(0, 30000);
    const resto = norm(texto.replace(INICIO_ARTIGO, '')).replace(/^[\s.:\-–—]+/, '');
    const principal = b.parte === partePrincipal || (!naPrincipal.has(b.numero) && !jaVisto.has(b.numero));
    jaVisto.add(b.numero);
    return {
      ordem, parte: b.parte, principal, rotulo: b.rotulo, numero: b.numero, texto,
      revogado: /^[\s([]*(revogad[oa]|vetad[oa]|suprimid[oa])/.test(resto),
    };
  });
}

// ── Citações num texto (peça, intimação, pergunta) ─────────────────────────
export type TipoCitacao = 'artigo' | 'norma' | 'sumula' | 'sumula_vinculante' | 'oj' | 'tema_rg' | 'tema_rep';

export interface Citacao {
  tipo: TipoCitacao;
  trecho: string;
  posicao: number;
  norma?: RefNorma;
  artigos: string[];
  detalhe: string;
  tribunal?: string;
  numero?: string;
}

const anoCompleto = (a?: string | null): number | null => {
  if (!a) return null;
  const n = Number(a);
  if (a.length === 4) return n;
  const corte = new Date().getFullYear() % 100;
  return n <= corte ? 2000 + n : 1900 + n;
};

const NUM = String.raw`(\d{1,3}(?:\.\d{3})+|\d+)`;
const ORD = String.raw`(?:º|°|ª|o(?![a-z]))?`;
const ART_ITEM = String.raw`\d[\d.]*` + ORD + String.raw`(?:-[a-z](?![a-z]))?`;
const RE_ARTIGOS = new RegExp(String.raw`\bart(?:igo)?s?\.?\s*(${ART_ITEM}(?:\s*(?:,|e|a|ate)\s*${ART_ITEM})*)`, 'g');
const TIPOS_POR_NUMERO: [string, string][] = [
  ['lei complementar', 'lc'], ['decreto-lei', 'dl'], ['decreto lei', 'dl'], ['emenda constitucional', 'ec'],
  ['lei comp.', 'lc'], ['decreto', 'dl_ou_decreto'], ['lei', 'lei'], ['lc', 'lc'], ['dl', 'dl'], ['ec', 'ec'],
];
const RE_NORMA_NUM = new RegExp(
  String.raw`\b(lei complementar|lei comp\.|decreto-lei|decreto lei|emenda constitucional|decreto|lei|lc|dl|ec)(\s+estadual|\s+federal)?\s*(?:n(?:º|°|o|\.)?\.?\s*|numero\s+)?` + NUM +
  String.raw`(?:\s*\/\s*(\d{4}|\d{2})(?!\d)|,?\s+de\s+\d{1,2}(?:º|o)?\s+de\s+[a-z]+\s+de\s+(\d{4}))?`, 'g');
const nomesCodigos = CODIGOS.flatMap((c) => c.nomes.map((n) => ({ n, c }))).sort((a, b) => b.n.length - a.n.length);
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const RE_NORMA_APELIDO = new RegExp(String.raw`(?<![a-z0-9])(` + nomesCodigos.map((x) => escRe(x.n)).join('|') + String.raw`)(?![a-z0-9/])`, 'g');
const RE_PROPRIA = /\b(dest[ae]|nest[ae]|dess[ae]|mesm[ao])\s+(lei|codigo|consolidacao|decreto|constituicao|resolucao|portaria|instrucao|diploma|estatuto)\b/g;

interface RefAchada { ini: number; fim: number; ref: RefNorma | null; porNumero: boolean }

function acharNormas(n: string): RefAchada[] {
  const out: RefAchada[] = [];
  for (const m of n.matchAll(RE_NORMA_NUM)) {
    const tipoTxt = m[1];
    let tipo = TIPOS_POR_NUMERO.find(([t]) => t === tipoTxt)?.[1] || 'lei';
    if (tipo === 'dl_ou_decreto') tipo = 'decreto';
    const ref: RefNorma = { tipo, numero: m[3].replace(/\./g, ''), ano: anoCompleto(m[4] || m[5] || null) };
    if (m[2]?.includes('estadual')) ref.uf = 'ES';
    out.push({ ini: m.index!, fim: m.index! + m[0].length, ref, porNumero: true });
  }
  for (const m of n.matchAll(RE_NORMA_APELIDO)) {
    const ini = m.index!, fim = ini + m[0].length;
    if (out.some((o) => ini < o.fim && fim > o.ini)) continue;
    const c = nomesCodigos.find((x) => x.n === m[1])!.c;
    out.push({ ini, fim, ref: { ...c.ref, apelido: c.apelido }, porNumero: false });
  }
  for (const m of n.matchAll(RE_PROPRIA)) out.push({ ini: m.index!, fim: m.index! + m[0].length, ref: null, porNumero: false });
  return out.sort((a, b) => a.ini - b.ini);
}

function listaDeArtigos(lista: string): string[] {
  const partes = lista.split(/\s*(,|\be\b|\bate\b|\ba\b)\s*/).filter((x) => x !== undefined);
  const out: string[] = [];
  let faixa = false;
  for (const p of partes) {
    if (p === ',' || p === 'e') { faixa = false; continue; }
    if (p === 'a' || p === 'ate') { faixa = true; continue; }
    if (!p.trim()) continue;
    const art = normalizarArtigo(p);
    if (faixa && out.length) {
      const de = parseInt(out[out.length - 1], 10), ate = parseInt(art, 10);
      if (ate > de && ate - de <= 10 && !art.includes('-')) for (let i = de + 1; i < ate; i++) out.push(String(i));
    }
    out.push(art);
    faixa = false;
  }
  return [...new Set(out)];
}

const TRIBUNAIS: [RegExp, string][] = [
  [/^(tst|tribunal superior do trabalho)/, 'TST'], [/^(stj|superior tribunal de justica)/, 'STJ'],
  [/^(stf|supremo tribunal federal|supremo)/, 'STF'], [/^(tnu|turma nacional de uniformizacao)/, 'TNU'],
];
const tribunalDe = (t: string) => TRIBUNAIS.find(([re]) => re.test(t))?.[1];
const TRIB = String.raw`(tst|stj|stf|tnu|tribunal superior do trabalho|superior tribunal de justica|supremo tribunal federal|turma nacional de uniformizacao)\b`;
const PREP_TRIB = String.raw`\s*,?\s*d[oa]\s+(?:(?:c\.|e\.|colendo|egregio|excelso)\s+)?`;
const RE_SUMULA_VINC = /\bsumula\s+vinculante\s*(?:n(?:º|°|o|\.)?\.?\s*)?(\d+)/g;
const RE_SUMULA = new RegExp(String.raw`\bsumula\s*(?:n(?:º|°|o|\.)?\.?\s*)?(\d+)((?:\s*,\s*(?:item\s+)?[ivxlcdm]+\b)*)` + PREP_TRIB + TRIB, 'g');
const RE_OJ_ORGAO_ANTES = /\b(?:oj|orientacao jurisprudencial)[\s-]*(?:n(?:º|°|o|\.)?\.?\s*)?(s?b?di-?\s*[12]|sdc)[\s-]*(?:n(?:º|°|o|\.)?\.?\s*)?(\d+)/g;
const RE_OJ = /\b(?:oj|orientacao jurisprudencial)\s*(?:n(?:º|°|o|\.)?\.?\s*)?(\d+)(?:\s*,?\s*d[ao]\s+(?:c\.\s*)?(s?b?di-?\s*[12]|sdc))?/g;
const RE_TEMA = new RegExp(String.raw`\btema\s+(de\s+repercussao\s+geral\s+|repetitivo\s+|rg\s+)?(?:n(?:º|°|o|\.)?\.?\s*)?` + NUM + String.raw`(?:\s*(?:\/|,?\s*d[oa])\s*(?:c\.\s*)?(stf|stj)\b)?`, 'g');
const orgaoOj = (o?: string) => (!o ? 'SDI1' : o.includes('sdc') ? 'SDC' : o.includes('2') ? 'SDI2' : 'SDI1');

/** Acha as citações de lei, súmula, OJ e tema num texto, na ordem em que aparecem. */
export function extrairCitacoes(texto: string): Citacao[] {
  const original = String(texto || '');
  const n = norm(original);
  const out: Citacao[] = [];
  const refs = acharNormas(n);
  const usadas = new Set<RefAchada>();
  const trecho = (ini: number, fim: number) => original.slice(ini, fim).replace(/\s+/g, ' ').trim();

  for (const m of n.matchAll(RE_ARTIGOS)) {
    const ini = m.index!, fim = ini + m[0].length;
    const artigos = listaDeArtigos(m[1]);
    // 1) "art. X [, inciso, §...] da/do NORMA"
    const depois = refs.find((r) => r.ini >= fim && r.ini - fim <= 90);
    let alvo: RefAchada | null = null, detalhe = '';
    if (depois) {
      const gap = n.slice(fim, depois.ini);
      const gapOriginal = original.slice(fim, depois.ini);
      const quebra = /;|\bart(?:igo)?s?\.?\s*\d/.test(gap) || /\.\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(gapOriginal);
      if (!quebra && /(?:^|\s)(d[oa]s?|n[oa]s?|em)\s*$/.test(gap)) {
        alvo = depois;
        detalhe = gapOriginal.replace(/(?:^|\s)(d[oa]s?|n[oa]s?|em)\s*$/i, '').replace(/^[\s,]+|[\s,]+$/g, '');
      }
    }
    // 2) "NORMA, art. X"
    if (!alvo) {
      const antes = [...refs].reverse().find((r) => r.fim <= ini && ini - r.fim <= 14);
      if (antes && /^[\s,]*(?:(?:em seu|no|em)\s+)?$/.test(n.slice(antes.fim, ini))) alvo = antes;
    }
    if (!alvo) continue;
    usadas.add(alvo);
    if (!alvo.ref) continue; // "desta Lei": não dá para conferir fora do contexto
    out.push({ tipo: 'artigo', trecho: trecho(Math.min(ini, alvo.ini), Math.max(fim, alvo.fim)), posicao: Math.min(ini, alvo.ini), norma: alvo.ref, artigos, detalhe });
  }

  for (const r of refs) {
    if (usadas.has(r) || !r.ref || !r.porNumero) continue;
    out.push({ tipo: 'norma', trecho: trecho(r.ini, r.fim), posicao: r.ini, norma: r.ref, artigos: [], detalhe: '' });
  }

  const ocupado: [number, number][] = [];
  const juris = (tipo: TipoCitacao, ini: number, fim: number, tribunal: string, numero: string, detalhe = '') => {
    if (ocupado.some(([a, b]) => ini < b && fim > a)) return;
    ocupado.push([ini, fim]);
    out.push({ tipo, trecho: trecho(ini, fim), posicao: ini, artigos: [], detalhe, tribunal, numero });
  };
  for (const m of n.matchAll(RE_SUMULA_VINC)) juris('sumula_vinculante', m.index!, m.index! + m[0].length, 'STF', m[1]);
  for (const m of n.matchAll(RE_SUMULA)) {
    const t = tribunalDe(m[3]);
    if (t) juris('sumula', m.index!, m.index! + m[0].length, t, m[1], (m[2] || '').replace(/^[\s,]+/, '').toUpperCase());
  }
  for (const m of n.matchAll(RE_OJ_ORGAO_ANTES)) juris('oj', m.index!, m.index! + m[0].length, 'TST', `${orgaoOj(m[1])}-${m[2]}`);
  for (const m of n.matchAll(RE_OJ)) juris('oj', m.index!, m.index! + m[0].length, 'TST', `${orgaoOj(m[2])}-${m[1]}`);
  for (const m of n.matchAll(RE_TEMA)) {
    const qual = m[1] || '';
    const t = /repetitivo/.test(qual) ? 'STJ' : /repercussao|rg/.test(qual) ? 'STF' : (m[3] || '').toUpperCase();
    if (t === 'STF' || t === 'STJ') juris(t === 'STF' ? 'tema_rg' : 'tema_rep', m.index!, m.index! + m[0].length, t, m[2].replace(/\./g, ''));
  }

  return out.sort((a, b) => a.posicao - b.posicao);
}

/**
 * O que se digita na caixa de busca, sem a gramática de petição:
 * "art 482 clt", "clt 477", "lei 8213/91 art 42", "sumula 331 tst", "tema 1046 stf".
 */
export function interpretarPergunta(q: string): Citacao[] {
  const t = String(q || '').trim();
  if (!t) return [];
  const direto = extrairCitacoes(t).filter((c) => c.tipo !== 'norma');
  if (direto.length) return direto;
  const n = norm(t).replace(/\s+/g, ' ');
  const tentativas: string[] = [];
  let m = n.match(/^art(?:igo)?s?\.?\s*(\S+(?:\s*(?:,|e|a)\s*\d\S*)*)\s+(?:d[ao]s?\s+)?(.+)$/);
  if (m) tentativas.push(`art. ${m[1]} da ${m[2]}`);
  m = n.match(/^(.+?)\s*,?\s+art(?:igo)?s?\.?\s*(\d\S*)$/);
  if (m) tentativas.push(`art. ${m[2]} da ${m[1]}`);
  m = n.match(/^(.+?)\s+(\d[\d.]*(?:º|o)?(?:-[a-z])?)$/);
  if (m) tentativas.push(`art. ${m[2]} da ${m[1]}`);
  m = n.match(/^(sumula vinculante|sumula|oj|orientacao jurisprudencial|tema repetitivo|tema)\s*(?:n\S*\s*)?(\d[\d.]*)\s+(?:d[ao]\s+)?(tst|stj|stf|tnu)$/);
  if (m) tentativas.push(`${m[1]} ${m[2]} do ${m[3]}`);
  for (const x of tentativas) {
    const c = extrairCitacoes(x).filter((y) => y.tipo !== 'norma');
    if (c.length) return c;
  }
  return [];
}

// ── Busca por palavras ─────────────────────────────────────────────────────
const VAZIAS = new Set(('a o e de da do das dos em no na nos nas por para pra com sem um uma uns umas ao aos as os que se ou '
  + 'sua seu suas seus pelo pela pelos pelas ser como mais qual quais quando onde sobre entre art arts artigo lei').split(' '));

/** Texto digitado → expressão do FTS5 (cada palavra entre aspas: nada do usuário vira operador). */
export function montarConsulta(q: string, opts: { ou?: boolean } = {}): string {
  const termos: string[] = [];
  const re = /"([^"]+)"|([^\s"]+)/g;
  for (const m of String(q || '').matchAll(re)) {
    if (m[1] !== undefined) {
      const frase = norm(m[1]).replace(/[^a-z0-9]+/g, ' ').trim();
      if (frase) termos.push(`"${frase}"`);
      continue;
    }
    for (const p of norm(m[2]).split(/[^a-z0-9]+/)) {
      if (p.length < 2 || VAZIAS.has(p)) continue;
      termos.push(/^\d+$/.test(p) || p.length < 4 ? `"${p}"` : `"${p}"*`);
    }
  }
  return termos.join(opts.ou ? ' OR ' : ' ');
}

export interface ResultadoBusca {
  dispositivoId: number;
  normaId: number;
  titulo: string;
  rotulo: string;
  trecho: string;
  esfera: Esfera;
  tipoChave: string;
  apelido: string | null;
  uf: string | null;
  tribunal: string | null;
  fonte: string;
  revogado: boolean;
  normaRevogada: boolean;
  relevancia: number;
}

const PESO_ESFERA: Record<string, number> = { constituicao: 1.5, federal: 1.25, jurisprudencia: 1.2, regulador: 1, estadual: 0.9 };

/**
 * Reordena o que o FTS achou: Constituição, códigos e jurisprudência sobem;
 * revogado desce; e o artigo que só apareceu pela ementa da lei (o trecho não
 * tem nenhuma palavra marcada) fica atrás de quem trata do assunto no texto.
 */
export function ordenarResultados<T extends Pick<ResultadoBusca, 'esfera' | 'apelido' | 'revogado' | 'normaRevogada' | 'relevancia'> & { trecho?: string }>(itens: T[]): T[] {
  const soCabecalho = (r: T) => !!r.trecho && !r.trecho.includes('[[');
  const nota = (r: T) => r.relevancia * (PESO_ESFERA[r.esfera] || 1) * (r.apelido ? 1.3 : 1) * (r.revogado || r.normaRevogada ? 0.25 : 1) * (soCabecalho(r) ? 0.3 : 1);
  return itens.map((r, i) => ({ r, i, s: nota(r) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.r);
}

// ── Citação formatada ──────────────────────────────────────────────────────
const NOME_TIPO: Record<string, [string, boolean]> = {
  lei: ['Lei', true], lc: ['Lei Complementar', true], dl: ['Decreto-Lei', false], decreto: ['Decreto', false],
  ec: ['Emenda Constitucional', true], ldel: ['Lei Delegada', true],
};
const milhar = (n: string) => (/^\d+$/.test(n) ? Number(n).toLocaleString('pt-BR') : n);

export interface NormaParaCitar { titulo: string; apelido?: string | null; tipoChave: string; numero: string; ano: number | null; uf?: string | null; esfera?: string }

function nomeDaNorma(n: NormaParaCitar): { nome: string; feminino: boolean } {
  const cod = n.apelido ? CODIGOS.find((c) => c.apelido === n.apelido) : null;
  const porNumero = NOME_TIPO[n.tipoChave];
  const numerada = porNumero ? `${porNumero[0]}${n.uf ? ' Estadual' : ''} nº ${milhar(n.numero)}${n.ano ? '/' + n.ano : ''}${n.uf ? ` (${n.uf})` : ''}` : n.titulo;
  if (cod?.exibir) {
    if (cod.nomeLongo) return { nome: cod.nomeLongo, feminino: cod.feminino };
    return { nome: `${cod.apelido} (${numerada})`, feminino: cod.feminino };
  }
  if (n.tipoChave === 'ce') return { nome: 'Constituição do Estado do Espírito Santo', feminino: true };
  return { nome: numerada, feminino: porNumero ? porNumero[1] : !/^(decreto|ato|regulamento|tema|puil)/i.test(n.titulo) };
}

/** Forma de petição: "art. 482 da CLT (Decreto-Lei nº 5.452/1943)", "Súmula nº 331 do TST". */
export function formatarCitacao(n: NormaParaCitar, d: { rotulo: string } | null): string {
  const { nome, feminino } = nomeDaNorma(n);
  if (!d || !/^Art\./.test(d.rotulo)) return nome;
  return `${d.rotulo.replace(/^Art\./, 'art.')} ${feminino ? 'da' : 'do'} ${nome}`;
}

// ── Conferência (Dra. Vera) ────────────────────────────────────────────────
export type Situacao = 'confere' | 'artigo_revogado' | 'norma_revogada' | 'artigo_inexistente' | 'fora_do_acervo';

export function avaliarCitacao(
  norma: { revogada: boolean } | null,
  encontrados: { numero: string; revogado: boolean }[],
  pedidos: string[],
): { situacao: Situacao; faltando: string[]; revogados: string[] } {
  if (!norma) return { situacao: 'fora_do_acervo', faltando: [], revogados: [] };
  const faltando = pedidos.filter((a) => !encontrados.some((e) => e.numero === a));
  const revogados = pedidos.filter((a) => encontrados.some((e) => e.numero === a && e.revogado));
  if (faltando.length) return { situacao: 'artigo_inexistente', faltando, revogados };
  if (norma.revogada) return { situacao: 'norma_revogada', faltando, revogados };
  if (revogados.length) return { situacao: 'artigo_revogado', faltando, revogados };
  return { situacao: 'confere', faltando, revogados };
}

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  confere: 'confere com o texto oficial',
  artigo_revogado: 'artigo revogado: não citar como vigente',
  norma_revogada: 'norma revogada ou cancelada: conferir o que a substituiu',
  artigo_inexistente: 'artigo não existe nessa norma: conferir o número',
  fora_do_acervo: 'fora do acervo: conferir manualmente na fonte oficial',
};

export interface ResultadoConferencia {
  trecho: string;
  /** o que vem junto do número na peça: "§ 6º", "IV", "alínea b". */
  detalhe?: string;
  situacao: Situacao;
  citacao?: string;
  fonte?: string;
  texto?: string;
  sustenta?: 'sim' | 'parcial' | 'nao' | null;
  observacao?: string;
}

const SIMBOLO: Record<Situacao, string> = { confere: '✓', artigo_revogado: '✗', norma_revogada: '✗', artigo_inexistente: '✗', fora_do_acervo: '?' };

export function relatorioConferencia(rs: ResultadoConferencia[]): string {
  if (!rs.length) return 'CONFERÊNCIA DAS CITAÇÕES (Dra. Vera): nenhuma citação de lei ou súmula encontrada na peça.';
  const confere = rs.filter((r) => r.situacao === 'confere').length;
  const naoSustenta = rs.filter((r) => r.sustenta === 'nao' || r.sustenta === 'parcial').length;
  const linhas = [
    `CONFERÊNCIA DAS CITAÇÕES (Dra. Vera): ${rs.length} citação(ões) · ${confere} confere · ${rs.length - confere} com problema${naoSustenta ? ` · ${naoSustenta} a rever o sentido` : ''}`,
    '─'.repeat(50),
  ];
  for (const r of rs) {
    const simbolo = r.situacao === 'confere' && (r.sustenta === 'nao' || r.sustenta === 'parcial') ? '⚠' : SIMBOLO[r.situacao];
    linhas.push(`${simbolo} ${r.trecho}${r.citacao && r.citacao !== r.trecho ? ` [${r.citacao}]` : ''} — ${ROTULO_SITUACAO[r.situacao]}`);
    if (r.sustenta === 'nao') linhas.push(`   → o texto oficial NÃO sustenta o que a peça afirma${r.observacao ? ': ' + r.observacao : ''}`);
    else if (r.sustenta === 'parcial') linhas.push(`   → o texto oficial sustenta só em parte${r.observacao ? ': ' + r.observacao : ''}`);
    if (r.fonte && r.situacao !== 'fora_do_acervo') linhas.push(`   fonte: ${r.fonte}`);
  }
  linhas.push('─'.repeat(50));
  linhas.push('Textos do acervo público ctresb/leis (conversão automática das fontes oficiais). Antes de protocolar, confira na fonte indicada.');
  return linhas.join('\n');
}

/**
 * O pedaço do texto oficial que interessa à citação: com "§ 6º", "IV" ou
 * "alínea b", leva o começo do dispositivo e a parte citada (que num artigo
 * longo fica bem depois do caput); sem achar, o começo.
 */
export function trechoRelevante(texto: string, detalhe: string | undefined, tam = 1500): string {
  const t = String(texto || '');
  if (t.length <= tam) return t;
  const d = String(detalhe || '');
  const marcas: RegExp[] = [];
  const par = d.match(/§\s*(\d+)/);
  if (par) marcas.push(new RegExp(String.raw`§\s*${par[1]}\s*(?:º|°|o)?(?!\d)`));
  if (/par[aá]grafo\s+[uú]nico/i.test(d)) marcas.push(/par[aá]grafo\s+[uú]nico/i);
  const romano = d.match(/\b([IVXLC]+)\b/);
  if (romano) marcas.push(new RegExp(String.raw`(?:^|\n)\s*${romano[1]}\s*[-–—]`));
  const alinea = d.match(/al[ií]nea\s*["“']?([a-z])\b|["“']([a-z])["”']/i);
  if (alinea) marcas.push(new RegExp(String.raw`(?:^|\n)\s*${(alinea[1] || alinea[2]).toLowerCase()}\)`));
  for (const re of marcas) {
    const m = re.exec(t);
    if (!m || m.index < tam / 2) continue;
    const ini = m.index + (m[0].startsWith('\n') ? 1 : 0);
    const cab = t.slice(0, Math.floor(tam / 3)).trim();
    return `${cab} […] ${t.slice(ini, ini + tam - cab.length - 7).trim()}`;
  }
  return t.slice(0, tam);
}

// ── Pesquisa para a peça (Dra. Júlia) ──────────────────────────────────────
export interface Fundamento { citacao: string; texto: string; fonte: string }

/** Bloco que vai no prompt de quem redige: só dispositivos que existem, com o texto oficial. */
export function blocoFundamentos(itens: Fundamento[], limite = 7000): string {
  if (!itens.length) return '';
  const linhas = ['\nFUNDAMENTOS LEGAIS CONFERIDOS NO ACERVO (Dra. Júlia — texto oficial, fonte pública):'];
  let total = 0;
  for (const f of itens) {
    const t = f.texto.replace(/\s+/g, ' ').trim();
    const linha = `• ${f.citacao}: "${t.length > 600 ? t.slice(0, 600) + '…' : t}"${f.fonte ? ` [fonte: ${f.fonte}]` : ''}`;
    if (total + linha.length > limite) break;
    linhas.push(linha);
    total += linha.length;
  }
  linhas.push('REGRA: fundamente com estes dispositivos, citando-os pela forma indicada. Se precisar citar artigo, súmula, OJ ou tema que NÃO está nesta lista, escreva [conferir] logo depois da citação. Nunca invente número de artigo, súmula ou julgado.\n');
  return linhas.join('\n');
}
