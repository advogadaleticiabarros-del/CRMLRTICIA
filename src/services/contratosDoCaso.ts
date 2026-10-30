import { normalizarNomeParte, familiaDaTese, NOME_FAMILIA, type Familia, type Parte } from './pecaConsolidacao';
import type { ContratoFicha } from './pecaDossie';

/**
 * Quais contratos lidos nos documentos entram numa peça (regra da Jessica, 28/10/2026).
 * O extrato do INSS traz TODOS os contratos do cliente, de todos os bancos. A peça
 * só pode falar dos contratos do réu e da tese do processo:
 *  - a Dra. decidiu (cliente_contratos: caso escolhido ou "fora") → vale a decisão dela;
 *  - senão, entra só o que é do mesmo banco do réu E da mesma família de tese;
 *  - sem banco no documento, fica fora até a Dra. decidir.
 * Os descontos seguem os contratos: desconto de contrato que ficou fora sai do cálculo.
 */

export interface ContratoSalvo { id: number; chave: string; case_id: number | null; fora: boolean; dados: ContratoFicha }
export interface PecaAlvo { casos: Array<{ id: number; titulo: string | null }>; reus: Parte[] }
export interface DescontoLido { competencia: string; valor: number; contrato?: string | null; banco?: string | null; fonte?: string | null }
export interface Situacao { entra: boolean; origem: 'dra' | 'automatica'; motivo: string }

/** Palavras que não identificam o banco (além das que normalizarNomeParte já tira). */
const GENERICO = new Set(['financeira', 'credito', 'financiamento', 'financiamentos', 'investimento', 'investimentos', 'consignado', 'consignados', 'sociedade', 'instituicao']);

/** O que identifica o banco: o 1º nome que sobra ("Itaú Consignado S.A." → "itau"). */
export function nucleoBanco(nome: string | null | undefined): string {
  const tokens = normalizarNomeParte(nome).split(' ').filter(Boolean);
  const proprios = tokens.filter((t) => !GENERICO.has(t));
  return (proprios[0] || tokens[0] || '');
}

export function mesmoBanco(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = nucleoBanco(a), nb = nucleoBanco(b);
  return na.length >= 2 && na === nb;
}

const numeroLimpo = (n: string | null | undefined) => String(n || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^0+(?=.)/, '');

/** Identidade do contrato: o número (sem pontuação e zeros à esquerda) ou banco + tipo + data. */
export function chaveContrato(c: Pick<ContratoFicha, 'numero' | 'tipo' | 'banco' | 'data'>): string {
  const n = numeroLimpo(c.numero);
  if (n) return `n:${n}`;
  return `s:${nucleoBanco(c.banco)}|${String(c.tipo || '').toLowerCase()}|${String(c.data || '').trim()}`;
}

export function familiaDoContrato(tipo: string | null | undefined): Familia | null {
  const t = String(tipo || '').toLowerCase().trim();
  if (/^(rmc|rcc|cartao_consignado)$/.test(t)) return 'cartao_consignado';
  if (/^(emprestimo_consignado|refinanciamento|portabilidade)$/.test(t)) return 'emprestimo_consignado';
  if (t === 'emprestimo_pessoal') return 'emprestimo_pessoal';
  if (t === 'cartao_comum') return 'cartao_comum';
  return t && t !== 'outro' ? familiaDaTese(t) : null;
}

const NOME_TIPO: Record<string, string> = {
  rmc: 'Cartão RMC', rcc: 'Cartão RCC', emprestimo_consignado: 'Empréstimo consignado', refinanciamento: 'Refinanciamento',
  portabilidade: 'Portabilidade', emprestimo_pessoal: 'Empréstimo pessoal', cartao_comum: 'Cartão de crédito comum',
};
export const nomeDoTipo = (tipo: string | null | undefined) => NOME_TIPO[String(tipo || '').toLowerCase()] || 'Tipo não identificado';

const familiasDaPeca = (p: PecaAlvo) => [...new Set(p.casos.map((c) => familiaDaTese(c.titulo)).filter((f): f is Familia => !!f))];

