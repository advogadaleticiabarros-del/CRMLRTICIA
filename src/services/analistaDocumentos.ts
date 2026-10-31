/**
 * Dra. Helena, analista de documentos: lê cada documento recebido com olhar
 * crítico e cruza com a história contada pelo cliente, para que nada passe
 * (nome/CPF, empresa, datas, salário, carteira, FGTS, comprovante, gestação,
 * prescrição, documento ilegível, cortado ou com sinal de alteração).
 * A IA só LÊ o documento; as conferências são regras fixas daqui, e um
 * segundo olhar da IA entra marcado "conferir". Nunca acusa o cliente: o que
 * é grave vai à Dra.; ao cliente só sai o pedido neutro de reenvio.
 * Regras puras — tests/negociadorAnalista.test.mjs.
 */
import { cpfCnpjValido, normalizarDigitos } from '../utils/cpfCnpj';

export const TIPOS_DOCUMENTO = [
  'rg', 'cnh', 'cpf', 'ctps', 'contrato_trabalho', 'extrato_fgts', 'holerite', 'trct', 'comprovante_endereco', 'atestado', 'exame_gravidez',
  'ultrassom', 'laudo', 'cat', 'cartao_ponto', 'print_conversa', 'foto', 'outro',
] as const;
export type TipoDocumento = typeof TIPOS_DOCUMENTO[number];

const ROTULO_TIPO: Record<string, string> = {
  rg: 'RG', cnh: 'CNH', cpf: 'CPF', ctps: 'Carteira de Trabalho', contrato_trabalho: 'contrato de trabalho', extrato_fgts: 'extrato do FGTS',
  holerite: 'holerite', trct: 'termo de rescisão (TRCT)', comprovante_endereco: 'comprovante de endereço', atestado: 'atestado', exame_gravidez: 'exame de gravidez',
  ultrassom: 'ultrassom', laudo: 'laudo', cat: 'CAT', cartao_ponto: 'cartão de ponto', print_conversa: 'print de conversa', foto: 'foto', outro: 'documento',
};
const rotulo = (t: string) => ROTULO_TIPO[t] || 'documento';

/** Dia de hoje em Brasília, "aaaa-mm-dd" (às 22h de Brasília o UTC já está no dia seguinte). */
export const hojeBrasilia = (agora: Date = new Date()) => agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/** O pedido de leitura leva a data de hoje: sem ela, a IA usa a data do próprio treinamento
 *  e acusava "data futura" em documentos de 2025 e 2026 (31/10/2026). */
export const promptLeituraCritica = (agora: Date = new Date()) => `Você é analista de documentos de um escritório de advocacia e lê UM documento com olhar crítico.
HOJE É ${hojeBrasilia(agora).split('-').reverse().join('/')} (horário de Brasília). Só é data futura a que vem DEPOIS de hoje.
Responda SOMENTE com JSON, sem texto fora dele:
{"tipo":"${TIPOS_DOCUMENTO.join('|')}",
 "legivel":true|false, "completo":true|false,
 "titular":{"nome":"...","cpf":"...","nascimento":"dd/mm/aaaa"},
 "empregador":{"nome":"...","cnpj":"..."},
 "cargo":"...", "admissao":"dd/mm/aaaa", "demissao":"dd/mm/aaaa", "salario":"R$ ...",
 "data_emissao":"dd/mm/aaaa", "endereco":"...",
 "competencias_fgts":["mm/aaaa", ...],
 "data_exame":"dd/mm/aaaa", "semanas_gestacao":0,
 "indicios_alteracao":["..."], "observacoes":"..."}
Regras:
- Inclua SOMENTE o que está escrito no documento. NUNCA invente, complete ou deduza. Campo que não existe no documento: null.
- "legivel": false se estiver borrado, escuro, com reflexo ou com partes importantes impossíveis de ler.
- "completo": false se estiver cortado, faltar página, faltar frente ou verso, ou a CTPS não mostrar a página do contrato.
- "competencias_fgts": os meses que TÊM depósito no extrato (um item por mês).
- "salario": o salário contratual (CTPS) ou o salário base (holerite).
- "indicios_alteracao": sinais objetivos de montagem ou edição (fontes ou alinhamentos diferentes no mesmo campo, recortes, sobreposição, datas impossíveis ou posteriores a hoje, números rasurados). Lista vazia se não houver. Não especule.`;

