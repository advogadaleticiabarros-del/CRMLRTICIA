// Fechamento de caso de parceria com RPV (pedido da Jessica, 13/11/2026).
//
// Fluxo real: o RPV sai, a Dra. saca o valor inteiro, transfere à parceira a parte
// da cliente + a parte da parceria; a parceira paga a cliente e manda recibo e
// vídeo-depoimento. O caso fica finalizado com os quatro números:
//   repasse à parceria (transferência total) = valor da cliente + valor da parceria
//   valor da parceria = honorários × fatia da parceira
//   nosso caixa       = honorários − valor da parceria
//
// Contabilidade (mesmo modelo do "Êxito" da parceria): a receita do escritório é o
// honorário inteiro e o repasse é só a parte da parceria. O dinheiro da cliente
// apenas passa pela conta: fica registrado no fechamento, nunca vira receita.
//
// Interface pequena: `calcularDivisaoRpv` (conta pura) e `registrarFechamentoRpv`
// (orquestra com o banco injetado — ver fechamentoRpvParceriaMysql.ts).

export interface EntradaDivisao {
  valorSacado: number;
  honorariosPercentual: number;
  parceiraPercentual: number;
  /** Valor realmente pago à cliente (quando difere do cálculo). */
  valorCliente?: number | null;
  /** Valor realmente ficado com a parceria (quando difere do cálculo). */
  valorParceira?: number | null;
}

export interface DivisaoRpv {
  valorSacado: number;
  valorCliente: number;
  honorarios: number;
  valorParceira: number;
  valorEscritorio: number;
  valorRepasse: number;
}

const centavos = (v: number) => Math.round(Number(v || 0) * 100);
const reais = (c: number) => c / 100;
const informado = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '' && Number.isFinite(Number(v));

export function calcularDivisaoRpv(e: EntradaDivisao): DivisaoRpv {
  const sacado = centavos(e.valorSacado);
  const cliente = informado(e.valorCliente)
    ? centavos(Number(e.valorCliente))
    : Math.round(sacado * (1 - Number(e.honorariosPercentual) / 100));
  const honorarios = sacado - cliente;
  const parceira = informado(e.valorParceira)
    ? centavos(Number(e.valorParceira))
    : Math.round(honorarios * Number(e.parceiraPercentual) / 100);
  return {
    valorSacado: reais(sacado),
    valorCliente: reais(cliente),
    honorarios: reais(honorarios),
    valorParceira: reais(parceira),
    valorEscritorio: reais(honorarios - parceira),
    valorRepasse: reais(cliente + parceira),
  };
}

/** Lista o que está errado na divisão (vazia = pode gravar). */
export function conferirDivisaoRpv(d: DivisaoRpv): string[] {
  const erros: string[] = [];
  if (!(d.valorSacado > 0)) erros.push('Informe o valor sacado do RPV (maior que zero).');
  if (d.valorCliente < 0 || d.valorCliente > d.valorSacado) erros.push('O valor da cliente não pode ser negativo nem maior que o valor sacado.');
  if (d.valorParceira < 0 || d.valorParceira > Math.max(d.honorarios, 0)) erros.push('O valor da parceria não pode ser negativo nem maior que os honorários.');
  return erros;
}

export interface ComprovantesFechamento { recibo_document_id: number | null; video_document_id: number | null }

export function situacaoFechamento(f: ComprovantesFechamento): { completo: boolean; faltam: string[] } {
  const faltam: string[] = [];
  if (!f.recibo_document_id) faltam.push('recibo');
  if (!f.video_document_id) faltam.push('vídeo-depoimento');
  return { completo: faltam.length === 0, faltam };
}

export class ErroFechamento extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export interface CasoParceria {
  id: number; client_id: number; client_name: string | null; case_number: string | null;
  partner_id: number | null; partner_name: string | null;
  success_fee_percent: number | null; partner_split_percent: number | null;
}

export interface RepoFechamento {
  buscarCaso(caseId: number): Promise<CasoParceria | null>;
  buscarFechamento(caseId: number): Promise<{ id: number; receita_id: number | null; repasse_id: number | null } | null>;
  /** Receita/repasse pendentes "sem data" criados pelo botão Êxito/Sucumb. — reaproveitados. */
  buscarPendentesDoResultado(caseId: number): Promise<{ receitaId: number | null; repasseId: number | null }>;
  salvarReceita(r: { id: number | null; userId: number; clientId: number; caseId: number; descricao: string; valor: number; data: string }): Promise<number>;
  salvarRepasse(r: { id: number | null; caseId: number; parceiro: string; valor: number; percentual: number; descricao: string; data: string }): Promise<number>;
  salvarFechamento(f: DadosFechamento): Promise<number>;
  encerrarCaso(e: { caseId: number; valorObtido: number; data: string }): Promise<void>;
  registrarLinhaDoTempo(l: { clientId: number; caseId: number; userId: number; descricao: string }): Promise<void>;
}