export function situacaoNaPeca(c: ContratoFicha, salvo: ContratoSalvo | null | undefined, peca: PecaAlvo): Situacao {
  if (salvo?.fora) return { entra: false, origem: 'dra', motivo: 'a Dra. tirou este contrato das peças' };
  if (salvo?.case_id != null) {
    const outroBanco = peca.reus.length > 0 && !peca.reus.some((r) => mesmoBanco(c.banco, r.nome));
    return peca.casos.some((x) => x.id === salvo.case_id)
      ? { entra: true, origem: 'dra', motivo: `a Dra. pôs nesta peça${outroBanco ? ' (banco diferente do réu: conferir o polo passivo)' : ''}` }
      : { entra: false, origem: 'dra', motivo: `a Dra. associou ao caso #${salvo.case_id}` };
  }
  if (!peca.reus.length) return { entra: true, origem: 'automatica', motivo: 'o caso não tem parte contrária cadastrada' };
  if (!c.banco) return { entra: false, origem: 'automatica', motivo: 'o banco não aparece no documento: decidir à mão' };
  if (!peca.reus.some((r) => mesmoBanco(c.banco, r.nome))) return { entra: false, origem: 'automatica', motivo: `outro banco (${c.banco}): não é o réu deste processo` };
  const f = familiaDoContrato(c.tipo), familias = familiasDaPeca(peca);
  if (f && familias.length && !familias.includes(f)) return { entra: false, origem: 'automatica', motivo: `outra tese, ${NOME_FAMILIA[f]}: vai em processo separado` };
  return { entra: true, origem: 'automatica', motivo: 'mesmo banco e mesma tese do processo' };
}

const nomesReus = (p: PecaAlvo) => p.reus.map((r) => r.nome).filter(Boolean).join(', ');

export function separarParaPeca<D extends DescontoLido>(e: { contratos: ContratoFicha[]; descontos: D[]; salvos: ContratoSalvo[]; peca: PecaAlvo }) {
  const porChave = new Map(e.salvos.map((s) => [s.chave, s]));
  const vistos = new Set<string>();
  const lidos: Array<{ c: ContratoFicha; chave: string }> = [];
  for (const c of e.contratos) { const k = chaveContrato(c); if (!vistos.has(k)) { vistos.add(k); lidos.push({ c, chave: k }); } }
  // O que a Dra. pôs nesta peça entra mesmo se a leitura de agora não achou.
  for (const s of e.salvos) if (!vistos.has(s.chave) && s.case_id != null && !s.fora && e.peca.casos.some((x) => x.id === s.case_id)) { vistos.add(s.chave); lidos.push({ c: s.dados, chave: s.chave }); }

  const entram: ContratoFicha[] = [], fora: Array<{ contrato: ContratoFicha; motivo: string }> = [], avisos: string[] = [];
  const chavesEntram = new Set<string>(), chavesFora = new Set<string>();
  for (const { c, chave } of lidos) {
    const s = situacaoNaPeca(c, porChave.get(chave), e.peca);
    if (s.entra) {
      entram.push(c); chavesEntram.add(chave);
      if (s.origem === 'dra' && e.peca.reus.length && !e.peca.reus.some((r) => mesmoBanco(c.banco, r.nome))) {
        avisos.push(`O contrato ${c.numero || 's/nº'} (${c.banco || 'banco não identificado'}) foi escolhido pela Dra., mas o banco não é o réu cadastrado (${nomesReus(e.peca)}). Conferir o polo passivo.`);
      }
    } else { fora.push({ contrato: c, motivo: s.motivo }); chavesFora.add(chave); }
  }
  if (!e.peca.reus.length && lidos.length) avisos.push('O caso não tem parte contrária cadastrada: entraram todos os contratos lidos. Cadastrar o réu e conferir.');
  if (e.peca.reus.length && lidos.length && !entram.length) {
    avisos.push(`Nenhum contrato de ${nomesReus(e.peca)} aparece nos documentos lidos (só de outros bancos ou de outra tese). Conferir o réu e os documentos antes de protocolar.`);
  }

  let semDono = 0;
  const descontos = e.descontos.filter((d) => {
    const k = numeroLimpo(d.contrato) ? `n:${numeroLimpo(d.contrato)}` : '';
    if (k && chavesEntram.has(k)) return true;
    if (k && chavesFora.has(k)) return false;
    if (d.banco) return !e.peca.reus.length || e.peca.reus.some((r) => mesmoBanco(d.banco, r.nome));
    if (!fora.length) return true;
    semDono++; return false;
  });
  if (semDono) avisos.push(`${semDono} desconto(s) sem contrato nem banco no extrato ficaram fora do cálculo (há contratos de outros bancos ou teses no extrato). Conferir à mão.`);
  return { entram, fora, descontos, avisos };
}