export interface LeituraDoc {
  tipo: string; legivel: boolean; completo: boolean;
  titular: { nome: string | null; cpf: string | null; nascimento: string | null };
  empregador: { nome: string | null; cnpj: string | null };
  cargo: string | null; admissao: string | null; demissao: string | null; salario: number | null;
  data_emissao: string | null; endereco: string | null; competencias_fgts: string[];
  data_exame: string | null; semanas_gestacao: number | null; indicios_alteracao: string[]; observacoes: string | null;
}

/** Foto ou PDF: o que a leitura crítica sabe ler. */
export function lidoPelaAnalise(mime: string | null | undefined): boolean {
  const m = String(mime || '');
  return m.startsWith('image/') || m === 'application/pdf';
}

/**
 * De onde a Dra. Helena tira um documento do CRM: o arquivo guardado ou, quando o documento
 * veio da pasta do Google Drive só com o link, o arquivo baixado de lá (incidente de 30/10/2026:
 * os documentos do Valmirio eram todos links e a análise dizia que o cliente não mandou nada).
 * O tipo de um link nem sempre é conhecido; ele é conferido depois de baixar.
 */
export function comoLerDocumento(d: { mime?: string | null; tem_arquivo?: boolean | number | null; file_url?: string | null }): 'guardado' | 'drive' | null {
  const desconhecido = !d.mime || d.mime === 'application/octet-stream';
  if (Number(d.tem_arquivo)) return lidoPelaAnalise(d.mime) ? 'guardado' : null;
  if (/drive\.google\.com/.test(String(d.file_url || ''))) return lidoPelaAnalise(d.mime) || desconhecido ? 'drive' : null;
  return null;
}

const texto = (v: any) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.replace(/\s+/g, ' ').trim().slice(0, 255) : null);

