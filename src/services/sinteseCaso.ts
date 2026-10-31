import { mesmoBanco, nomeDoTipo, type ContratoSalvo } from './contratosDoCaso';
import { apurarFicha } from './contabilista';
import type { FichaDeFatos } from './pecaDossie';
import type { Familia } from './pecaConsolidacao';

/**
 * "Sobre o caso" do card do cliente (31/10/2026). Print da Jessica: o bloco mostrava a
 * descrição da ação do Itaú ("Descontos indevidos... pelo Banco Itaú S.A.") como se fosse o
 * caso, que tem 6 bancos. "Busque contexto... aja como um desenvolvedor com base em
 * advocacia profissional."
 *
 * A síntese é do CLIENTE inteiro e sai só do que foi LIDO nos documentos: os contratos do
 * extrato de empréstimos do INSS (`cliente_contratos`), os descontos do histórico de
 * créditos ligados a cada contrato pelo Calculista (`apurarFicha`), a triagem, os fatos
 * datados, os pedidos e as lacunas da ficha de fatos (leitura única), e o relato que o
 * cliente deu no atendimento. Sem IA e sem completar nada: o que não foi lido aparece como
 * "ainda não lido". A descrição de cada ação (gerada a partir do e-mail do parceiro, uma por
 * banco) nunca é usada como relato do caso.
 *
 * Regras puras; banco em sinteseCasoMysql.ts; testes em tests/sinteseCaso.test.mjs.
 */

export interface AcaoParaSintese { id: number; reu: string | null; titulo: string | null; familia: Familia | null; situacao: string }

export interface EntradaSintese {
  cliente: string;
  acoes: AcaoParaSintese[];
  contratos: ContratoSalvo[];
  ficha: FichaDeFatos | null;
  relatoCliente: string | null;
  origem: { parceiro: string | null; chegouEm: string | null } | null;
  hoje?: Date;
}

export interface ContratoNaSintese {
  numero: string | null; tipo: string; inclusao: string | null; parcela: number | null; nParcelas: number | null;
  inicio: string | null; fim: string | null; situacao: string | null;
}

export interface Instituicao {
  banco: string;
  /** Ações (casos) contra esta instituição. Vazio = contrato lido sem ação. */
  acoes: number[];
  contratos: ContratoNaSintese[];
  /** Descontos lidos nos extratos do benefício (os estimados pela parcela ficam à parte). */
  descontos: { meses: number; de: string; ate: string; total: number; estimados: number } | null;
}

export interface SinteseCaso {
  paragrafo: string;
  relatoCliente: string | null;
  instituicoes: Instituicao[];
  /** Contratos lidos que a Dra. tirou das peças. */
  foraDasPecas: number;
  pontos: string[];
  fatos: Array<{ data: string | null; texto: string }>;
  pedidos: string[];
  lacunas: string[];
  alertas: string[];
  /** 'lida': há contratos lidos do extrato de empréstimos; 'nao_lida': ainda não. */
  base: 'lida' | 'nao_lida';
}

const CONSIGNADO_TIPOS = new Set(['emprestimo_consignado', 'refinanciamento', 'portabilidade', 'rmc', 'rcc']);
const PLURAL_TIPO: Record<string, [string, string]> = {
  emprestimo_consignado: ['empréstimo consignado', 'empréstimos consignados'], refinanciamento: ['refinanciamento', 'refinanciamentos'],
  portabilidade: ['portabilidade', 'portabilidades'], rmc: ['cartão RMC', 'cartões RMC'], rcc: ['cartão RCC', 'cartões RCC'],
  emprestimo_pessoal: ['empréstimo pessoal', 'empréstimos pessoais'], cartao_comum: ['cartão de crédito comum', 'cartões de crédito comuns'],
};