// ── o que a tela mostra ──────────────────────────────────────────────────────

export interface LinhaInventario extends Situacao {
  id: number; chave: string; numero: string | null; tipo: string | null; nomeTipo: string; banco: string | null;
  data: string | null; parcela: number | null; valor_liberado: number | null; situacao: string | null; fonte: string | null;
  case_id: number | null; fora: boolean;
}

/** Contratos do cliente agrupados por banco, com o que entra nesta peça e por quê. Bancos do réu primeiro. */
export function inventarioDaPeca(salvos: ContratoSalvo[], peca: PecaAlvo) {
  const grupos: Array<{ chave: string; banco: string; doReu: boolean; contratos: LinhaInventario[] }> = [];
  for (const s of salvos) {
    const c = s.dados, sit = situacaoNaPeca(c, s, peca);
    const k = nucleoBanco(c.banco) || '?';
    let g = grupos.find((x) => x.chave === k);
    if (!g) { g = { chave: k, banco: c.banco || 'Banco não identificado', doReu: !!c.banco && peca.reus.some((r) => mesmoBanco(c.banco, r.nome)), contratos: [] }; grupos.push(g); }
    g.contratos.push({
      ...sit, id: s.id, chave: s.chave, numero: c.numero, tipo: c.tipo, nomeTipo: nomeDoTipo(c.tipo), banco: c.banco, data: c.data,
      parcela: c.parcela, valor_liberado: c.valor_liberado, situacao: c.situacao, fonte: c.fonte, case_id: s.case_id, fora: s.fora,
    });
  }
  grupos.sort((a, b) => Number(b.doReu) - Number(a.doReu));
  const linhas = grupos.flatMap((g) => g.contratos);
  return { grupos, total: linhas.length, entram: linhas.filter((l) => l.entra).length, reus: peca.reus.map((r) => r.nome || '').filter(Boolean) };
}

// ── conferência: uma peça por banco ──────────────────────────────────────────

export type TipoProblema = 'falta_acao' | 'bancos_misturados' | 'acao_sem_contrato' | 'banco_nao_identificado' | 'mesmo_banco_separado' | 'nao_lidos';
export interface ProblemaConferencia { tipo: TipoProblema; texto: string; acaoId?: number; banco?: string }
export interface AcaoParaConferir { id: number; titulo: string | null; reus: Parte[] }
export interface ConferenciaPecas {
  /** Há cartão consignado (RMC/RCC) lido nos extratos. */
  lidos: boolean;
  /** Uma linha por banco = uma peça: os cartões daquele banco e as ações que cuidam deles. */
  bancos: Array<{ banco: string; tipos: string[]; contratos: Array<{ numero: string | null; nomeTipo: string }>; acoes: number[] }>;
  problemas: ProblemaConferencia[];
}

const listaNumeros = (cs: ContratoFicha[]) => cs.map((c) => `${nomeDoTipo(c.tipo)} nº ${c.numero || 's/nº'}`).join(', ');

/**
 * Regra da Jessica (30/10/2026): RMC e RCC de bancos diferentes são peças diferentes
 * (RMC de um banco e RCC de outro → duas peças); do mesmo banco podem ir juntas.
 * Confere os cartões consignados lidos nos extratos (cliente_contratos) contra as ações
 * do cliente: banco sem ação, ação com dois bancos, contrato posto na ação de outro banco,
 * ação cujo banco não aparece no extrato e duas ações do mesmo banco (podem juntar).
 * Contrato que a Dra. tirou das peças (fora) não conta. Só avisa; quem decide é a Dra.
 */
