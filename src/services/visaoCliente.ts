/**
 * Visão completa do cliente (pedido da Jessica, 18/10/2026): pesquisar um
 * cliente na página inicial e ver tudo dele num lugar só — se é dativo,
 * parceria ou próprio, processos e números, financeiro, acordos e repasses,
 * movimentações, prazos, audiências, propostas, contratos e documentos.
 * Aqui ficam as regras (classificação, totais, alertas, linha do tempo); a
 * leitura do banco está em visaoClienteServico.ts.
 * Regras puras — tests/visaoCliente.test.mjs.
 */

export interface Relacao { tipo: 'dativo' | 'parceria' | 'proprio'; rotulo: string; detalhe: string }

const num = (v: any) => Number(v) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const dia = (v: any): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/** Dativo (nomeação do juízo), parceria (caso com parceiro) e/ou próprio (caso do escritório). */
export function relacoes(d: {
  isDative?: boolean | number | null;
  dativos: Array<{ id: number; case_id?: number | null; legal_process_id?: number | null; comarca?: string | null; status?: string | null }>;
  casos: Array<{ id: number; partner_id?: number | null; partner_name?: string | null }>;
  /** Processos monitorados: os que não são de parceria nem de dativo também contam como próprios (visto em 18/10/2026). */
  processos?: Array<{ id: number; case_id?: number | null }>;
}): Relacao[] {
  const out: Relacao[] = [];
  const dativosAtivos = d.dativos.filter((x) => x.status !== 'recusada');
  if (dativosAtivos.length || d.isDative) {
    const comarcas = [...new Set(dativosAtivos.map((x) => x.comarca).filter(Boolean))];
    out.push({ tipo: 'dativo', rotulo: 'Dativo', detalhe: dativosAtivos.length ? `${dativosAtivos.length} nomeação(ões)${comarcas.length ? ` · ${comarcas.join(', ')}` : ''}` : 'marcado como dativo' });
  }
  const casosDativos = new Set(d.dativos.map((x) => x.case_id).filter(Boolean));
  const parceria = d.casos.filter((c) => c.partner_id);
  if (parceria.length) {
    const nomes = [...new Set(parceria.map((c) => c.partner_name).filter(Boolean))];
    out.push({ tipo: 'parceria', rotulo: 'Parceria', detalhe: `${parceria.length} caso(s)${nomes.length ? ` com ${nomes.join(', ')}` : ''}` });
  }
  const proprios = d.casos.filter((c) => !c.partner_id && !casosDativos.has(c.id));
  // Processo monitorado sem caso (ou de caso próprio), que não é de dativo nem de parceria.
  const casosParceria = new Set(parceria.map((c) => c.id));
  const procDativos = new Set(d.dativos.map((x) => x.legal_process_id).filter(Boolean));
  const procSoltos = (d.processos || []).filter((p) => !procDativos.has(p.id) && !(p.case_id && (casosParceria.has(p.case_id) || casosDativos.has(p.case_id) || proprios.some((c) => c.id === p.case_id))));
  if (proprios.length || procSoltos.length) {
    const partes = [proprios.length ? `${proprios.length} caso(s)` : '', procSoltos.length ? `${procSoltos.length} processo(s) sem caso cadastrado` : ''].filter(Boolean);
    out.push({ tipo: 'proprio', rotulo: 'Próprio', detalhe: `${partes.join(' e ')} do escritório` });
  }
  return out;
}

const PAGO_PARCELA = new Set(['pago']);
const ABERTO_PARCELA = new Set(['pendente', 'vencido', 'em_processamento']);
const RECEITA_FECHADA = new Set(['recebido', 'pago', 'cancelado']);
const REPASSE_FEITO = new Set(['repassado', 'pago', 'concluido']);

export interface ResumoFinanceiro {
  aReceber: number; vencido: number; recebido: number;
  acordos: { total: number; honorarios: number; ativos: number };
  repasseCliente: { pendente: number; repassado: number };
  dativo: { aReceber: number; recebido: number };
  parceiro: { pendente: number; pago: number };
}

/** Totais do cliente. "vencido" = em aberto com vencimento antes de hoje. */
export function resumoFinanceiro(d: {
  parcelas: Array<{ valor: any; status: string; due_date: any }>;
  receitas: Array<{ valor: any; saldo_pendente?: any; total_recebido?: any; status: string; data_vencimento: any }>;
  acordos: Array<{ total_agreement_value: any; honorarium_value: any; status: string }>;
  repassesCliente: Array<{ valor_liquido: any; status: string }>;
  pagamentosDativo: Array<{ value: any; status: string }>;
  repassesParceiro: Array<{ valor: any; status: string }>;
}, hoje: string): ResumoFinanceiro {
  let aReceber = 0, vencido = 0, recebido = 0;
  for (const p of d.parcelas) {
    const v = num(p.valor);
    if (PAGO_PARCELA.has(p.status)) recebido += v;
    else if (ABERTO_PARCELA.has(p.status)) { aReceber += v; if ((dia(p.due_date) || '9999') < hoje) vencido += v; }
  }
  for (const r of d.receitas) {
    if (r.status === 'cancelado') continue;
    recebido += num(r.total_recebido);
    if (!RECEITA_FECHADA.has(r.status)) {
      const saldo = r.saldo_pendente != null ? num(r.saldo_pendente) : num(r.valor) - num(r.total_recebido);
      aReceber += saldo;
      if ((dia(r.data_vencimento) || '9999') < hoje) vencido += saldo;
    }
  }
  const acordosValidos = d.acordos.filter((a) => !/cancel|recus/i.test(a.status || ''));
  return {
    aReceber: r2(aReceber), vencido: r2(vencido), recebido: r2(recebido),
    acordos: {
      total: r2(acordosValidos.reduce((s, a) => s + num(a.total_agreement_value), 0)),
      honorarios: r2(acordosValidos.reduce((s, a) => s + num(a.honorarium_value), 0)),
      ativos: acordosValidos.filter((a) => !/quitad|conclu|encerr/i.test(a.status || '')).length,
    },
    repasseCliente: {
      pendente: r2(d.repassesCliente.filter((x) => !REPASSE_FEITO.has(x.status) && x.status !== 'cancelado').reduce((s, x) => s + num(x.valor_liquido), 0)),
      repassado: r2(d.repassesCliente.filter((x) => REPASSE_FEITO.has(x.status)).reduce((s, x) => s + num(x.valor_liquido), 0)),
    },
    dativo: {
      aReceber: r2(d.pagamentosDativo.filter((x) => x.status !== 'recebido').reduce((s, x) => s + num(x.value), 0)),
      recebido: r2(d.pagamentosDativo.filter((x) => x.status === 'recebido').reduce((s, x) => s + num(x.value), 0)),
    },
    parceiro: {
      pendente: r2(d.repassesParceiro.filter((x) => !REPASSE_FEITO.has(x.status) && x.status !== 'cancelado').reduce((s, x) => s + num(x.valor), 0)),
      pago: r2(d.repassesParceiro.filter((x) => REPASSE_FEITO.has(x.status)).reduce((s, x) => s + num(x.valor), 0)),
    },
  };
}