const listaPt = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`;
const limpo = (s: string | null | undefined) => String(s || '').replace(/\s+/g, ' ').trim();
const numLimpo = (n: string | null | undefined) => String(n || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^0+(?=.)/, '');

/** "mm/aaaa" ou "aaaa-mm" → "aaaa-mm" (para ordenar). */
function competencia(c: string | null | undefined): string | null {
  const s = String(c || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{4})$/);
  return m ? `${m[2]}-${m[1].padStart(2, '0')}` : null;
}
const mesBr = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** "dd/mm/aaaa" → "aaaa-mm-dd" (para ordenar); sem data vai para o fim. */
const dataOrdem = (d: string | null) => { const m = String(d || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '9999'; };
const dataBr = (iso: string | null) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : null; };

/** Triagem da ficha em português, na ordem em que o advogado olha. Só o que as fontes disseram. */
const TRIAGEM: Array<[string, string, string]> = [
  ['nunca_contratou', 'Diz que nunca contratou', 'Admite ter contratado'],
  ['pediu_emprestimo', 'Diz que pediu empréstimo', 'Diz que não pediu empréstimo'],
  ['recebeu_cartao', 'Recebeu o cartão', 'Diz que não recebeu o cartão'],
  ['usou_cartao', 'Usou o cartão', 'Diz que nunca usou o cartão'],
  ['houve_saque', 'Houve saque (dinheiro liberado na conta)', 'Diz que não houve saque'],
  ['assinou_termo', 'Assinou termo de adesão', 'Diz que não assinou termo'],
  ['idoso', 'É idoso(a)', ''],
  ['negativado', 'Está negativado(a)', ''],
];

export function sintetizarCaso(e: EntradaSintese): SinteseCaso {
  const abertas = e.acoes.filter((a) => a.situacao !== 'recusada');
  const validos = e.contratos.filter((c) => !c.fora);
  const base: SinteseCaso['base'] = validos.length ? 'lida' : 'nao_lida';

  // Instituições: primeiro as das ações (na ordem do card), depois os bancos que só aparecem nos contratos.
  const insts: Array<Instituicao & { numeros: Set<string> }> = [];
  const achar = (banco: string | null | undefined) => insts.find((i) => mesmoBanco(i.banco, banco));
  for (const a of abertas) {
    const nome = a.reu || a.titulo || `caso #${a.id}`;
    const i = achar(nome);
    if (i) i.acoes.push(a.id); else insts.push({ banco: nome, acoes: [a.id], contratos: [], descontos: null, numeros: new Set() });
  }
  for (const c of validos) {
    const d = c.dados;
    let i = achar(d.banco);
    if (!i) { i = { banco: limpo(d.banco) || 'Banco não identificado', acoes: [], contratos: [], descontos: null, numeros: new Set() }; insts.push(i); }
    i.contratos.push({
      numero: d.numero || null, tipo: nomeDoTipo(d.tipo), inclusao: d.data || null, parcela: d.parcela ?? null, nParcelas: d.n_parcelas ?? null,
      inicio: d.inicio_desconto || null, fim: d.fim_desconto || null, situacao: d.situacao || null,
    });
    if (d.numero) i.numeros.add(numLimpo(d.numero));
  }

  // Descontos: o Calculista liga cada desconto do histórico de créditos ao contrato (e ao banco).
  if (e.ficha?.descontos?.length) {
    // Meses em "aaaa-mm", como a leitura grava (parseFichaDeFatos); aceita "mm/aaaa" também.
    const fichaNorm: FichaDeFatos = {
      ...e.ficha,
      contratos: e.ficha.contratos?.length ? e.ficha.contratos : validos.map((c) => c.dados),
      descontos: e.ficha.descontos.map((d) => ({ ...d, competencia: competencia(d.competencia) || d.competencia })),
      competencias_extrato: (e.ficha.competencias_extrato || []).map((c) => competencia(c) || c),
    };
    const apurada = apurarFicha(fichaNorm, e.hoje || new Date());
    const porInst = new Map<Instituicao, Array<{ comp: string; valor: number; estimado: boolean }>>();
    for (const d of apurada.descontos) {
      const comp = competencia(d.competencia);
      if (!comp) continue;
      const i = insts.find((x) => d.contrato && x.numeros.has(numLimpo(d.contrato))) || (d.banco ? achar(d.banco) : undefined);
      if (!i) continue;
      porInst.set(i, [...(porInst.get(i) || []), { comp, valor: Number(d.valor) || 0, estimado: d.origem === 'estimado' }]);
    }
    for (const [i, ds] of porInst) {
      const lidos = ds.filter((x) => !x.estimado);
      if (!lidos.length) continue;
      const meses = [...new Set(lidos.map((x) => x.comp))].sort();
      i.descontos = { meses: meses.length, de: mesBr(meses[0]), ate: mesBr(meses[meses.length - 1]),
        total: Math.round(lidos.reduce((s, x) => s + x.valor, 0) * 100) / 100, estimados: ds.length - lidos.length };
    }
  }

  const alertas: string[] = [];
  for (const i of insts) {
    if (!i.acoes.length) alertas.push(`${i.banco}: ${i.contratos.length} contrato(s) lido(s) no extrato e sem ação. Precisa de peça própria, ou a Dra. tira o contrato das peças na mesa.`);
    else if (base === 'lida' && !i.contratos.length) alertas.push(`${i.banco}: nenhum contrato deste banco no extrato de empréstimos lido. Conferir o réu da ação ou o extrato.`);
  }

  // Parágrafo de síntese.
  const consignado = validos.some((c) => CONSIGNADO_TIPOS.has(String(c.dados.tipo || ''))) || abertas.some((a) => a.familia === 'emprestimo_consignado' || a.familia === 'cartao_consignado');
  const partes: string[] = [];
  const qtdAcoes = `${abertas.length} ${abertas.length === 1 ? 'ação' : 'ações'}`;
  if (base === 'lida') {
    const porTipo = new Map<string, number>();
    for (const c of validos) { const t = String(c.dados.tipo || 'outro'); porTipo.set(t, (porTipo.get(t) || 0) + 1); }
    const tipos = [...porTipo.entries()].map(([t, n]) => `${n} ${(PLURAL_TIPO[t] || ['contrato de tipo não identificado', 'contratos de tipo não identificado'])[n === 1 ? 0 : 1]}`);
    const nInst = insts.filter((i) => i.contratos.length).length;
    partes.push(`${e.cliente} tem ${consignado ? 'descontos no benefício do INSS de ' : ''}${validos.length} ${validos.length === 1 ? 'contrato' : 'contratos'} com ${nInst} ${nInst === 1 ? 'instituição' : 'instituições'}, segundo o extrato de empréstimos lido: ${listaPt(tipos)}.`);
    const semAcao = insts.filter((i) => !i.acoes.length).length;
    partes.push(`São ${qtdAcoes} em preparo, uma por instituição${semAcao ? `; ${semAcao} ${semAcao === 1 ? 'instituição ainda não tem' : 'instituições ainda não têm'} ação` : ''}.`);
  } else {
    partes.push(`${e.cliente} tem ${qtdAcoes} em preparo${consignado ? ' por descontos no benefício do INSS' : ''}, contra ${listaPt(abertas.map((a) => a.reu || a.titulo || `caso #${a.id}`))}.`);
    partes.push('Os contratos do extrato de empréstimos do INSS ainda não foram lidos: use "Ler os contratos" na mesa de uma das ações para a síntese trazer cada contrato e os descontos.');
  }
  const chegou = dataBr(e.origem?.chegouEm || null);
  if (e.origem?.parceiro || chegou) partes.push(`O caso chegou${e.origem?.parceiro ? ` pela parceria ${e.origem.parceiro}` : ''}${chegou ? ` em ${chegou}` : ''}.`);

  const f = e.ficha;
  const pontos = f ? TRIAGEM.map(([k, sim, nao]) => f.triagem?.[k] === true ? sim : f.triagem?.[k] === false ? nao : '').filter(Boolean) : [];
  const fatos = f ? [...f.fatos].filter((x) => limpo(x.texto)).sort((a, b) => dataOrdem(a.data).localeCompare(dataOrdem(b.data))).slice(0, 10).map((x) => ({ data: x.data || null, texto: limpo(x.texto) })) : [];
  const unicos = (xs: string[] | undefined, max: number) => [...new Set((xs || []).map(limpo).filter(Boolean))].slice(0, max);

  return {
    paragrafo: partes.join(' '),
    relatoCliente: limpo(e.relatoCliente) || null,
    instituicoes: insts.map(({ numeros: _n, ...i }) => i),
    foraDasPecas: e.contratos.length - validos.length,
    pontos, fatos,
    pedidos: unicos(f?.pedidos_do_cliente, 8),
    lacunas: unicos(f?.lacunas, 8),
    alertas,
    base,
  };
}
