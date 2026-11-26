/**
 * Caminho do pagamento de uma demanda dativa (pedido da Dra., 13/11/2026).
 *
 * Nomeação (processo + aceite) → atuação → certidão → cadastro no e-Flow (gera o
 * protocolo) → acompanhamento no e-Docs (deferido ou indeferido) → lista de
 * pagamento da Sefaz (OPV) → saque no banco e baixa.
 *
 * Fonte única das etapas, dos links e da regra de avanço: a rota grava, a tela só
 * mostra o que vem daqui. O status salvo continua em `dative_cases.status`; os
 * campos de cada etapa (data da certidão, protocolo, decisão, lista) ficam em
 * colunas próprias. Registrar um desses campos avança a etapa, nunca volta.
 */

export const LINKS_DATIVO = {
  eflow: 'https://e-flow.es.gov.br/flow-definition/38c32372-13cd-8e0c-630e-b1eca22972a9',
  edocs: 'https://edocs.es.gov.br/',
  sefaz: 'https://sefaz.es.gov.br/obrigacoes-de-pequeno-valor-opv-dativos',
} as const;

export interface Etapa {
  status: string;
  rotulo: string;
  /** O que falta fazer para sair desta etapa. */
  acao: string | null;
  link: string | null;
}

export const ETAPAS_DATIVO: Etapa[] = [
  { status: 'nomeada', rotulo: 'Nomeação', acao: 'Conferir o nº do processo e dar o aceite', link: null },
  { status: 'em_andamento', rotulo: 'Atuação', acao: 'Atuar no processo (audiências, peças)', link: null },
  { status: 'concluida', rotulo: 'Atuação concluída — aguardando certidão', acao: 'Pedir/baixar a certidão de atuação', link: null },
  { status: 'aguardando_liberacao_requerimento', rotulo: 'Certidão emitida — cadastrar no e-Flow', acao: 'Cadastrar a certidão no e-Flow e anotar o protocolo', link: LINKS_DATIVO.eflow },
  { status: 'protocolada', rotulo: 'Protocolada — em análise no e-Docs', acao: 'Acompanhar no e-Docs se foi deferido', link: LINKS_DATIVO.edocs },
  { status: 'deferida', rotulo: 'Deferida — aguardando lista da Sefaz', acao: 'Conferir se saiu na lista de pagamento da Sefaz', link: LINKS_DATIVO.sefaz },
  { status: 'a_receber', rotulo: 'Na lista da Sefaz — disponível para saque', acao: 'Sacar no banco e dar baixa', link: null },
  { status: 'paga', rotulo: 'Recebida', acao: null, link: null },
];

/** Desvio do caminho: o pedido de pagamento foi negado no e-Docs. */
export const ETAPA_INDEFERIDA: Etapa = {
  status: 'indeferida', rotulo: 'Indeferida', acao: 'Ver o motivo no e-Docs e decidir se recorre ou corrige', link: LINKS_DATIVO.edocs,
};

/** Colunas do quadro "Caminho do pagamento" (da atuação concluída em diante). */
export const ETAPAS_DO_QUADRO = [
  'concluida', 'aguardando_liberacao_requerimento', 'protocolada', 'deferida', 'a_receber', 'indeferida',
] as const;

/**
 * Arrastar o card para outra etapa (pedido de 16/11/2026), em qualquer quadro:
 * a etapa escolhida vale como está, para frente ou para trás (serve para
 * corrigir). Não mexe em demanda já recebida ou recusada, e não leva a
 * "recebida" (isso é a baixa, que registra o pagamento) nem a "recusada"
 * (exige motivo).
 */
export function validarMovimentoNoQuadro(atual: string, destino: string):
  { ok: true; status: string } | { ok: false; erro: string } {
  if (atual === 'paga') return { ok: false, erro: 'Esta demanda já está recebida; para mudar, edite a ficha' };
  if (atual === 'recusada') return { ok: false, erro: 'Esta demanda está recusada; desfaça a recusa na ficha' };
  if (destino === 'paga') return { ok: false, erro: 'Para marcar como recebida, use "Recebi no banco — dar baixa" na ficha' };
  if (destino === 'recusada') return { ok: false, erro: 'Para recusar, use "Recusar" na ficha (precisa do motivo)' };
  if (!ETAPAS_DATIVO.some((e) => e.status === destino) && destino !== ETAPA_INDEFERIDA.status) {
    return { ok: false, erro: 'Etapa inválida' };
  }
  return { ok: true, status: destino };
}

const ORDEM: Record<string, number> =Object.fromEntries(ETAPAS_DATIVO.map((e, i) => [e.status, i + 1]));
ORDEM.indeferida = ORDEM.deferida; // mesma altura do deferimento

export interface CamposFluxo {
  aceite_date?: string | null;
  certidao_date?: string | null;
  eflow_protocolo?: string | null;
  eflow_link?: string | null;
  eflow_protocolo_date?: string | null;
  decisao_pagamento?: string | null;
  decisao_pagamento_date?: string | null;
  decisao_pagamento_motivo?: string | null;
  sefaz_lista_date?: string | null;
  sefaz_lista_ref?: string | null;
}

const preenchido = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '';

/**
 * Etapa depois de registrar os campos do fluxo. Só avança; paga e recusada ficam
 * como estão. A decisão é a única que pode trocar deferida ↔ indeferida.
 */