export function conferirPecasPorBanco(contratos: ContratoSalvo[], acoes: AcaoParaConferir[]): ConferenciaPecas {
  const problemas: ProblemaConferencia[] = [];
  const cartoes = contratos.filter((s) => !s.fora && familiaDoContrato(s.dados.tipo) === 'cartao_consignado');
  // Ação que pode cuidar de cartão: tese de cartão consignado ou tese não escrita no título.
  const deCartao = acoes.filter((a) => { const f = familiaDaTese(a.titulo); return f === 'cartao_consignado' || f == null; });
  const tese = (a: AcaoParaConferir) => familiaDaTese(a.titulo) === 'cartao_consignado';
  const nomeAcao = (a: AcaoParaConferir) => `a ação #${a.id}${a.reus[0]?.nome ? ` (${a.reus[0].nome})` : ''}`;

  if (!cartoes.length) {
    if (acoes.some(tese)) problemas.push({ tipo: 'nao_lidos', texto: 'Nenhum cartão RMC/RCC lido nos extratos ainda: a conferência de uma peça por banco sai quando a equipe gerar a peça (leitura do extrato de empréstimos do INSS).' });
    return { lidos: false, bancos: [], problemas };
  }

  // Ação contra dois bancos: peças diferentes.
  for (const a of deCartao) {
    const nucleos = [...new Set(a.reus.map((r) => nucleoBanco(r.nome)).filter((n) => n.length >= 2))];
    if (nucleos.length > 1) problemas.push({ tipo: 'bancos_misturados', acaoId: a.id, texto: `A ação #${a.id} está contra bancos diferentes (${a.reus.map((r) => r.nome).filter(Boolean).join(' e ')}): cada banco é uma peça. Separar.` });
  }

  const grupos = new Map<string, { banco: string; contratos: ContratoSalvo[] }>();
  const semBanco: ContratoFicha[] = [];
  for (const s of cartoes) {
    const k = nucleoBanco(s.dados.banco);
    if (!s.dados.banco || k.length < 2) { semBanco.push(s.dados); continue; }
    if (!grupos.has(k)) grupos.set(k, { banco: s.dados.banco, contratos: [] });
    grupos.get(k)!.contratos.push(s);
  }
  if (semBanco.length) problemas.push({ tipo: 'banco_nao_identificado', texto: `${listaNumeros(semBanco)}: o banco não aparece no documento lido. Conferir no extrato de empréstimos do INSS para saber em qual peça entra.` });

  const bancos: ConferenciaPecas['bancos'] = [];
  for (const g of grupos.values()) {
    const fichas = g.contratos.map((s) => s.dados);
    const doBanco = deCartao.filter((a) => a.reus.some((r) => mesmoBanco(r.nome, g.banco)));
    // Contrato posto pela Dra. numa ação de outro banco.
    for (const s of g.contratos) {
      const a = s.case_id != null ? acoes.find((x) => x.id === s.case_id) : null;
      if (a && a.reus.length && !a.reus.some((r) => mesmoBanco(r.nome, g.banco))) {
        problemas.push({ tipo: 'bancos_misturados', acaoId: a.id, banco: g.banco, texto: `${nomeDoTipo(s.dados.tipo)} nº ${s.dados.numero || 's/nº'} é do ${g.banco}, mas está em ${nomeAcao(a)}: banco diferente, peça diferente.` });
      }
    }
    if (!doBanco.length) {
      problemas.push({ tipo: 'falta_acao', banco: g.banco, texto: `${listaNumeros(fichas)} do ${g.banco}: não há ação contra este banco. Precisa de uma peça própria (ou tirar o contrato das peças na mesa, se não for contestado).` });
    } else if (doBanco.length > 1) {
      problemas.push({ tipo: 'mesmo_banco_separado', banco: g.banco, texto: `${doBanco.length} ações contra o ${g.banco} (${doBanco.map((a) => `#${a.id}`).join(', ')}): RMC e RCC do mesmo banco podem ir numa peça só ("Ver e juntar" no quadro).` });
    }
    bancos.push({
      banco: g.banco, tipos: [...new Set(fichas.map((c) => nomeDoTipo(c.tipo)))],
      contratos: fichas.map((c) => ({ numero: c.numero, nomeTipo: nomeDoTipo(c.tipo) })), acoes: doBanco.map((a) => a.id),
    });
  }

  // Ação de cartão cujo banco não aparece nos cartões lidos.
  for (const a of acoes.filter(tese)) {
    if (!a.reus.length || a.reus.some((r) => [...grupos.values()].some((g) => mesmoBanco(r.nome, g.banco)))) continue;
    problemas.push({ tipo: 'acao_sem_contrato', acaoId: a.id, texto: `${nomeAcao(a)}: o extrato não mostra cartão RMC/RCC deste banco. Conferir o extrato ou o réu da ação.` });
  }
  return { lidos: true, bancos, problemas };
}