export interface Alerta { nivel: 'urgente' | 'atencao'; texto: string }

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

/** O que pede ação agora: prazo, parcela vencida, repasse pendente, audiência próxima. */
export function alertas(d: {
  prazos: Array<{ description: string; deadline_date: any; status: string }>;
  parcelas: Array<{ numero?: any; valor: any; status: string; due_date: any }>;
  repassesCliente: Array<{ valor_liquido: any; status: string; data_prevista?: any }>;
  audiencias: Array<{ titulo: string; data: any }>;
}, hoje: string): Alerta[] {
  const out: Alerta[] = [];
  for (const p of d.prazos.filter((x) => x.status === 'pendente')) {
    const dd = dia(p.deadline_date); if (!dd) continue;
    const falta = diasEntre(hoje, dd);
    if (falta < 0) out.push({ nivel: 'urgente', texto: `Prazo vencido em ${br(dd)}: ${p.description}` });
    else if (falta <= 7) out.push({ nivel: falta <= 2 ? 'urgente' : 'atencao', texto: `Prazo em ${falta === 0 ? 'hoje' : `${falta} dia(s)`} (${br(dd)}): ${p.description}` });
  }
  const vencidas = d.parcelas.filter((p) => ABERTO_PARCELA.has(p.status) && (dia(p.due_date) || '9999') < hoje);
  if (vencidas.length) out.push({ nivel: 'atencao', texto: `${vencidas.length} parcela(s) vencida(s), total ${brl(vencidas.reduce((s, p) => s + num(p.valor), 0))}` });
  const repasses = d.repassesCliente.filter((x) => !REPASSE_FEITO.has(x.status) && x.status !== 'cancelado');
  if (repasses.length) out.push({ nivel: 'atencao', texto: `Repasse ao cliente pendente: ${brl(repasses.reduce((s, x) => s + num(x.valor_liquido), 0))}` });
  for (const a of d.audiencias) {
    const dd = dia(a.data); if (!dd) continue;
    const falta = diasEntre(hoje, dd);
    if (falta >= 0 && falta <= 7) out.push({ nivel: falta <= 1 ? 'urgente' : 'atencao', texto: `${a.titulo} em ${falta === 0 ? 'hoje' : `${falta} dia(s)`} (${br(dd)})` });
  }
  return out.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'urgente' ? -1 : 1));
}

export interface EventoLinha { data: string; tipo: 'movimentacao' | 'prazo' | 'audiencia' | 'pagamento' | 'registro'; texto: string; ref?: string | null }

/** Uma linha do tempo só, do mais novo para o mais antigo. */
export function linhaDoTempo(d: {
  movimentacoes: Array<{ data: any; description: string; process_number?: string | null }>;
  prazos: Array<{ deadline_date: any; description: string; status: string }>;
  audiencias: Array<{ data: any; titulo: string }>;
  pagamentos: Array<{ data: any; texto: string }>;
  registros: Array<{ created_at: any; description: string }>;
}, limite = 60): EventoLinha[] {
  const ev: EventoLinha[] = [];
  for (const m of d.movimentacoes) { const x = dia(m.data); if (x) ev.push({ data: x, tipo: 'movimentacao', texto: m.description, ref: m.process_number || null }); }
  for (const p of d.prazos) { const x = dia(p.deadline_date); if (x) ev.push({ data: x, tipo: 'prazo', texto: `Prazo (${p.status}): ${p.description}` }); }
  for (const a of d.audiencias) { const x = dia(a.data); if (x) ev.push({ data: x, tipo: 'audiencia', texto: a.titulo }); }
  for (const p of d.pagamentos) { const x = dia(p.data); if (x) ev.push({ data: x, tipo: 'pagamento', texto: p.texto }); }
  for (const r of d.registros) { const x = dia(r.created_at); if (x) ev.push({ data: x, tipo: 'registro', texto: r.description }); }
  return ev.sort((a, b) => b.data.localeCompare(a.data)).slice(0, limite);
}

const br = (iso: string) => iso.split('-').reverse().join('/');
const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Normaliza o que foi digitado na busca: só dígitos vira CPF/telefone/processo. */
export function termoDeBusca(q: string): { texto: string; digitos: string } {
  const texto = String(q || '').trim().slice(0, 80);
  return { texto, digitos: texto.replace(/\D/g, '') };
}