export function statusAposRegistro(atual: string, c: CamposFluxo): string {
  if (atual === 'paga' || atual === 'recusada') return atual;
  let alvo = atual;
  const avancar = (s: string) => { if ((ORDEM[s] ?? 0) > (ORDEM[alvo] ?? 0)) alvo = s; };

  if (preenchido(c.certidao_date)) avancar('aguardando_liberacao_requerimento');
  if (preenchido(c.eflow_protocolo)) avancar('protocolada');
  if (c.decisao_pagamento === 'deferido' || c.decisao_pagamento === 'indeferido') {
    const decidido = c.decisao_pagamento === 'deferido' ? 'deferida' : 'indeferida';
    if ((ORDEM[alvo] ?? 0) <= ORDEM.deferida) alvo = decidido;
  }
  if (preenchido(c.sefaz_lista_date)) avancar('a_receber');
  return alvo;
}

const diasEntre = (de: string, ate: string) =>
  Math.round((Date.parse(ate.slice(0, 10)) - Date.parse(de.slice(0, 10))) / 86_400_000);

/** Data em que a demanda entrou na etapa atual, quando o fluxo registra isso. */
function entradaNaEtapa(caso: Record<string, any>): string | null {
  const d = (v: any) => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : null);
  switch (caso.status) {
    case 'nomeada': return d(caso.nomeacao_date);
    case 'aguardando_liberacao_requerimento': return d(caso.certidao_date);
    case 'protocolada': return d(caso.eflow_protocolo_date);
    case 'deferida': case 'indeferida': return d(caso.decisao_pagamento_date);
    case 'a_receber': return d(caso.sefaz_lista_date);
    default: return null;
  }
}

export interface ResumoFluxo {
  atual: string;
  rotulo: string;
  posicao: number;
  total: number;
  proximo: { acao: string; link: string | null } | null;
  dias_na_etapa: number | null;
}

export function resumoFluxo(caso: Record<string, any>, hoje: string): ResumoFluxo {
  const etapa = caso.status === 'indeferida'
    ? ETAPA_INDEFERIDA
    : ETAPAS_DATIVO.find((e) => e.status === caso.status) ?? null;
  const entrada = entradaNaEtapa(caso);
  return {
    atual: caso.status,
    rotulo: etapa?.rotulo ?? (caso.status === 'recusada' ? 'Nomeação recusada' : String(caso.status)),
    posicao: ORDEM[caso.status] ?? 0,
    total: ETAPAS_DATIVO.length,
    proximo: etapa?.acao ? { acao: etapa.acao, link: etapa.link } : null,
    dias_na_etapa: entrada ? Math.max(0, diasEntre(entrada, hoje)) : null,
  };
}

const DATAS = ['aceite_date', 'certidao_date', 'eflow_protocolo_date', 'decisao_pagamento_date', 'sefaz_lista_date'] as const;
const TEXTOS: Record<string, number> = { eflow_protocolo: 80, decisao_pagamento_motivo: 500, sefaz_lista_ref: 120 };
const ROTULO_CAMPO: Record<string, string> = {
  aceite_date: 'Data do aceite', certidao_date: 'Data da certidão', eflow_protocolo_date: 'Data do protocolo',
  decisao_pagamento_date: 'Data da decisão', sefaz_lista_date: 'Data da lista da Sefaz',
  eflow_protocolo: 'Protocolo do e-Flow', decisao_pagamento_motivo: 'Motivo do indeferimento', sefaz_lista_ref: 'Lista da Sefaz',
};

/** Pega só os campos do fluxo que vieram no corpo, limpos. Vazio vira null (apaga). */
export function validarCamposFluxo(body: Record<string, any>):
  { ok: true; campos: CamposFluxo } | { ok: false; erro: string } {
  const campos: Record<string, string | null> = {};
  for (const k of DATAS) {
    if (body[k] === undefined) continue;
    const v = String(body[k] ?? '').trim();
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, erro: `${ROTULO_CAMPO[k]}: data inválida` };
    campos[k] = v || null;
  }
  for (const [k, max] of Object.entries(TEXTOS)) {
    if (body[k] === undefined) continue;
    const v = String(body[k] ?? '').trim();
    if (v.length > max) return { ok: false, erro: `${ROTULO_CAMPO[k]}: no máximo ${max} caracteres` };
    campos[k] = v || null;
  }
  // Link de consulta que sai junto com o protocolo (Jessica, 26/11/2026). Só
  // http/https: o link vira um botão na ficha, então nada de javascript: etc.
  if (body.eflow_link !== undefined) {
    const v = String(body.eflow_link ?? '').trim();
    if (v.length > 500) return { ok: false, erro: 'Link de consulta: no máximo 500 caracteres' };
    if (v && !/^https?:\/\/[^\s]+$/i.test(v)) return { ok: false, erro: 'Link de consulta: cole o endereço completo, começando com https://' };
    campos.eflow_link = v || null;
  }
  if (body.decisao_pagamento !== undefined) {
    const v = String(body.decisao_pagamento ?? '').trim();
    if (v && v !== 'deferido' && v !== 'indeferido') return { ok: false, erro: 'Decisão: use deferido ou indeferido' };
    campos.decisao_pagamento = v || null;
  }
  return { ok: true, campos };
}
