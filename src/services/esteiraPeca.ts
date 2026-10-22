import { calcularPeca, brl, type CalculoPeca } from './pecaCalculos';
import { casosCorrelatos, mesmaParte, type CasoParaJuntar, type Parte } from './pecaConsolidacao';
import {
  montarFontes, promptFichaDeFatos, parseFichaDeFatos, fichaVazia, promptEscolhaModelo, parseEscolha, resumoDaFicha,
  montarPromptRedacao, conferirValores, relatorioDossie,
  type Fonte, type FichaDeFatos, type Escolha, type ItemCatalogo,
} from './pecaDossie';

/**
 * Esteira da petição inicial — cada agente faz a sua parte, nesta ordem:
 *  1. junta os casos do mesmo cliente contra a mesma parte contrária (uma peça só);
 *  2. Dra. Helena lê todas as fontes e monta a ficha de fatos (com a fonte de cada dado);
 *  3. o sistema calcula (indébito simples/dobro, juros, valor da causa) — em código;
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
  };

function juntarPartes(casos: CasoEsteira[]): Parte[] {
  const out: Parte[] = [];
  for (const p of casos.flatMap((c) => c.partes)) if (!out.some((q) => mesmaParte(p, q))) out.push(p);
  return out;
}

export async function produzirPeticao(caseId: number, deps: DepsEsteira): Promise<ResultadoEsteira> {
  const caso = await deps.caso(caseId);
  const juntos = casosCorrelatos(caso, await deps.candidatosCorrelatos(caso).catch(() => []));
  const casos = [caso, ...(await Promise.all(juntos.map((c) => deps.caso(c.id))))];
  const rotulos = casos.map((c) => `Caso #${c.id}: ${c.titulo || 'sem título'}`);
  const relato = casos.map((c) => c.relato).filter((r) => r && r.trim()).join('\n\n');

  // 2) Dra. Helena: lê tudo e monta a ficha de fatos.
  const fontes = montarFontes(await deps.fontes(casos.map((c) => c.id), caso).catch(() => []));
  const rFicha = fontes.lidas.length
    ? await deps.ia(promptFichaDeFatos({ area: caso.legal_area, cliente: caso.cliente, casos: rotulos }, fontes.texto), 'leitura').catch((e) => ({ ok: false, message: e?.message }))
    : { ok: false, message: 'nenhuma fonte com texto' };
  const ficha = rFicha.ok && 'text' in rFicha && rFicha.text
    ? parseFichaDeFatos(rFicha.text)
    : fichaVazia(`A leitura dos documentos pela IA falhou (${rFicha.message || 'sem resposta'}): a ficha de fatos ficou vazia. Conferir os documentos à mão.`);

  // 3) Cálculos em código.
  const calculo = calcularPeca({ contratos: ficha.contratos, descontos: ficha.descontos, hoje: deps.hoje?.() });
  deps.registrar('analista', `leu ${fontes.lidas.length} fonte(s) de ${caso.cliente} para a petição inicial: ${ficha.contratos.length} contrato(s), ${ficha.descontos.length} desconto(s)${calculo.indebito.total.restituir ? `, ${brl(calculo.indebito.total.restituir)} a restituir` : ''}`);

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
    ficha, calculo, fontesTexto: fontes.texto, escolha, modelos, teses, fundamentos, relato, regras,
  });
  const out = await deps.ia(prompt, 'redacao').catch((e) => ({ ok: false, message: e?.message, text: undefined }));
  if (!out.ok || !out.text) return { ok: false, message: out.message || 'A IA não devolveu a petição' };
  deps.registrar('estagiario', `redigiu a petição inicial de ${caso.cliente}${casos.length > 1 ? ` reunindo ${casos.length} casos contra a mesma parte` : ''}`);

  const conferencia = conferirValores(out.text, calculo);
  const lista = casos.map((c) => ({ id: c.id, titulo: c.titulo }));
  return {
    ok: true, peticao: out.text, cliente: caso.cliente, casos: lista, fontesLidas: fontes.lidas, ficha, calculo, escolha, conferencia,
    dossie: relatorioDossie({ cliente: caso.cliente, casos: lista, lidas: fontes.lidas, semTexto: fontes.semTexto, ficha, calculo, escolha, conferencia }),
  };
}
