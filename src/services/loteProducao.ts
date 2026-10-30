import { reusDoCaso, familiaDaTese, normalizarNomeParte, NOME_FAMILIA, type Familia, type Parte } from './pecaConsolidacao';
import { nucleoBanco, conferirPecasPorBanco, type ContratoSalvo, type ConferenciaPecas } from './contratosDoCaso';

/**
 * Card único do cliente na produção (pedido da Jessica, 30/10/2026): "tudo centralizado
 * em um único card, mesmo que vamos fazer vários processos distintos para protocolar...
 * o CRM deve me entregar pronto, organizado, com os documentos renomeados e as peças
 * prontas para que eu revise e protocole um a um".
 *
 * Cada AÇÃO continua sendo um caso (`cases`): depois do protocolo cada uma tem o seu nº e
 * o seu acompanhamento. O LOTE é a visão do cliente: as ações dele antes do protocolo,
 * os documentos comuns (coletados uma vez) e, por ação, o kit de protocolo — anexos
 * classificados, renomeados e na ordem — e a situação ("faltam documentos", "revisar",
 * "pronta", "protocolada"). Regra de divisão (Jessica): uma peça por banco; RMC e RCC do
 * mesmo banco podem ir juntos (pecaConsolidacao.ts).
 *
 * Regras puras; banco em loteProducaoMysql.ts; testes em tests/loteProducao.test.mjs.
 */

export type TipoDoc =
  | 'procuracao' | 'declaracao_hipossuficiencia' | 'identidade' | 'cpf' | 'comprovante_residencia'
  | 'extrato_emprestimos' | 'historico_creditos' | 'extrato_bancario' | 'contrato_banco' | 'consulta_consignados'
  | 'boletim_ocorrencia' | 'reclamacao' | 'demonstrativo' | 'planilha' | 'outro'
  | 'peticao' | 'interno';

/** Onde o documento vale: em todas as ações do cliente, numa ação (banco), ou nunca vai ao protocolo. */
export type Escopo = 'comum' | 'acao' | 'interno';

interface TipoInfo { rotulo: string; ordem: number; escopo: Escopo }

/** Ordem dos anexos no protocolo (a numeração do kit segue esta ordem). */
export const TIPOS: Record<TipoDoc, TipoInfo> = {
  procuracao: { rotulo: 'Procuração', ordem: 1, escopo: 'comum' },
  declaracao_hipossuficiencia: { rotulo: 'Declaração de hipossuficiência', ordem: 2, escopo: 'comum' },
  identidade: { rotulo: 'Documento de identidade', ordem: 3, escopo: 'comum' },
  cpf: { rotulo: 'CPF', ordem: 4, escopo: 'comum' },
  comprovante_residencia: { rotulo: 'Comprovante de residência', ordem: 5, escopo: 'comum' },
  extrato_emprestimos: { rotulo: 'Extrato de empréstimos consignados do INSS', ordem: 6, escopo: 'comum' },
  historico_creditos: { rotulo: 'Histórico de créditos do INSS', ordem: 7, escopo: 'comum' },
  extrato_bancario: { rotulo: 'Extrato bancário', ordem: 8, escopo: 'comum' },
  contrato_banco: { rotulo: 'Contrato do banco', ordem: 9, escopo: 'acao' },
  consulta_consignados: { rotulo: 'Consulta de cartões e empréstimos', ordem: 10, escopo: 'acao' },
  boletim_ocorrencia: { rotulo: 'Boletim de ocorrência', ordem: 11, escopo: 'comum' },
  reclamacao: { rotulo: 'Reclamação administrativa', ordem: 12, escopo: 'acao' },
  demonstrativo: { rotulo: 'Demonstrativo de descontos', ordem: 13, escopo: 'acao' },
  planilha: { rotulo: 'Planilha de cálculos', ordem: 14, escopo: 'acao' },
  outro: { rotulo: 'Documento', ordem: 15, escopo: 'acao' },
  peticao: { rotulo: 'Petição inicial', ordem: 0, escopo: 'interno' },
  interno: { rotulo: 'Uso interno', ordem: 99, escopo: 'interno' },
};

