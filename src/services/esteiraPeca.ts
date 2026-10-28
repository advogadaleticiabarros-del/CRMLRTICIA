import { calcularPeca, brl, mesBr, type CalculoPeca } from './pecaCalculos';
import { atualizarCalculo } from './planilhaCalculos';
import type { IndicesMensais } from './indicesEconomicos';
import { mesmaParte, reusDoCaso, type CasoParaJuntar, type Parte } from './pecaConsolidacao';
import {
  montarFontes, promptFichaDeFatos, parseFichaDeFatos, fichaVazia, promptEscolhaModelo, parseEscolha, resumoDaFicha,
  montarPromptRedacao, conferirValores, relatorioDossie, promptContratos, parseListaContratos,
  type Fonte, type FichaDeFatos, type Escolha, type ItemCatalogo, type ContratoFicha,
} from './pecaDossie';
import { separarParaPeca, mesmoBanco, type ContratoSalvo, type PecaAlvo } from './contratosDoCaso';

/**
 * Esteira da petição inicial — cada agente faz a sua parte, nesta ordem:
 *  1. junta os pedidos que a Dra. confirmou como um processo só (mesmo réu e mesma família de tese);
 *  2. Dra. Helena lê todas as fontes e monta a ficha de fatos (com a fonte de cada dado);
 *     todos os contratos lidos ficam guardados no cliente, mas na peça só entram os do
 *     réu e da tese do processo, ou os que a Dra. escolheu (contratosDoCaso.ts);
 *  3. o sistema calcula (indébito simples/dobro, juros, valor da causa) — em código —
 *     e o Calculista atualiza cada desconto (correção + juros de mora) na planilha;
 *  4. Cérebro escolhe estratégia e modelos pelo guia "Como escolher" do cofre;
 *  5. Dra. Júlia separa os fundamentos verificados;
 *  6. o redator escreve com raciocínio alto, e a peça é conferida contra os cálculos.
 * Banco e IA entram por `DepsEsteira` (esteiraPecaMysql.ts); testes em tests/esteiraPeca.test.mjs.
 */

export interface CasoEsteira extends CasoParaJuntar {
  titulo: string | null; cliente: string; qualificacao: string; advogada: string; relato: string; phone: string | null;
}

export type NivelIa = 'leitura' | 'escolha' | 'redacao';

export interface DepsEsteira {
  caso(id: number): Promise<CasoEsteira>;
  candidatosCorrelatos(caso: CasoEsteira): Promise<CasoParaJuntar[]>;
  fontes(caseIds: number[], caso: CasoEsteira): Promise<Fonte[]>;
  catalogo(area: string | null): Promise<{ guia: string; itens: ItemCatalogo[] }>;
  modelos(titulos: string[]): Promise<Array<{ titulo: string; conteudo: string | null }>>;
  teses(titulos: string[]): Promise<Array<{ titulo: string; texto: string }>>;
  fundamentos(texto: string, area: string | null): Promise<string>;
  /** Regras aprendidas com as correções da Dra. (aprovadas para a área, ou só para estes casos). */
  regras(area: string | null, caseIds: number[]): Promise<string[]>;
  ia(prompt: string, nivel: NivelIa): Promise<{ ok: boolean; text?: string; message?: string }>;
  /** Contratos do cliente já lidos, com a decisão da Dra. (cliente_contratos). */
  contratosSalvos?(clientId: number): Promise<ContratoSalvo[]>;
  /** Guarda (ou atualiza) os contratos lidos, sem mexer na decisão da Dra. */
  guardarContratos?(clientId: number, contratos: ContratoFicha[]): Promise<void>;
  /** Índices do Bacen (INPC, IPCA, Selic) para a planilha de cálculos; sem eles a planilha sai nominal. */
  indices?(): Promise<{ indices: IndicesMensais; avisos: string[] } | null>;
  registrar(agente: string, texto: string): void;
  hoje?(): Date;
}

export type ResultadoEsteira =
  | { ok: false; message: string }
  | {
    ok: true; peticao: string; dossie: string; cliente: string;
    casos: Array<{ id: number; titulo: string | null }>; fontesLidas: string[];
    ficha: FichaDeFatos; calculo: CalculoPeca; escolha: Escolha;
    conferencia: ReturnType<typeof conferirValores>;
    fora: Array<{ contrato: ContratoFicha; motivo: string }>;
  };

function juntarPartes(casos: CasoEsteira[]): Parte[] {
  const out: Parte[] = [];
  for (const p of casos.flatMap((c) => c.partes)) if (!out.some((q) => mesmaParte(p, q))) out.push(p);
  return out;
}