export interface DadosFechamento extends DivisaoRpv {
  id: number | null; caseId: number; partnerId: number; userId: number;
  honorariosPercentual: number; parceiraPercentual: number;
  dataSaque: string; dataRepasse: string; dataPagamentoCliente: string | null;
  receitaId: number | null; repasseId: number | null; observacoes: string | null;
}

export interface EntradaFechamento {
  caseId: number; userId: number; valorSacado: number;
  honorariosPercentual?: number | null; parceiraPercentual?: number | null;
  valorCliente?: number | null; valorParceira?: number | null;
  dataSaque?: string | null; dataRepasse?: string | null; dataPagamentoCliente?: string | null;
  observacoes?: string | null;
  /** Data de hoje (AAAA-MM-DD, Brasília) — injetada para teste. */
  hoje?: string;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataValida = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function hojeBrasilia(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}

export async function registrarFechamentoRpv(repo: RepoFechamento, e: EntradaFechamento) {
  const caso = await repo.buscarCaso(e.caseId);
  if (!caso || !caso.partner_id) throw new ErroFechamento('Caso de parceria não encontrado', 404);

  const honorariosPercentual = informado(e.honorariosPercentual) ? Number(e.honorariosPercentual) : Number(caso.success_fee_percent ?? 30);
  const parceiraPercentual = informado(e.parceiraPercentual) ? Number(e.parceiraPercentual) : Number(caso.partner_split_percent ?? 50);
  if (honorariosPercentual < 0 || honorariosPercentual > 100 || parceiraPercentual < 0 || parceiraPercentual > 100) {
    throw new ErroFechamento('Os percentuais precisam ficar entre 0 e 100.');
  }
  const divisao = calcularDivisaoRpv({ valorSacado: Number(e.valorSacado), honorariosPercentual, parceiraPercentual, valorCliente: e.valorCliente, valorParceira: e.valorParceira });
  const erros = conferirDivisaoRpv(divisao);
  if (erros.length) throw new ErroFechamento(erros.join(' '));

  const hoje = e.hoje || hojeBrasilia();
  const dataSaque = dataValida(e.dataSaque) ? e.dataSaque! : hoje;
  const dataRepasse = dataValida(e.dataRepasse) ? e.dataRepasse! : dataSaque;
  const dataPagamentoCliente = dataValida(e.dataPagamentoCliente) ? e.dataPagamentoCliente! : null;

  const existente = await repo.buscarFechamento(e.caseId);
  const pendentes = existente ? { receitaId: null, repasseId: null } : await repo.buscarPendentesDoResultado(e.caseId);
  const cliente = caso.client_name || 'cliente';
  const proc = caso.case_number ? ` · proc. ${caso.case_number}` : '';
  const parceiro = caso.partner_name || 'Parceria';

  const receitaId = await repo.salvarReceita({
    id: existente?.receita_id ?? pendentes.receitaId, userId: e.userId, clientId: caso.client_id, caseId: caso.id,
    descricao: `Honorários RPV (${honorariosPercentual}% sobre R$ ${brl(divisao.valorSacado)}) — ${cliente}${proc}`,
    valor: divisao.honorarios, data: dataSaque,
  });

  let repasseId: number | null = existente?.repasse_id ?? pendentes.repasseId;
  if (divisao.valorParceira > 0 || repasseId) {
    repasseId = await repo.salvarRepasse({
      id: repasseId, caseId: caso.id, parceiro, valor: divisao.valorParceira, percentual: parceiraPercentual,
      descricao: `Repasse êxito RPV — ${cliente}${proc} · transferência total R$ ${brl(divisao.valorRepasse)} `
        + `(cliente R$ ${brl(divisao.valorCliente)} + parceria R$ ${brl(divisao.valorParceira)})`,
      data: dataRepasse,
    });
  }

  const id = await repo.salvarFechamento({
    ...divisao, id: existente?.id ?? null, caseId: caso.id, partnerId: caso.partner_id, userId: e.userId,
    honorariosPercentual, parceiraPercentual, dataSaque, dataRepasse, dataPagamentoCliente,
    receitaId, repasseId, observacoes: e.observacoes?.trim() || null,
  });

  await repo.encerrarCaso({ caseId: caso.id, valorObtido: divisao.valorSacado, data: dataSaque });
  await repo.registrarLinhaDoTempo({
    clientId: caso.client_id, caseId: caso.id, userId: e.userId,
    descricao: `Caso finalizado (RPV de R$ ${brl(divisao.valorSacado)}): repasse à ${parceiro} R$ ${brl(divisao.valorRepasse)} `
      + `(cliente R$ ${brl(divisao.valorCliente)} + parceria R$ ${brl(divisao.valorParceira)}) · nosso caixa R$ ${brl(divisao.valorEscritorio)}.`,
  });

  return { id, divisao, honorariosPercentual, parceiraPercentual, dataSaque, dataRepasse };
}