const semAcento = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Regras na ordem: a primeira que casa decide. Testadas no "tipo do documento" lido e no nome. */
const REGRAS: Array<[RegExp, TipoDoc]> = [
  [/honorarios|prestacao de servicos advocaticios/, 'interno'],
  [/historico de creditos|historico-creditos|historico_creditos|\bhiscre\b/, 'historico_creditos'],
  [/extrato de emprestimos? consignados?|extrato[ _-]emprestimo[ _-]consignado|\bhiscon\b|historico de emprestimo/, 'extrato_emprestimos'],
  [/procuracao|procura[cç]ao/, 'procuracao'],
  [/hipossuficien|declaracao de pobreza|justica gratuita/, 'declaracao_hipossuficiencia'],
  [/comprovante de (residencia|endereco)|conta de (luz|agua|energia|telefone)|\bresidencia\b|\bendereco\b/, 'comprovante_residencia'],
  [/\bcnh\b|\brg\b|identidade|carteira nacional/, 'identidade'],
  [/\bcpf\b/, 'cpf'],
  [/consulta de (emprestimos|cartoes)|cartao de beneficio|\brmc\b|\brcc\b|cartoes?[ _]/, 'consulta_consignados'],
  [/extrato (bancario|de conta|da conta)|extrato[ _]bb|extrato_\w*conta|movimentacao bancaria/, 'extrato_bancario'],
  [/cedula de credito|contrato|\bccb\b/, 'contrato_banco'],
  [/boletim de ocorrencia|\bb\.?o\.?\b/, 'boletim_ocorrencia'],
  [/consumidor\.?gov|procon|reclamacao/, 'reclamacao'],
];

function porRegra(texto: string): TipoDoc | null {
  const t = semAcento(texto).replace(/_/g, ' ');
  for (const [re, tipo] of REGRAS) if (re.test(t) || re.test(semAcento(texto))) return tipo;
  return null;
}

/** "Tipo do documento: X" que a leitura por IA escreve no começo do texto extraído. */
function tipoLido(content: string | null | undefined): string {
  const c = String(content || '');
  const t = c.match(/^TIPO:\s*([^\n]{3,160})/m);
  if (t) return t[1];
  const m = c.match(/tipo d[oe] documento[^\n:]*:?\**\s*\n?\s*\*?\s*([^\n]{3,160})/i);
  return m ? m[1] : '';
}

export interface DocLote {
  id: number; case_id: number | null; name: string; type: string | null; mime: string | null;
  content: string | null; has_data: boolean | number; file_url: string | null;
  versao_de?: number | null; final_em?: string | Date | null; created_at?: string | Date | null;
}

export interface Classificacao { tipo: TipoDoc; rotulo: string; ordem: number; escopo: Escopo }

export function classificarDocumento(d: Pick<DocLote, 'name' | 'content' | 'type'>): Classificacao {
  const nome = String(d.name || '');
  const n = semAcento(nome);
  let tipo: TipoDoc | null = null;
  if (/^peticao inicial/.test(n)) tipo = 'peticao';
  else if (/^planilha de calculos/.test(n)) tipo = 'planilha';
  else if (/^demonstrativo de descontos/.test(n)) tipo = 'demonstrativo';
  else if (/^(dossie da peca|revisao da peticao|analise do caso|relato|parecer|resumo)/.test(n) || (d.type === 'ia' && !/^(contrato|procuracao|declaracao)/.test(n))) tipo = 'interno';
  else tipo = porRegra(tipoLido(d.content)) || porRegra(nome) || 'outro';
  const info = TIPOS[tipo];
  return { tipo, rotulo: info.rotulo, ordem: info.ordem, escopo: info.escopo };
}