/** O caso e os pedidos que a Dra. confirmou como UM processo com ele (cases.unido_ao_caso). */
async function casosDaPeca(caseId: number, deps: DepsEsteira): Promise<CasoEsteira[]> {
  const caso = await deps.caso(caseId);
  const juntos = (await deps.candidatosCorrelatos(caso).catch(() => [])).filter((c, i, l) => c.id !== caso.id && l.findIndex((x) => x.id === c.id) === i);
  return [caso, ...(await Promise.all(juntos.map((c) => deps.caso(c.id))))];
}

/** Os casos da peça e os réus deles (a parte contrária cadastrada ou, sem ela, o banco do título). */
export function pecaAlvo(casos: Array<Pick<CasoEsteira, 'id' | 'titulo' | 'partes'>>): PecaAlvo {
  const reus: Parte[] = [];
  for (const p of casos.flatMap((c) => reusDoCaso({ partes: c.partes, titulo: c.titulo }))) if (!reus.some((q) => mesmaParte(p, q))) reus.push(p);
  return { casos: casos.map((c) => ({ id: c.id, titulo: c.titulo })), reus };
}

/**
 * Só a leitura dos contratos (sem redigir): a Dra. Helena lista todos os contratos
 * das fontes, de qualquer banco, e eles ficam guardados no cliente para a Dra.
 * dizer em qual processo cada um entra.
 */
export async function levantarContratos(caseId: number, deps: DepsEsteira): Promise<{ ok: boolean; contratos?: number; fontes?: number; message?: string }> {
  const casos = await casosDaPeca(caseId, deps);
  const caso = casos[0];
  if (caso.client_id == null) return { ok: false, message: 'O caso não tem cliente cadastrado' };
  const fontes = montarFontes(await deps.fontes(casos.map((c) => c.id), caso).catch(() => []));
  if (!fontes.lidas.length) return { ok: false, message: 'Nenhum documento com texto para ler' };
  const r = await deps.ia(promptContratos({ cliente: caso.cliente }, fontes.texto), 'leitura').catch((e) => ({ ok: false, message: e?.message, text: undefined }));
  const contratos = r.ok && r.text ? parseListaContratos(r.text) : null;
  if (!contratos) return { ok: false, message: `A leitura dos contratos falhou (${r.message || 'resposta sem JSON'})` };
  await deps.guardarContratos?.(caso.client_id, contratos);
  deps.registrar('analista', `listou ${contratos.length} contrato(s) de ${caso.cliente} em ${fontes.lidas.length} fonte(s), para a Dra. associar aos processos`);
  return { ok: true, contratos: contratos.length, fontes: fontes.lidas.length };
}