/** "dd/mm/aaaa" ou "aaaa-mm-dd" → "aaaa-mm-dd". */
export function dataIso(v: any): string | null {
  const t = String(v ?? '').trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** "01/2024", "2024-01" ou "2024-01-15" → "2024-01". */
function competencia(v: any): string | null {
  const t = String(v ?? '').trim();
  let m = t.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = t.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** "R$ 1.850,50" → 1850.5; "2.500" → 2500; 2500 → 2500. */
export function numero(v: any): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let t = String(v ?? '').replace(/[^\d,.]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const jsonDe = (s: string): any => {
  const limpo = String(s || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!limpo.startsWith('{')) return null;
  try { return JSON.parse(limpo); } catch { return null; }
};

export function parseLeituraCritica(s: string): LeituraDoc | null {
  const o = jsonDe(s);
  if (!o || typeof o !== 'object') return null;
  const tit = o.titular || {}, emp = o.empregador || {};
  const tipo = (TIPOS_DOCUMENTO as readonly string[]).includes(o.tipo) ? o.tipo : 'outro';
  const sem = Number(o.semanas_gestacao);
  return {
    tipo, legivel: o.legivel !== false, completo: o.completo !== false,
    titular: { nome: texto(tit.nome), cpf: texto(tit.cpf), nascimento: dataIso(tit.nascimento) },
    empregador: { nome: texto(emp.nome), cnpj: texto(emp.cnpj) },
    cargo: texto(o.cargo), admissao: dataIso(o.admissao), demissao: dataIso(o.demissao), salario: numero(o.salario),
    data_emissao: dataIso(o.data_emissao), endereco: texto(o.endereco),
    competencias_fgts: [...new Set((Array.isArray(o.competencias_fgts) ? o.competencias_fgts : []).map(competencia).filter(Boolean) as string[])].sort(),
    data_exame: dataIso(o.data_exame), semanas_gestacao: Number.isFinite(sem) && sem > 0 && sem < 45 ? sem : null,
    indicios_alteracao: (Array.isArray(o.indicios_alteracao) ? o.indicios_alteracao : []).map(texto).filter(Boolean) as string[],
    observacoes: texto(o.observacoes),
  };
}

// ── História contada ────────────────────────────────────────────────────────

export interface FatosHistoria {
  empresa?: string | null; cnpj?: string | null; funcao?: string | null; admissao?: string | null; demissao?: string | null;
  salario?: number | null; carteira_assinada?: boolean | null; tipo_saida?: string | null; gestante?: boolean | null; semanas_na_dispensa?: number | null;
}

export function promptFatosDaHistoria(historia: string): string {
  return `Abaixo está a história que o cliente contou ao escritório (relato, conversas de WhatsApp, anotações).
Extraia SOMENTE o que ele afirmou. Não invente nem deduza; o que não foi dito fica null.
Responda SOMENTE com JSON:
{"empresa":"nome da empresa citada","cnpj":null,"funcao":"...","admissao":"dd/mm/aaaa","demissao":"dd/mm/aaaa","salario":"R$ ...",
 "carteira_assinada":true|false|null,"tipo_saida":"pediu demissão|dispensado|justa causa|rescisão indireta|ainda trabalha|null",
 "gestante":true|false|null,"semanas_na_dispensa":null}
Se o cliente só disse mês e ano, use o dia 01.

HISTÓRIA:
${String(historia || '').slice(0, 24000)}`;
}

export function parseFatos(s: string): FatosHistoria {
  const o = jsonDe(s) || {};
  const bool = (v: any) => (v === true || v === false ? v : null);
  const sem = Number(o.semanas_na_dispensa);
  return {
    empresa: texto(o.empresa), cnpj: texto(o.cnpj), funcao: texto(o.funcao), admissao: dataIso(o.admissao), demissao: dataIso(o.demissao),
    salario: numero(o.salario), carteira_assinada: bool(o.carteira_assinada), tipo_saida: texto(o.tipo_saida), gestante: bool(o.gestante),
    semanas_na_dispensa: Number.isFinite(sem) && sem > 0 ? sem : null,
  };
}

// ── Cruzamento ──────────────────────────────────────────────────────────────

export type NivelAchado = 'grave' | 'atencao' | 'favoravel' | 'info';
export interface Achado { nivel: NivelAchado; tema: string; texto: string; fontes: string[]; reenvio?: string }

const semAcento = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const LIGACAO = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);
const tokensNome = (s: string) => semAcento(s).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w && !LIGACAO.has(w));

/** Mesmo nome, aceitando abreviação do meio ("Maria A. Teste") e sobrenome omitido no meio. */
export function nomesBatem(a: string, b: string): boolean {
  const x = tokensNome(a), y = tokensNome(b);
  if (!x.length || !y.length) return true;
  const [curto, longo] = x.length <= y.length ? [x, y] : [y, x];
  if (curto[0] !== longo[0] || curto[curto.length - 1] !== longo[longo.length - 1]) return false;
  return curto.slice(1, -1).every((w) => (w.length === 1 ? longo.some((l) => l[0] === w) : longo.includes(w)));
}

const SUFIXOS_EMPRESA = new Set(['ltda', 'me', 'epp', 'eireli', 'sa', 's', 'a', 'cia', 'comercio', 'comercial', 'servicos', 'industria', 'de', 'da', 'do', 'dos', 'das', 'e', 'mei']);
const tokensEmpresa = (s: string) => semAcento(s).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !SUFIXOS_EMPRESA.has(w));

export function empresasBatem(a: string, b: string): boolean {
  const x = tokensEmpresa(a), y = tokensEmpresa(b);
  if (!x.length || !y.length) return true;
  const [curto, longo] = x.length <= y.length ? [x, y] : [y, x];
  if (curto.every((w) => longo.includes(w))) return true;
  return curto.filter((w) => longo.includes(w)).length >= 2;
}