/** O texto cita o banco do réu? Compara pelo núcleo do nome ("Itaú Consignado S.A." → "itau"), como palavra inteira. */
export function mencionaBanco(texto: string | null | undefined, reu: string | null | undefined): boolean {
  const nucleo = nucleoBanco(reu);
  if (nucleo.length < 2) return false;
  const t = ` ${normalizarNomeParte(texto)} `;
  return t.includes(` ${nucleo} `);
}

const EXT_MIME: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'pdf', 'image/jpeg': 'pdf', 'image/jpg': 'pdf', 'image/webp': 'pdf' };

/** Foto vira PDF no kit (o PJe pede PDF). */
export const ehImagem = (nome: string, mime?: string | null) => /^image\//.test(String(mime || '')) || /\.(png|jpe?g|webp)$/i.test(nome);

export function extensaoNoKit(original: string, mime?: string | null): string {
  if (ehImagem(original, mime)) return 'pdf';
  const m = String(original).match(/\.([a-z0-9]{2,5})$/i);
  if (m) return m[1].toLowerCase();
  return EXT_MIME[String(mime || '')] || (/spreadsheet/.test(String(mime || '')) ? 'xlsx' : 'pdf');
}

const limparNome = (s: string) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

export function nomeNoKit(e: { ordem: number; rotulo: string; cliente: string; original: string; mime?: string | null; parte?: [number, number] }): string {
  const nn = String(e.ordem).padStart(2, '0');
  const parte = e.parte && e.parte[1] > 1 ? ` (${e.parte[0]} de ${e.parte[1]})` : '';
  return `${nn} - ${limparNome(e.rotulo)}${parte} - ${limparNome(e.cliente)}.${extensaoNoKit(e.original, e.mime)}`;
}

/** Nome padronizado para a lista do CRM (sem o número, que depende do kit). */
export function nomePadrao(c: Classificacao, cliente: string, original: string, mime?: string | null): string | null {
  if (c.escopo === 'interno' || c.tipo === 'outro' || GERADOS_DA_ACAO.includes(c.tipo)) return null;
  const ext = String(original).match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() || (mime === 'application/pdf' ? 'pdf' : '');
  return `${c.rotulo} - ${limparNome(cliente)}${ext ? '.' + ext : ''}`;
}

// ── requisitos ──────────────────────────────────────────────────────────────

export interface Falta { tipo: TipoDoc; rotulo: string; bloqueia: boolean; motivo: string }

const CONSIGNADO: Familia[] = ['emprestimo_consignado', 'cartao_consignado'];

function requisitosComuns(familias: Array<Familia | null>): Falta[] {
  const f = (tipo: TipoDoc, bloqueia: boolean, motivo: string): Falta => ({ tipo, rotulo: TIPOS[tipo].rotulo, bloqueia, motivo });
  const out = [
    f('procuracao', false, 'vai em todo protocolo'),
    f('declaracao_hipossuficiencia', false, 'pedido de justiça gratuita'),
    f('identidade', false, 'qualificação do autor'),
    f('comprovante_residencia', false, 'competência (foro do domicílio do consumidor)'),
  ];
  if (familias.some((x) => x && CONSIGNADO.includes(x))) {
    out.push(f('extrato_emprestimos', true, 'é o único documento que liga cada desconto ao banco e ao contrato; sem ele o cálculo sai zerado'));
    out.push(f('historico_creditos', false, 'mostra os descontos mês a mês no benefício (desde o início de cada contrato)'));
  }
  return out;
}

// ── lote ────────────────────────────────────────────────────────────────────

export interface AcaoLote {
  id: number; titulo: string | null; production_stage: string | null; case_number: string | null;
  legal_area: string | null; partes: Parte[];
}

export type SituacaoAcao = 'faltam_documentos' | 'em_preparo' | 'revisar' | 'pronta' | 'protocolada' | 'recusada';

export const NOME_SITUACAO: Record<SituacaoAcao, string> = {
  faltam_documentos: 'Faltam documentos', em_preparo: 'Peça ainda não gerada', revisar: 'Peça para revisar',
  pronta: 'Pronta para protocolar', protocolada: 'Protocolada', recusada: 'Recusada',
};