export async function produzirPeticao(caseId: number, deps: DepsEsteira): Promise<ResultadoEsteira> {
  // Só junta o que a Dra. confirmou como UM processo (cases.unido_ao_caso).
  const casos = await casosDaPeca(caseId, deps);
  const caso = casos[0];
  const rotulos = casos.map((c) => `Caso #${c.id}: ${c.titulo || 'sem título'}`);
  const relato = casos.map((c) => c.relato).filter((r) => r && r.trim()).join('\n\n');

  // 2) Dra. Helena: lê tudo e monta a ficha de fatos.
  const fontes = montarFontes(await deps.fontes(casos.map((c) => c.id), caso).catch(() => []));
  const rFicha = fontes.lidas.length
    ? await deps.ia(promptFichaDeFatos({ area: caso.legal_area, cliente: caso.cliente, casos: rotulos }, fontes.texto), 'leitura').catch((e) => ({ ok: false, message: e?.message }))
    : { ok: false, message: 'nenhuma fonte com texto' };
  const lida = rFicha.ok && 'text' in rFicha && rFicha.text
    ? parseFichaDeFatos(rFicha.text)
    : fichaVazia(`A leitura dos documentos pela IA falhou (${rFicha.message || 'sem resposta'}): a ficha de fatos ficou vazia. Conferir os documentos à mão.`);

  // Todos os contratos lidos ficam no cliente; na peça, só os do réu e da tese (ou os que a Dra. escolheu).
  const alvo = pecaAlvo(casos);
  if (caso.client_id != null && lida.contratos.length) await deps.guardarContratos?.(caso.client_id, lida.contratos).catch(() => {});
  const salvos = caso.client_id != null ? (await deps.contratosSalvos?.(caso.client_id).catch(() => [])) ?? [] : [];
  const sep = separarParaPeca({ contratos: lida.contratos, descontos: lida.descontos, salvos, peca: alvo });
  const ficha: FichaDeFatos = {
    ...lida, contratos: sep.entram, descontos: sep.descontos, lacunas: [...lida.lacunas, ...sep.avisos],
    reus: alvo.reus.length ? lida.reus.filter((r) => alvo.reus.some((q) => mesmoBanco(r.nome, q.nome))) : lida.reus,
  };

  // 3) Cálculos em código; o Calculista atualiza cada desconto (planilha de cálculos).
  const hoje = deps.hoje?.() || new Date();
  let calculo = calcularPeca({ contratos: ficha.contratos, descontos: ficha.descontos, hoje });
  if (calculo.descontos.length && deps.indices) {
    const ind = await deps.indices().catch(() => null);
    calculo = atualizarCalculo(calculo, ind?.indices ?? null, hoje);
    if (ind?.avisos.length) calculo.avisos.push(...ind.avisos);
    const a = calculo.atualizacao;
    if (a) deps.registrar('calculista', `montou a planilha de cálculos de ${caso.cliente}: ${a.linhas.length} desconto(s), ${brl(a.total.total)} ${a.dataBase ? `atualizados até ${mesBr(a.dataBase)}` : 'sem atualização (Bacen indisponível)'}`);
  }
  deps.registrar('analista', `leu ${fontes.lidas.length} fonte(s) de ${caso.cliente} para a petição inicial: ${ficha.contratos.length} contrato(s) desta peça${sep.fora.length ? ` (${sep.fora.length} de outro banco/tese ficaram fora)` : ''}, ${ficha.descontos.length} desconto(s)${calculo.indebito.total.restituir ? `, ${brl(calculo.indebito.total.restituir)} a restituir` : ''}`);

  // 4) Cérebro: estratégia e modelos pelo guia do escritório.
  const cat = await deps.catalogo(caso.legal_area).catch(() => ({ guia: '', itens: [] as ItemCatalogo[] }));
  let escolha: Escolha = { estrategia: null, modelos: [], teses: [], motivo: null };
  if (cat.itens.length) {
    const r = await deps.ia(promptEscolhaModelo({ area: caso.legal_area, casos: rotulos, relato }, cat.guia, cat.itens, ficha), 'escolha').catch(() => null);
    if (r?.ok && r.text) escolha = parseEscolha(r.text, cat.itens);
  }
  const [modelos, teses] = await Promise.all([
    deps.modelos(escolha.modelos).catch(() => []),
    deps.teses(escolha.teses).catch(() => []),
  ]);
  deps.registrar('cerebro', escolha.modelos.length
    ? `escolheu ${escolha.modelos.join(' + ')} (${escolha.estrategia || 'estratégia'}) para a petição de ${caso.cliente}`
    : `não achou modelo no cofre para a petição de ${caso.cliente}`);

  // 5) Dra. Júlia: fundamentos que existem, com o texto oficial (ela registra a própria ação).
  const fundamentos = await deps.fundamentos(`${rotulos.join('\n')}\n${escolha.estrategia || ''}\n${resumoDaFicha(ficha)}\n${relato.slice(0, 2000)}`, caso.legal_area).catch(() => '');

  // 6) Redação com raciocínio alto, seguindo as regras aprendidas, e conferência dos valores.
  const partesContrarias = juntarPartes(casos);
  const regras = await deps.regras(caso.legal_area, casos.map((c) => c.id)).catch(() => []);
  const prompt = montarPromptRedacao({
    qualificacao: caso.qualificacao, area: caso.legal_area, advogada: caso.advogada,
    casos: casos.map((c) => ({ id: c.id, titulo: c.titulo })), partesContrarias,
    ficha, calculo, fontesTexto: fontes.texto, escolha, modelos, teses, fundamentos, relato, regras, fora: sep.fora,
  });
  const out = await deps.ia(prompt, 'redacao').catch((e) => ({ ok: false, message: e?.message, text: undefined }));
  if (!out.ok || !out.text) return { ok: false, message: out.message || 'A IA não devolveu a petição' };
  deps.registrar('estagiario', `redigiu a petição inicial de ${caso.cliente}${casos.length > 1 ? ` reunindo ${casos.length} casos contra a mesma parte` : ''}`);

  const conferencia = conferirValores(out.text, calculo);
  const lista = casos.map((c) => ({ id: c.id, titulo: c.titulo }));
  return {
    ok: true, peticao: out.text, cliente: caso.cliente, casos: lista, fontesLidas: fontes.lidas, ficha, calculo, escolha, conferencia, fora: sep.fora,
    dossie: relatorioDossie({ cliente: caso.cliente, casos: lista, lidas: fontes.lidas, semTexto: fontes.semTexto, ficha, calculo, escolha, conferencia, fora: sep.fora }),
  };
}