const DIA = 86400000;
const ms = (iso: string) => new Date(`${iso}T12:00:00Z`).getTime();
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const br = (d: string) => d.split('-').reverse().join('/');
const dias = (de: string, ate: string) => Math.round((ms(ate) - ms(de)) / DIA);
const maisAnos = (d: string, n: number) => `${Number(d.slice(0, 4)) + n}${d.slice(4)}`;
const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Meses de "aaaa-mm" a "aaaa-mm", inclusive. */
function mesesEntre(de: string, ate: string): string[] {
  const out: string[] = [];
  let [a, m] = de.split('-').map(Number);
  const [fa, fm] = ate.split('-').map(Number);
  while ((a < fa || (a === fa && m <= fm)) && out.length < 600) {
    out.push(`${a}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; a++; }
  }
  return out;
}

const DOCS_CONTRATO = ['ctps', 'contrato_trabalho', 'trct', 'extrato_fgts', 'holerite'];

export interface EntradaCruzamento {
  cadastro: { nome: string | null; cpf: string | null };
  fatos: FatosHistoria;
  docs: Array<{ fonte: string; l: LeituraDoc }>;
  hoje: Date;
}

/** Tira o indício de "data futura" quando a data já passou (leituras antigas foram feitas sem a data de hoje). */
function indiciosValidos(l: LeituraDoc, hoje: string): string[] {
  return l.indicios_alteracao.filter((t) => {
    if (!/futur/i.test(t)) return true;
    const datas = [...t.matchAll(/(?<!\d)\d{1,2}\/\d{1,2}\/\d{4}(?!\d)/g)].map((m) => dataIso(m[0])).filter(Boolean) as string[];
    if (!datas.length && l.data_emissao) datas.push(l.data_emissao);
    return !datas.length || datas.some((d) => d > hoje);
  });
}

export function cruzar(e: EntradaCruzamento): Achado[] {
  const out: Achado[] = [];
  const hoje = hojeBrasilia(e.hoje);
  const f = e.fatos || {};
  const add = (a: Achado) => out.push(a);

  // 1) Qualidade de cada documento.
  for (const { fonte, l } of e.docs) {
    if (!l.legivel) add({ nivel: 'atencao', tema: 'legibilidade', texto: `${fonte} (${rotulo(l.tipo)}) está ilegível ou borrado.`, fontes: [fonte], reenvio: `${rotulo(l.tipo)} de novo, com foto nítida (sem reflexo e sem cortar as bordas)` });
    if (!l.completo) add({ nivel: 'atencao', tema: 'documento incompleto', texto: `${fonte} (${rotulo(l.tipo)}) está cortado ou faltando página/frente e verso.`, fontes: [fonte], reenvio: `${rotulo(l.tipo)} completo (todas as páginas, frente e verso)` });
    const indicios = indiciosValidos(l, hoje);
    if (indicios.length) add({ nivel: 'grave', tema: 'possível alteração', texto: `${fonte}: ${indicios.join('; ')}. Conferir o original antes de usar; não comentar com o cliente sem a Dra.`, fontes: [fonte] });
  }

  // 2) Identidade: nome, CPF e nascimento.
  for (const { fonte, l } of e.docs) {
    const nome = l.titular.nome;
    if (!nome || !e.cadastro.nome) continue;
    if (l.tipo === 'comprovante_endereco') {
      if (!nomesBatem(nome, e.cadastro.nome)) add({ nivel: 'atencao', tema: 'comprovante de endereço', texto: `${fonte} está em nome de outra pessoa (${nome}). Pedir declaração de residência ou comprovante do vínculo com o titular (ex.: certidão de casamento).`, fontes: [fonte], reenvio: 'declaração de residência assinada (o comprovante está em nome de outra pessoa)' });
      continue;
    }
    if (['print_conversa', 'foto', 'outro', 'cat', 'laudo', 'atestado', 'cartao_ponto'].includes(l.tipo)) continue;
    if (!nomesBatem(nome, e.cadastro.nome)) add({ nivel: 'grave', tema: 'nome', texto: `${fonte} (${rotulo(l.tipo)}) está em nome de "${nome}", diferente do cadastro ("${e.cadastro.nome}").`, fontes: [fonte] });
  }
  const cpfCad = normalizarDigitos(e.cadastro.cpf || '');
  for (const { fonte, l } of e.docs) {
    const d = normalizarDigitos(l.titular.cpf || '');
    if (d.length !== 11 || l.tipo === 'comprovante_endereco') continue;
    if (!cpfCnpjValido(d)) add({ nivel: 'atencao', tema: 'CPF', texto: `O CPF lido em ${fonte} não passa no dígito verificador (leitura errada ou documento com problema).`, fontes: [fonte] });
    else if (cpfCad.length === 11 && d !== cpfCad) add({ nivel: 'grave', tema: 'CPF', texto: `${fonte} traz um CPF diferente do cadastro.`, fontes: [fonte] });
  }
  const nascs = new Map<string, string[]>();
  for (const { fonte, l } of e.docs) if (l.titular.nascimento) nascs.set(l.titular.nascimento, [...(nascs.get(l.titular.nascimento) || []), fonte]);
  if (nascs.size > 1) add({ nivel: 'atencao', tema: 'nascimento', texto: `Datas de nascimento diferentes: ${[...nascs].map(([d, fs]) => `${br(d)} (${fs.join(', ')})`).join('; ')}.`, fontes: [...nascs.values()].flat() });

  // 3) Empresa.
  const contratos = e.docs.filter((d) => DOCS_CONTRATO.includes(d.l.tipo));
  const empregadores = contratos.filter((d) => d.l.empregador.nome);
  if (f.empresa && empregadores.length && !empregadores.some((d) => empresasBatem(f.empresa!, d.l.empregador.nome!))) {
    add({ nivel: 'grave', tema: 'empresa', texto: `O cliente falou da empresa "${f.empresa}", mas os documentos mostram ${[...new Set(empregadores.map((d) => `"${d.l.empregador.nome}"`))].join(', ')}. Pode ser nome fantasia: confirmar o CNPJ antes da petição.`, fontes: empregadores.map((d) => d.fonte) });
  }
  const cnpjs = new Map<string, string[]>();
  for (const d of contratos) { const c = normalizarDigitos(d.l.empregador.cnpj || ''); if (c.length === 14) cnpjs.set(c, [...(cnpjs.get(c) || []), d.fonte]); }
  if (cnpjs.size > 1) add({ nivel: 'atencao', tema: 'empresa', texto: `CNPJs diferentes entre os documentos (${[...cnpjs.values()].map((fs) => fs.join(', ')).join(' x ')}). Pode ser filial ou grupo econômico: confirmar quem é a reclamada.`, fontes: [...cnpjs.values()].flat() });

  // 4) Datas do contrato.
  const prioridade = ['ctps', 'contrato_trabalho', 'trct', 'extrato_fgts', 'holerite'];
  const primeiro = (campo: 'admissao' | 'demissao' | 'salario') => {
    const ord = campo === 'salario' ? ['holerite', 'ctps', 'contrato_trabalho', 'trct'] : prioridade;
    for (const t of ord) { const d = contratos.find((x) => x.l.tipo === t && x.l[campo] != null); if (d) return { fonte: d.fonte, v: d.l[campo] as any }; }
    return null;
  };
  for (const { fonte, l } of contratos) {
    if (l.admissao && l.demissao && l.demissao < l.admissao) add({ nivel: 'grave', tema: 'datas', texto: `${fonte}: a saída (${br(l.demissao)}) é anterior à entrada (${br(l.admissao)}). Erro de leitura ou de registro: conferir.`, fontes: [fonte] });
  }
  const ad = primeiro('admissao');
  if (f.admissao && ad) {
    const dif = dias(f.admissao, ad.v);
    if (dif > 30) add({ nivel: 'atencao', tema: 'admissão', texto: `O cliente contou que começou em ${br(f.admissao)}, mas o registro é de ${br(ad.v)} (${dif} dias depois): pode haver período sem carteira (pedido de reconhecimento do período sem registro). Confirmar com o cliente e pedir provas do início.`, fontes: [ad.fonte] });
    else if (dif < -30) add({ nivel: 'atencao', tema: 'admissão', texto: `O registro (${br(ad.v)}) é anterior à data que o cliente contou (${br(f.admissao)}). Confirmar a data certa.`, fontes: [ad.fonte] });
  }
  const dm = primeiro('demissao');
  if (f.demissao && dm && Math.abs(dias(f.demissao, dm.v)) > 30) {
    add({ nivel: 'atencao', tema: 'demissão', texto: `O cliente contou que saiu em ${br(f.demissao)}, mas o documento mostra ${br(dm.v)}. Confirmar (a data muda a prescrição e as verbas).`, fontes: [dm.fonte] });
  }

  // 5) Prescrição bienal (conta da saída; a projeção do aviso prévio pode ampliar).
  const saida = f.demissao || dm?.v || null;
  if (saida && saida <= hoje) {
    const limite = maisAnos(saida, 2);
    const faltam = dias(hoje, limite);
    if (faltam < 0) add({ nivel: 'grave', tema: 'prescrição', texto: `Saída em ${br(saida)}: já passou de 2 anos (prescrição bienal, art. 7º, XXIX, da Constituição e art. 11 da CLT). Confirmar a data real de saída e a projeção do aviso prévio antes de qualquer coisa.`, fontes: dm ? [dm.fonte] : ['história contada'] });
    else if (faltam <= 90) add({ nivel: 'grave', tema: 'prescrição', texto: `Saída em ${br(saida)}: faltam ${faltam} dias para completar 2 anos (prescrição bienal). A ação precisa entrar antes de ${br(limite)}.`, fontes: dm ? [dm.fonte] : ['história contada'] });
  }

  // 6) Salário contado x documento.
  const sal = primeiro('salario');
  if (f.salario && sal && sal.v > 0 && Math.abs(f.salario - sal.v) / sal.v > 0.15) {
    add(f.salario > sal.v
      ? { nivel: 'atencao', tema: 'salário', texto: `O cliente contou salário de ${brl(f.salario)}, mas o documento mostra ${brl(sal.v)}: pode ser pagamento "por fora" (pedido de integração ao salário). Confirmar e pedir provas (extratos, Pix, recibos).`, fontes: [sal.fonte] }
      : { nivel: 'atencao', tema: 'salário', texto: `O documento mostra salário (${brl(sal.v)}) maior do que o contado (${brl(f.salario)}). Confirmar com o cliente.`, fontes: [sal.fonte] });
  }

  // 7) "Sem carteira" x CTPS com contrato.
  if (f.carteira_assinada === false) {
    const ctps = e.docs.find((d) => d.l.tipo === 'ctps' && d.l.empregador.nome && (!f.empresa || empresasBatem(f.empresa, d.l.empregador.nome)))
      || e.docs.find((d) => d.l.tipo === 'ctps' && d.l.empregador.nome);
    if (ctps) add({ nivel: 'grave', tema: 'carteira', texto: `O cliente disse que trabalhava sem carteira, mas a CTPS (${ctps.fonte}) mostra contrato com "${ctps.l.empregador.nome}"${ctps.l.admissao ? ` desde ${br(ctps.l.admissao)}` : ''}. Esclarecer antes da petição.`, fontes: [ctps.fonte] });
  }

  // 8) FGTS: meses sem depósito.
  for (const { fonte, l } of e.docs.filter((d) => d.l.tipo === 'extrato_fgts' && d.l.competencias_fgts.length)) {
    const ini = l.admissao || ad?.v;
    const mesAnterior = iso(ms(hoje.slice(0, 8) + '01') - DIA).slice(0, 7);
    const fimMes = (l.demissao || dm?.v || null)?.slice(0, 7) || mesAnterior;
    if (!ini) continue;
    const falta = mesesEntre(ini.slice(0, 7), fimMes).filter((m) => !l.competencias_fgts.includes(m));
    if (falta.length) {
      const lista = falta.slice(0, 24).map((m) => `${m.slice(5)}/${m.slice(0, 4)}`).join(', ') + (falta.length > 24 ? ` e mais ${falta.length - 24}` : '');
      add({ nivel: 'favoravel', tema: 'FGTS', texto: `Meses sem depósito de FGTS no extrato: ${lista} (pedido de recolhimento e multa). Conferir se o extrato está completo.`, fontes: [fonte] });
    }
  }

  // 9) Comprovante de endereço dos últimos 3 meses.
  for (const { fonte, l } of e.docs.filter((d) => d.l.tipo === 'comprovante_endereco' && d.l.data_emissao)) {
    const idade = dias(l.data_emissao!, hoje);
    if (idade > 90) add({ nivel: 'atencao', tema: 'comprovante de endereço', texto: `${fonte} é de ${br(l.data_emissao!)} (${idade} dias): precisa ser dos últimos 3 meses.`, fontes: [fonte], reenvio: 'comprovante de endereço dos últimos 3 meses (conta de luz, água, internet ou telefone)' });
  }

  // 10) Gestante: a gestação começou antes da saída (ou no aviso prévio)?
  if (saida && (f.gestante || e.docs.some((d) => ['ultrassom', 'exame_gravidez'].includes(d.l.tipo)))) {
    for (const { fonte, l } of e.docs.filter((d) => ['ultrassom', 'exame_gravidez'].includes(d.l.tipo) && d.l.data_exame && d.l.semanas_gestacao)) {
      const inicio = iso(ms(l.data_exame!) - l.semanas_gestacao! * 7 * DIA);
      const comAviso = iso(ms(saida) + 30 * DIA);
      if (inicio <= comAviso) add({ nivel: 'favoravel', tema: 'gestação', texto: `Pelo ${fonte} (${l.semanas_gestacao} semanas em ${br(l.data_exame!)}), a gestação começou por volta de ${br(inicio)}, antes da saída em ${br(saida)} ou dentro do aviso prévio: base para a estabilidade da gestante (art. 10, II, "b", do ADCT; art. 391-A da CLT).`, fontes: [fonte] });
      else add({ nivel: 'grave', tema: 'gestação', texto: `Pelo ${fonte} (${l.semanas_gestacao} semanas em ${br(l.data_exame!)}), a gestação começou por volta de ${br(inicio)}, DEPOIS da saída em ${br(saida)}, mesmo contando 30 dias de aviso prévio. A estabilidade fica em risco: a Dra. precisa ver.`, fontes: [fonte] });
      if (f.semanas_na_dispensa) {
        const calc = Math.round(dias(inicio, saida) / 7);
        if (Math.abs(calc - f.semanas_na_dispensa) > 3) add({ nivel: 'atencao', tema: 'gestação', texto: `A cliente contou ${f.semanas_na_dispensa} semanas na dispensa; pelo exame seriam cerca de ${calc}. Confirmar.`, fontes: [fonte] });
      }
    }
  }
  return out;
}

// ── Segundo olhar da IA ─────────────────────────────────────────────────────

export function promptCruzamentoLivre(historia: string, leituras: Array<{ fonte: string; l: LeituraDoc }>, jaApontado: Achado[]): string {
  return `Você é analista de documentos de um escritório de advocacia, muito criterioso(a). Compare a HISTÓRIA contada pelo cliente com os DOCUMENTOS lidos e aponte contradições, lacunas ou pontos que podem prejudicar o caso e que AINDA NÃO foram apontados.
Exemplos: função ou jornada diferentes, adicional que a história sugere e o holerite não tem, testemunha citada sem contato, prova prometida que não veio, valores que não fecham.
Seja objetivo(a). Não repita o que já foi apontado. Não invente: só o que dá para ver nos dados abaixo. Se não houver nada, lista vazia.
Responda SOMENTE com JSON: {"apontamentos":[{"texto":"...","fontes":["arquivo"]}]}

JÁ APONTADO:
${jaApontado.map((a) => `- ${a.tema}: ${a.texto}`).join('\n') || '- nada'}

DOCUMENTOS LIDOS:
${JSON.stringify(leituras.map((d) => ({ fonte: d.fonte, ...d.l }))).slice(0, 16000)}

HISTÓRIA:
${String(historia || '').slice(0, 12000)}`;
}

export function parseApontamentosIa(s: string): Achado[] {
  const o = jsonDe(s);
  const lista = Array.isArray(o?.apontamentos) ? o.apontamentos : [];
  return lista.map((a: any) => texto(typeof a === 'string' ? a : a?.texto)).filter(Boolean).slice(0, 8).map((t: string, i: number) => ({
    nivel: 'atencao' as const, tema: 'apontado pela IA', texto: `${t} (apontado pela IA: conferir)`,
    fontes: Array.isArray(lista[i]?.fontes) ? lista[i].fontes.map(String).slice(0, 5) : [],
  }));
}

// ── Saídas ──────────────────────────────────────────────────────────────────

const SECOES: Array<[NivelAchado, string]> = [['grave', '🔴 Graves'], ['atencao', '🟡 Atenção'], ['favoravel', '🟢 A favor do cliente'], ['info', 'ℹ️ Informações']];

export function relatorioAnalise(nome: string, achados: Achado[], docs: Array<{ fonte: string; tipo: string }>): string {
  const linhas = [
    `# Análise dos documentos — ${nome}`, '',
    '_Dra. Helena (analista de documentos). Leitura automática dos documentos cruzada com a história contada: confira no original antes de usar._', '',
    `## Documentos lidos (${docs.length})`, ...docs.map((d) => `- ${d.fonte} (${rotulo(d.tipo)})`), '',
  ];
  if (!achados.length) linhas.push('Nada de incoerente entre os documentos e a história contada.');
  for (const [nivel, titulo] of SECOES) {
    const xs = achados.filter((a) => a.nivel === nivel);
    if (!xs.length) continue;
    linhas.push(`## ${titulo}`, ...xs.map((a) => `- **${a.tema}**: ${a.texto}${a.fontes.length ? ` _(${a.fontes.join(', ')})_` : ''}`), '');
  }
  const pedidos = pedidosDeReenvio(achados);
  if (pedidos.length) linhas.push('## O que pedir de novo ao cliente', ...pedidos.map((p) => `- ${p}`), '');
  return linhas.join('\n');
}

export function mensagemAnaliseDra(nome: string, achados: Achado[]): string {
  const g = achados.filter((a) => a.nivel === 'grave'), at = achados.filter((a) => a.nivel === 'atencao'), fav = achados.filter((a) => a.nivel === 'favoravel');
  if (!g.length && !at.length) {
    return [`🔎 *Análise dos documentos — ${nome}*`, '✅ Documentos coerentes com a história contada. Nada a apontar.',
      ...fav.slice(0, 3).map((a) => `🟢 ${a.texto}`), '', 'Relatório completo nos documentos do caso.'].join('\n');
  }
  return [
    `🔎 *Análise dos documentos — ${nome}*`,
    `${g.length} grave(s) · ${at.length} de atenção · ${fav.length} a favor`, '',
    ...g.slice(0, 6).map((a) => `🔴 *${a.tema}*: ${a.texto}`),
    ...at.slice(0, 4).map((a) => `🟡 *${a.tema}*: ${a.texto}`),
    ...fav.slice(0, 3).map((a) => `🟢 *${a.tema}*: ${a.texto}`),
    '', 'Relatório completo nos documentos do caso (CRM).',
  ].join('\n');
}

export function pedidosDeReenvio(achados: Achado[]): string[] {
  return [...new Set(achados.map((a) => a.reenvio).filter(Boolean) as string[])];
}

/** Ao cliente só vai o pedido neutro, sem falar de divergência. */
export function mensagemReenvio(nome: string, pedidos: string[]): string {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || '';
  return `Olá${primeiro ? `, ${primeiro}` : ''}! Conferimos os documentos que você mandou, obrigada! Para completar, preciso que me envie:\n${pedidos.map((p) => `• ${p}`).join('\n')}\n\nPode mandar por aqui mesmo. 😊`;
}