export interface ItemKit { docId: number; nome: string; tipo: TipoDoc; original: string; temArquivo: boolean; link: string | null; imagem: boolean }

export interface AcaoMontada extends AcaoLote {
  reu: string | null; familia: Familia | null; nomeFamilia: string | null;
  peca: { docId: number; versao: number; final: boolean; nome: string } | null;
  planilha: { docId: number; nome: string } | null;
  kit: ItemKit[]; faltam: Falta[]; situacao: SituacaoAcao;
}

export interface Lote {
  cliente: string;
  acoes: AcaoMontada[];
  documentos: Array<{ docId: number; original: string; padrao: string | null; tipo: TipoDoc; rotulo: string; escopo: Escopo; caseId: number | null; acoes: number[] }>;
  faltamComuns: Falta[];
  semDestino: number[];
  etapa: string | null;
  resumo: { total: number; prontas: number; protocoladas: number; travadas: number };
  /** Cartões RMC/RCC lidos nos extratos × ações: uma peça por banco (contratosDoCaso.ts). */
  conferencia: ConferenciaPecas;
}

export const ETAPAS = ['em_analise', 'separacao_documentos', 'criacao_inicial', 'revisao_inicial', 'aguardando_protocolo', 'protocolado', 'concluido'];
const PROTOCOLADO = ['protocolado', 'concluido'];

/** Etapa do card do cliente: a da ação mais atrasada que ainda não foi protocolada. */
export function etapaDoLote(acoes: Array<Pick<AcaoLote, 'production_stage'>>): string | null {
  const abertas = acoes.map((a) => String(a.production_stage)).filter((s) => ETAPAS.indexOf(s) >= 0 && !PROTOCOLADO.includes(s));
  if (!abertas.length) return acoes.some((a) => PROTOCOLADO.includes(String(a.production_stage))) ? 'protocolado' : null;
  return abertas.sort((a, b) => ETAPAS.indexOf(a) - ETAPAS.indexOf(b))[0];
}

/** Gerados a cada versão da peça: no kit vai só a versão mais nova, da própria ação. */
const GERADOS_DA_ACAO: TipoDoc[] = ['planilha', 'demonstrativo'];

const versaoDoNome = (nome: string) => Number(String(nome).match(/\(v(\d+)/)?.[1] || 0);

export function montarLote(e: { cliente: string; acoes: AcaoLote[]; documentos: DocLote[]; contratos?: ContratoSalvo[] }): Lote {
  const cls = e.documentos.map((d) => ({ d, c: classificarDocumento(d) }));
  const reuDe = new Map(e.acoes.map((a) => [a.id, String(reusDoCaso({ partes: a.partes, titulo: a.titulo })[0]?.nome || '') || null]));
  const idsAcoes = new Set(e.acoes.map((a) => a.id));

  // Documento de uma ação (banco): vai para as ações cujo banco ele cita; sem citar banco, fica na ação onde foi anexado.
  const acoesDoDoc = (d: DocLote, c: Classificacao): number[] => {
    if (c.escopo === 'interno') return d.case_id != null && idsAcoes.has(d.case_id) ? [d.case_id] : [];
    if (c.escopo === 'comum') return e.acoes.map((a) => a.id);
    const texto = `${d.name}\n${tipoLido(d.content)}\n${String(d.content || '').slice(0, 4000)}`;
    const citadas = e.acoes.filter((a) => mencionaBanco(texto, reuDe.get(a.id))).map((a) => a.id);
    if (citadas.length) return citadas;
    return d.case_id != null && idsAcoes.has(d.case_id) ? [d.case_id] : [];
  };
  const destino = cls.map((x) => ({ ...x, acoes: acoesDoDoc(x.d, x.c) }));

  const familias = e.acoes.map((a) => familiaDaTese(a.titulo));
  const tiposPresentes = new Set(destino.filter((x) => x.c.escopo === 'comum').map((x) => x.c.tipo));
  const faltamComuns = requisitosComuns(familias).filter((f) => !tiposPresentes.has(f.tipo));

  const acoes: AcaoMontada[] = e.acoes.map((a) => {
    const meus = destino.filter((x) => x.acoes.includes(a.id));
    const pecas = meus.filter((x) => x.c.tipo === 'peticao' && x.d.case_id === a.id).sort((p, q) => versaoDoNome(q.d.name) - versaoDoNome(p.d.name) || q.d.id - p.d.id);
    // A versão final marcada vale acima de uma versão mais nova ainda em rascunho.
    const p = pecas.find((x) => x.d.final_em) || pecas[0];
    const maisNovos = (t: TipoDoc) => meus.filter((x) => x.c.tipo === t && x.d.case_id === a.id).sort((p2, q) => versaoDoNome(q.d.name) - versaoDoNome(p2.d.name) || q.d.id - p2.d.id);
    const planilhas = maisNovos('planilha'), demonstrativos = maisNovos('demonstrativo');
    const anexos = [...meus.filter((x) => x.c.escopo !== 'interno' && !GERADOS_DA_ACAO.includes(x.c.tipo)), ...demonstrativos.slice(0, 1), ...planilhas.slice(0, 1)]
      .sort((x, y) => x.c.ordem - y.c.ordem || x.d.id - y.d.id);
    const totalPorTipo = new Map<TipoDoc, number>();
    for (const x of anexos) totalPorTipo.set(x.c.tipo, (totalPorTipo.get(x.c.tipo) || 0) + 1);
    const visto = new Map<TipoDoc, number>();
    const kit: ItemKit[] = anexos.map((x, i) => {
      const n = (visto.get(x.c.tipo) || 0) + 1; visto.set(x.c.tipo, n);
      return {
        docId: x.d.id, tipo: x.c.tipo, original: x.d.name, temArquivo: !!Number(x.d.has_data) || /drive\.google\.com/.test(String(x.d.file_url || '')), link: x.d.file_url || null,
        imagem: ehImagem(x.d.name, x.d.mime),
        nome: nomeNoKit({ ordem: i + 1, rotulo: x.c.rotulo, cliente: e.cliente, original: x.d.name, mime: x.d.mime, parte: [n, totalPorTipo.get(x.c.tipo) || 1] }),
      };
    });
    const familia = familiaDaTese(a.titulo);
    const faltam = requisitosComuns([familia]).filter((f) => !tiposPresentes.has(f.tipo));
    const etapa = String(a.production_stage);
    // Versão final marcada (ou enviada) pela Dra. é decisão dela: a ação fica pronta, e o que falta segue listado.
    const situacao: SituacaoAcao = etapa === 'recusado' ? 'recusada'
      : PROTOCOLADO.includes(etapa) ? 'protocolada'
        : p?.d.final_em ? 'pronta'
          : faltam.some((f) => f.bloqueia) ? 'faltam_documentos'
            : !p ? 'em_preparo' : 'revisar';
    return {
      ...a, reu: reuDe.get(a.id) || null, familia, nomeFamilia: familia ? NOME_FAMILIA[familia] : null,
      peca: p ? { docId: p.d.id, versao: versaoDoNome(p.d.name) || 1, final: !!p.d.final_em, nome: p.d.name } : null,
      planilha: planilhas[0] ? { docId: planilhas[0].d.id, nome: planilhas[0].d.name } : null,
      kit, faltam, situacao,
    };
  });

  return {
    cliente: e.cliente,
    acoes,
    documentos: destino.map((x) => ({
      docId: x.d.id, original: x.d.name, padrao: nomePadrao(x.c, e.cliente, x.d.name, x.d.mime), tipo: x.c.tipo, rotulo: x.c.rotulo,
      escopo: x.c.escopo, caseId: x.d.case_id, acoes: x.acoes,
    })),
    faltamComuns,
    semDestino: destino.filter((x) => x.c.escopo !== 'interno' && !x.acoes.length).map((x) => x.d.id),
    etapa: etapaDoLote(e.acoes),
    resumo: {
      total: acoes.length,
      prontas: acoes.filter((a) => a.situacao === 'pronta').length,
      protocoladas: acoes.filter((a) => a.situacao === 'protocolada').length,
      travadas: acoes.filter((a) => a.situacao === 'faltam_documentos').length,
    },
    conferencia: conferirPecasPorBanco(e.contratos || [], e.acoes
      .filter((a) => a.production_stage !== 'recusado')
      .map((a) => ({ id: a.id, titulo: a.titulo, reus: reusDoCaso({ partes: a.partes, titulo: a.titulo }) }))),
  };
}

// ── quadro ──────────────────────────────────────────────────────────────────

export interface LinhaQuadro { id: number; client_id: number | null; client_name?: string | null; production_stage: string | null; sla_days?: number | null; pendencias?: number | null; [k: string]: unknown }
export interface LoteQuadro { casos: number[]; protocoladas: number; total: number; titulos: string[]; mover: Record<string, number[]> }
export type LinhaAgrupada = LinhaQuadro & { lote?: LoteQuadro };

const ANTES_DO_PROTOCOLO = ETAPAS.slice(0, 5);

/**
 * Arrastar o card do cliente para uma coluna antes do protocolo: para a frente, avançam as ações
 * que ficaram para trás (a que já está à frente fica); para trás, voltam todas. Protocolo não
 * entra: é uma ação por vez, na tela do cliente.
 */
export function acoesParaMover(grupo: Array<Pick<LinhaQuadro, 'id' | 'production_stage'>>): Record<string, number[]> {
  const idx = (s: unknown) => ETAPAS.indexOf(String(s));
  const atual = idx(etapaDoLote(grupo));
  const mover: Record<string, number[]> = {};
  ANTES_DO_PROTOCOLO.forEach((destino, t) => {
    mover[destino] = t === atual ? [] : grupo.filter((g) => (t > atual ? idx(g.production_stage) < t : idx(g.production_stage) > t)).map((g) => g.id);
  });
  return mover;
}

/**
 * Quadro da produção: cliente com 2 ou mais ações antes do protocolo vira UM card, na etapa
 * da ação mais atrasada (o maior prazo e a soma das pendências). Ações protocoladas,
 * concluídas ou recusadas seguem como cards próprios (cada uma já é um processo).
 */
export function agruparQuadro<T extends LinhaQuadro>(rows: T[]): Array<T & { lote?: LoteQuadro }> {
  const abertasPorCliente = new Map<number, T[]>();
  for (const r of rows) {
    if (r.client_id == null || !ANTES_DO_PROTOCOLO.includes(String(r.production_stage))) continue;
    const l = abertasPorCliente.get(r.client_id) || []; l.push(r); abertasPorCliente.set(r.client_id, l);
  }
  const out: Array<T & { lote?: LoteQuadro }> = [];
  const feitos = new Set<number>();
  for (const r of rows) {
    const grupo = r.client_id != null ? abertasPorCliente.get(r.client_id) : undefined;
    if (!grupo || grupo.length < 2 || !grupo.includes(r)) { out.push(r); continue; }
    if (feitos.has(r.client_id as number)) continue;
    feitos.add(r.client_id as number);
    const protocoladas = rows.filter((x) => x.client_id === r.client_id && PROTOCOLADO.includes(String(x.production_stage))).length;
    const etapa = etapaDoLote(grupo);
    const base = grupo.find((g) => g.production_stage === etapa) || grupo[0];
    out.push({
      ...base,
      production_stage: etapa,
      sla_days: Math.max(...grupo.map((g) => Number(g.sla_days) || 0)),
      pendencias: grupo.reduce((s, g) => s + (Number(g.pendencias) || 0), 0),
      lote: { casos: grupo.map((g) => g.id), protocoladas, total: grupo.length + protocoladas, titulos: grupo.map((g) => String(g.title || '')), mover: acoesParaMover(grupo) },
    });
  }
  return out;
}
