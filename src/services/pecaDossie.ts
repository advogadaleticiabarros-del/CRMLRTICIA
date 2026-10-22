import { brl, type CalculoPeca } from './pecaCalculos';
import type { Parte } from './pecaConsolidacao';

/**
 * Regras puras da esteira da petição inicial: a ficha de fatos que a Dra. Helena
 * extrai das fontes, a escolha do modelo pelo Cérebro (guia "Como escolher" do
 * cofre), o prompt do redator, a conferência dos valores e o dossiê que fica no caso.
 */

export interface ComFonte { fonte: string | null }
export interface ContratoFicha extends ComFonte {
  numero: string | null; tipo: string | null; banco: string | null; data: string | null;
  valor_liberado: number | null; parcela: number | null; n_parcelas: number | null; parcelas_pagas: number | null;
  taxa_mensal: number | null; taxa_media_mercado: number | null;
  inicio_desconto: string | null; fim_desconto: string | null; situacao: string | null;
}
export interface FichaDeFatos {
  reus: Array<{ nome: string; cnpj: string | null; endereco: string | null } & ComFonte>;
  contratos: ContratoFicha[];
  descontos: Array<{ competencia: string; valor: number; contrato: string | null } & ComFonte>;
  fatos: Array<{ data: string | null; texto: string } & ComFonte>;
  valores: Array<{ descricao: string; valor: number | null; data: string | null } & ComFonte>;
  vinculo: Record<string, string | null> | null;
  triagem: Record<string, boolean | null>;
  pedidos_do_cliente: string[];
  lacunas: string[];
}

export interface Escolha { estrategia: string | null; modelos: string[]; teses: string[]; motivo: string | null }
export interface ItemCatalogo { titulo: string; resumo?: string | null }

// ── leitura de números ──────────────────────────────────────────────────────

export function valorNumero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = String(v ?? '').match(/-?\d[\d.,]*/);
  if (!m) return null;
  let t = m[0].replace(/[.,]+$/, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if ((t.match(/\./g) || []).length > 1 || /^-?\d{1,3}\.\d{3}$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export const taxaNumero = (v: unknown): number | null => (v == null || v === '' ? null : valorNumero(v));

const txt = (v: unknown, max = 500): string | null => {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim() : '';
  return s && !/^(null|n\/a|-|não informado|nao informado)$/i.test(s) ? s.slice(0, max) : null;
};
const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const inteiro = (v: unknown) => { const n = valorNumero(v); return n == null ? null : Math.round(n); };

/** "05/2020", "2020-05", "15/05/2020" → "2020-05". */
export function competencia(v: unknown): string | null {
  const t = String(v ?? '').trim();
  let m = t.match(/^(\d{1,2})\/(\d{4})$/); if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = t.match(/^\d{1,2}\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = t.match(/^(\d{4})-(\d{2})/); if (m) return `${m[1]}-${m[2]}`;
  return null;
}

function simNao(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  const t = String(v ?? '').trim().toLowerCase();
  if (/^(sim|s|true|yes)$/.test(t)) return true;
  if (/^(n[aã]o|n|false|no)$/.test(t)) return false;
  return null;
}

function extrairJson(texto: string): any | null {
  const t = String(texto || '');
  const ini = t.indexOf('{'), fim = t.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return null;
  try { return JSON.parse(t.slice(ini, fim + 1)); } catch { return null; }
}

export function fichaVazia(lacuna?: string): FichaDeFatos {
  return { reus: [], contratos: [], descontos: [], fatos: [], valores: [], vinculo: null, triagem: {}, pedidos_do_cliente: [], lacunas: lacuna ? [lacuna] : [] };
}

export function parseFichaDeFatos(texto: string): FichaDeFatos {
  const o = extrairJson(texto);
  if (!o || typeof o !== 'object') return fichaVazia('A leitura dos documentos pela IA falhou: a ficha de fatos ficou vazia. Conferir os documentos à mão.');
  const f = fichaVazia();
  f.reus = lista(o.reus).map((r) => ({ nome: txt(r?.nome, 255) || '', cnpj: txt(r?.cnpj ?? r?.cpf_cnpj, 30), endereco: txt(r?.endereco), fonte: txt(r?.fonte, 255) })).filter((r) => r.nome);
  f.contratos = lista(o.contratos).map((c) => ({
    numero: txt(c?.numero, 80), tipo: txt(c?.tipo, 40)?.toLowerCase() || null, banco: txt(c?.banco, 255), data: txt(c?.data, 20),
    valor_liberado: valorNumero(c?.valor_liberado), parcela: valorNumero(c?.parcela), n_parcelas: inteiro(c?.n_parcelas), parcelas_pagas: inteiro(c?.parcelas_pagas),
    taxa_mensal: taxaNumero(c?.taxa_mensal), taxa_media_mercado: taxaNumero(c?.taxa_media_mercado),
    inicio_desconto: competencia(c?.inicio_desconto), fim_desconto: competencia(c?.fim_desconto), situacao: txt(c?.situacao, 60), fonte: txt(c?.fonte, 255),
  }));
  f.descontos = lista(o.descontos)
    .map((d) => ({ competencia: competencia(d?.competencia), valor: valorNumero(d?.valor), contrato: txt(d?.contrato, 80), fonte: txt(d?.fonte, 255) }))
    .filter((d): d is FichaDeFatos['descontos'][number] => !!d.competencia && d.valor != null && d.valor > 0);
  f.fatos = lista(o.fatos).map((x) => ({ data: txt(x?.data, 20), texto: txt(x?.texto, 1000) || '', fonte: txt(x?.fonte, 255) })).filter((x) => x.texto);
  f.valores = lista(o.valores).map((x) => ({ descricao: txt(x?.descricao, 255) || '', valor: valorNumero(x?.valor), data: txt(x?.data, 20), fonte: txt(x?.fonte, 255) })).filter((x) => x.descricao);
  if (o.vinculo && typeof o.vinculo === 'object') f.vinculo = Object.fromEntries(Object.entries(o.vinculo).map(([k, v]) => [k, txt(v, 255)]));
  if (o.triagem && typeof o.triagem === 'object') f.triagem = Object.fromEntries(Object.entries(o.triagem).map(([k, v]) => [k, simNao(v)]));
  f.pedidos_do_cliente = lista(o.pedidos_do_cliente).map((x) => txt(x, 300)).filter((x): x is string => !!x);
  f.lacunas = lista(o.lacunas).map((x) => txt(x, 300)).filter((x): x is string => !!x);
  return f;
}

// ── fontes ──────────────────────────────────────────────────────────────────

export interface Fonte { nome: string; texto: string }

/** Junta as fontes num texto só, cortando as grandes sem deixar nenhuma de fora. */
export function montarFontes(fontes: Fonte[], lim = { porFonte: 40000, total: 200000 }) {
  const lidas: string[] = [], semTexto: string[] = [];
  const blocos: string[] = [];
  const comTexto = fontes.filter((f) => { if (String(f.texto || '').trim()) return true; semTexto.push(f.nome); return false; });
  const cota = Math.min(lim.porFonte, Math.floor(lim.total / Math.max(1, comTexto.length)));
  for (const f of comTexto) {
    const t = String(f.texto).trim();
    blocos.push(`=== ${f.nome} ===\n${t.length > cota ? `${t.slice(0, cota)}\n[... trecho cortado: o documento tem ${t.length} caracteres]` : t}`);
    lidas.push(f.nome);
  }
  return { texto: blocos.join('\n\n'), lidas, semTexto };
}

// ── Dra. Helena: ficha de fatos ─────────────────────────────────────────────

export function promptFichaDeFatos(ctx: { area: string | null; cliente: string; casos: string[] }, fontesTexto: string): string {
  return `FICHA DE FATOS — você é a analista de documentos de um escritório de advocacia (área: ${ctx.area || 'não informada'}).
Leia TODAS as fontes abaixo (documentos, extratos, contratos, conversas de WhatsApp e relato) do(a) cliente ${ctx.cliente} e monte a ficha de fatos que vai embasar UMA petição inicial.
Pedidos/casos reunidos nesta peça:
${ctx.casos.map((c) => `- ${c}`).join('\n')}

Responda SOMENTE com JSON neste formato:
{"reus":[{"nome":"...","cnpj":"...","endereco":"...","fonte":"nome da fonte"}],
 "contratos":[{"numero":"...","tipo":"emprestimo|rmc|rcc|cartao|refinanciamento|portabilidade|outro","banco":"...","data":"dd/mm/aaaa","valor_liberado":0,"parcela":0,"n_parcelas":0,"parcelas_pagas":0,"taxa_mensal":0,"taxa_media_mercado":0,"inicio_desconto":"mm/aaaa","fim_desconto":"mm/aaaa","situacao":"ativo|excluido|encerrado","fonte":"..."}],
 "descontos":[{"competencia":"mm/aaaa","valor":0,"contrato":"nº do contrato","fonte":"..."}],
 "fatos":[{"data":"dd/mm/aaaa","texto":"fato objetivo","fonte":"..."}],
 "valores":[{"descricao":"...","valor":0,"data":"...","fonte":"..."}],
 "vinculo":{"empregador":"...","admissao":"...","demissao":"...","cargo":"...","salario":"...","jornada":"...","motivo_saida":"..."},
 "triagem":{"houve_saque":null,"recebeu_cartao":null,"usou_cartao":null,"assinou_termo":null,"pediu_emprestimo":null,"nunca_contratou":null,"idoso":null,"negativado":null},
 "pedidos_do_cliente":["o que o cliente quer, nas palavras dele"],
 "lacunas":["dado importante que NÃO está em nenhuma fonte"]}

Regras:
- NUNCA invente, deduza ou complete. Só o que está escrito nas fontes. Campo sem informação: null. Lista sem itens: [].
- TODO item leva "fonte" com o nome exato da fonte de onde saiu (o título depois de "===").
- "descontos": cada desconto mensal que aparece em extrato de pagamento do benefício, holerite ou fatura (um item por mês e por contrato). Não repita o mesmo mês do mesmo contrato.
- Extrato de empréstimos do INSS (HISCON): cada contrato com nº, banco, tipo (empréstimo, RMC = reserva de margem de cartão, RCC = reserva de cartão consignado de benefício), data de inclusão, valor liberado/emprestado, valor da parcela, quantidade de parcelas, início e fim do desconto e situação.
- Taxas em % ao mês, como número (2,14% a.m. → 2.14). "taxa_media_mercado" só se alguma fonte trouxer a taxa média do Bacen.
- "triagem": responda pelas fontes (conversa e relato contam). Ex.: cliente disse que nunca recebeu o cartão → "recebeu_cartao": false. Sem informação → null.
- "vinculo" só em caso trabalhista; senão null.
- Valores em número (R$ 1.234,56 → 1234.56).

FONTES:
${fontesTexto}`;
}

// ── Cérebro: escolha do modelo pelo guia do cofre ───────────────────────────

const norm = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function resumoDaFicha(f: FichaDeFatos): string {
  const linhas: string[] = [];
  if (f.reus.length) linhas.push(`Réus: ${f.reus.map((r) => r.nome).join('; ')}`);
  for (const c of f.contratos) linhas.push(`Contrato ${c.numero || 's/nº'} · ${c.tipo || 'tipo?'} · ${c.banco || ''}${c.valor_liberado ? ` · liberado ${brl(c.valor_liberado)}` : ''}${c.parcela ? ` · parcela ${brl(c.parcela)}` : ''}${c.taxa_mensal ? ` · ${c.taxa_mensal}% a.m.` : ''}${c.situacao ? ` · ${c.situacao}` : ''}`);
  const tri = Object.entries(f.triagem).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v ? 'sim' : 'não'}`);
  if (tri.length) linhas.push(`Triagem: ${tri.join(', ')}`);
  if (f.pedidos_do_cliente.length) linhas.push(`O cliente quer: ${f.pedidos_do_cliente.join('; ')}`);
  for (const x of f.fatos.slice(0, 15)) linhas.push(`Fato${x.data ? ` (${x.data})` : ''}: ${x.texto}`);
  return linhas.join('\n') || '[ficha de fatos vazia]';
}

export function promptEscolhaModelo(ctx: { area: string | null; casos: string[]; relato: string }, guia: string, itens: ItemCatalogo[], ficha: FichaDeFatos): string {
  return `ESCOLHA DO MODELO — você é o Cérebro, a biblioteca do escritório. Escolha, no cofre de peças do escritório, a estratégia e os modelos para a PETIÇÃO INICIAL deste caso, seguindo o guia do próprio escritório.

GUIA DO ESCRITÓRIO (como escolher):
${guia.slice(0, 12000) || '[sem guia para esta área: escolha pelo assunto]'}

CATÁLOGO DE PEÇAS DO COFRE (área ${ctx.area || '—'}):
${itens.slice(0, 250).map((i) => `- ${i.titulo}${i.resumo ? ` — ${String(i.resumo).replace(/\s+/g, ' ').slice(0, 220)}` : ''}`).join('\n')}

CASO (pedidos reunidos numa só peça):
${ctx.casos.map((c) => `- ${c}`).join('\n')}
${resumoDaFicha(ficha)}
Relato: ${ctx.relato.slice(0, 3000) || '—'}

Regras:
- Escolha de 1 a 2 modelos que sejam PETIÇÃO INICIAL (nunca réplica, agravo, contrarrazões ou roteiro), com o título EXATAMENTE como no catálogo.
- Siga o guia: a estratégia depende das respostas da triagem (ex.: sacou ou não o dinheiro, recebeu o cartão). Se a triagem não responde, diga isso no motivo e escolha a estratégia mais segura pelo guia.
- Se houver mais de um pedido contra o mesmo réu (ex.: RMC + RCC, empréstimo + juros), escolha modelos que, juntos, cubram todos.
- "teses": os títulos das notas de tese citadas no guia ou nos modelos que se aplicam a este caso.
Responda SOMENTE com JSON: {"estrategia":"...","modelos":["..."],"teses":["..."],"motivo":"por que, em 2 a 4 frases, citando o fato da ficha que decidiu"}`;
}

export function parseEscolha(texto: string, catalogo: ItemCatalogo[]): Escolha {
  const o = extrairJson(texto) || {};
  const porNome = new Map(catalogo.map((c) => [norm(c.titulo), c.titulo]));
  const modelos = [...new Set(lista(o.modelos).map((m) => porNome.get(norm(String(m)))).filter((m): m is string => !!m))].slice(0, 2);
  const teses = [...new Set(lista(o.teses).map((t) => txt(String(t).replace(/[[\]]/g, ''), 200)).filter((t): t is string => !!t))].slice(0, 8);
  return { estrategia: txt(o.estrategia, 200), modelos, teses, motivo: txt(o.motivo, 1500) };
}

// ── redator ─────────────────────────────────────────────────────────────────

export function blocoCalculos(c: CalculoPeca): string {
  const l: string[] = [];
  if (c.indebito.porContrato.length) {
    l.push('Repetição do indébito (modulação do STJ, EAREsp 600.663/RS: descontos até 03/2021 devolvidos de forma simples; de 04/2021 em diante, em dobro):');
    for (const p of c.indebito.porContrato) {
      l.push(`- Contrato ${p.contrato}: ${p.meses} desconto(s) de ${p.periodo}, total descontado ${brl(p.descontado)}; simples ${brl(p.simples.valor)} (${p.simples.meses} mês/meses); em dobro ${brl(p.dobro.restituir)} (${p.dobro.meses} mês/meses, pagos ${brl(p.dobro.pago)}); a restituir ${brl(p.restituir)}.`);
    }
    l.push(`- TOTAL descontado ${brl(c.indebito.total.descontado)} · TOTAL a restituir ${brl(c.indebito.total.restituir)}.`);
  }
  for (const j of c.juros) {
    l.push(`Juros do contrato ${j.contrato}: taxa contratada ${j.taxaContratadaMensal}% a.m. contra taxa média de ${j.taxaMediaMensal}% a.m. (${String(j.razao).replace('.', ',')} vezes a média). Parcela cobrada ${brl(j.parcelaContratada)}; parcela pela taxa média ${brl(j.parcelaRecalculada)}; diferença de ${brl(j.diferencaPorParcela)} por parcela; pago a mais em ${j.parcelasPagas} parcela(s): ${brl(j.pagoAMais)}.`);
  }
  const v = c.valorDaCausa;
  l.push(`VALOR DA CAUSA: ${brl(v.total)}${v.danoMoral == null ? ' + [valor do dano moral] (somar o dano moral pedido ao valor da causa)' : ''} = restituição ${brl(v.restituicao)}${v.jurosPagosAMais ? ` + juros pagos a mais ${brl(v.jurosPagosAMais)}` : ''}${v.danoMoral != null ? ` + dano moral ${brl(v.danoMoral)}` : ''}.`);
  return l.join('\n');
}

export interface DossieRedacao {
  qualificacao: string; area: string | null; advogada: string;
  casos: Array<{ id: number; titulo: string | null }>;
  partesContrarias: Parte[];
  ficha: FichaDeFatos; calculo: CalculoPeca; fontesTexto: string;
  escolha: Escolha; modelos: Array<{ titulo: string; conteudo: string | null }>; teses: Array<{ titulo: string; texto: string }>;
  fundamentos: string; relato: string;
  /** Regras aprendidas com as correções da Dra. */
  regras?: string[];
}

export function montarPromptRedacao(d: DossieRedacao): string {
  const varios = d.casos.length > 1;
  const json = (o: unknown) => JSON.stringify(o);
  return `Você é advogado(a) brasileiro(a), redator(a) de peças, minucioso(a). Redija uma PETIÇÃO INICIAL completa e profissional, pronta para a revisão final da advogada.

${varios ? `ATENÇÃO — PEDIDOS REUNIDOS: estes ${d.casos.length} casos são do mesmo cliente contra a mesma parte contrária. Redija UMA ÚNICA petição inicial que cubra TODOS os pedidos, com os fatos e os pedidos de cada um:\n${d.casos.map((c) => `- Caso #${c.id}: ${c.titulo || 'sem título'}`).join('\n')}\n` : `CASO #${d.casos[0]?.id}: ${d.casos[0]?.titulo || 'sem título'}\n`}
REGRAS ANTI-INVENÇÃO (obrigatórias):
- Use SOMENTE os fatos da FICHA DE FATOS, do relato e das fontes. Nada de inventar, deduzir ou "corrigir" dados.
- Nunca crie números (CPF, CNPJ, contrato, benefício, processo, datas, valores). O que faltar vai em [colchete indicando o dado a preencher].
- Dados da parte contrária só se constarem de documento ou do cadastro abaixo; o que vier só do relato vai como alegação, marcado "[a comprovar — não consta em documento]".
- Os CÁLCULOS abaixo foram feitos pelo sistema a partir dos documentos: use exatamente estes valores, sem recalcular nem arredondar, numa seção "DOS CÁLCULOS" e nos pedidos. Onde o cálculo indica [colchete], mantenha o colchete.
- Cite leis e súmulas só da lista de FUNDAMENTOS VERIFICADOS ou das teses do escritório; qualquer outra citação vai marcada [conferir].
- Siga a ESTRATÉGIA escolhida e use os MODELOS DO ESCRITÓRIO como referência de estrutura, teses e estilo — adapte aos fatos; nunca copie nomes, números ou valores do modelo.

${d.regras?.length ? `REGRAS DO ESCRITÓRIO (aprendidas com as correções da advogada; valem acima do modelo):\n${d.regras.map((r) => `- ${r}`).join('\n')}\n\n` : ''}Estrutura: endereçamento ao juízo competente; qualificação do autor; qualificação do(s) réu(s); DOS FATOS (cronológico, cada fato com a prova que o sustenta, ex.: "conforme extrato do INSS anexo"); DO DIREITO (teses do escritório e fundamentos verificados); DOS CÁLCULOS; DA TUTELA DE URGÊNCIA (se cabível pelos fatos); DOS PEDIDOS (com os valores calculados); DAS PROVAS; DO VALOR DA CAUSA; fecho. Português jurídico formal.

QUALIFICAÇÃO DO AUTOR (cadastro):
${d.qualificacao}
Área: ${d.area || '[área]'} · Advogada subscritora: ${d.advogada}

PARTE(S) CONTRÁRIA(S) (cadastro do caso):
${d.partesContrarias.length ? d.partesContrarias.map((p) => `- ${p.nome}${p.cpf_cnpj ? ` · CPF/CNPJ ${p.cpf_cnpj}` : ''}`).join('\n') : '- [não cadastrada: usar o que constar dos documentos]'}

ESTRATÉGIA (escolhida pelo Cérebro com o guia do escritório): ${d.escolha.estrategia || '[não definida]'}
Motivo: ${d.escolha.motivo || '—'}

FICHA DE FATOS (extraída das fontes pela analista; cada item com a fonte):
${json({ reus: d.ficha.reus, contratos: d.ficha.contratos, fatos: d.ficha.fatos, valores: d.ficha.valores, vinculo: d.ficha.vinculo, triagem: d.ficha.triagem, pedidos_do_cliente: d.ficha.pedidos_do_cliente })}
Lacunas (dados que não estão nas fontes — usar [colchete]): ${[...d.ficha.lacunas, ...d.calculo.avisos].join(' | ') || 'nenhuma'}

CÁLCULOS (feitos pelo sistema — use exatamente):
${blocoCalculos(d.calculo)}

RELATO DO CLIENTE:
${d.relato.slice(0, 8000) || '[sem relato cadastrado]'}
${d.modelos.map((m) => `\nMODELO DO ESCRITÓRIO — ${m.titulo}:\n${String(m.conteudo || '[modelo sem texto]').slice(0, 25000)}`).join('\n')}
${d.teses.map((t) => `\nTESE DO ESCRITÓRIO — ${t.titulo}:\n${t.texto.slice(0, 6000)}`).join('\n')}
${d.fundamentos}

TRECHOS DAS FONTES (para citar as provas):
${d.fontesTexto.slice(0, 60000)}`;
}

// ── conferência e dossiê ────────────────────────────────────────────────────

const semRS = (n: number) => brl(n).replace('R$ ', '');

export function conferirValores(peticao: string, c: CalculoPeca): Array<{ rotulo: string; valor: number; presente: boolean }> {
  const t = String(peticao || '');
  const itens: Array<{ rotulo: string; valor: number }> = [];
  if (c.indebito.total.restituir > 0) itens.push({ rotulo: 'Total a restituir', valor: c.indebito.total.restituir });
  if (c.valorDaCausa.jurosPagosAMais > 0) itens.push({ rotulo: 'Juros pagos a mais', valor: c.valorDaCausa.jurosPagosAMais });
  if (c.valorDaCausa.total > 0) itens.push({ rotulo: 'Valor da causa (calculado)', valor: c.valorDaCausa.total });
  return itens.map((i) => ({ ...i, presente: t.includes(semRS(i.valor)) }));
}

export function relatorioDossie(d: {
  cliente: string; casos: Array<{ id: number; titulo: string | null }>; lidas: string[]; semTexto: string[];
  ficha: FichaDeFatos; calculo: CalculoPeca; escolha: Escolha; conferencia: ReturnType<typeof conferirValores>;
}): string {
  const l: string[] = [`# Dossiê da peça — ${d.cliente}`, ''];
  l.push('Como a petição foi montada: o que os agentes leram, o que calcularam e por que escolheram o modelo.', '');
  l.push('## Casos nesta peça');
  for (const c of d.casos) l.push(`- #${c.id} — ${c.titulo || 'sem título'}`);
  if (d.casos.length > 1) l.push('', 'Mesmo cliente e mesma parte contrária: os pedidos foram reunidos numa única petição inicial.');
  l.push('', `## Fontes lidas pela Dra. Helena (${d.lidas.length})`);
  for (const f of d.lidas) l.push(`- ${f}`);
  if (d.semTexto.length) { l.push('', '**Não foi possível ler (conferir à mão):**'); for (const f of d.semTexto) l.push(`- ${f}`); }
  l.push('', '## Estratégia e modelo (Cérebro)');
  l.push(`- Estratégia: ${d.escolha.estrategia || 'não definida'}`);
  l.push(`- Modelos do cofre: ${d.escolha.modelos.join('; ') || 'nenhum encontrado'}`);
  if (d.escolha.teses.length) l.push(`- Teses: ${d.escolha.teses.join('; ')}`);
  if (d.escolha.motivo) l.push(`- Motivo: ${d.escolha.motivo}`);
  const f = d.ficha;
  l.push('', '## Ficha de fatos');
  for (const r of f.reus) l.push(`- Réu: ${r.nome}${r.cnpj ? ` · ${r.cnpj}` : ''} _(fonte: ${r.fonte || '—'})_`);
  if (f.contratos.length) {
    l.push('', '| Contrato | Tipo | Banco | Liberado | Parcela | Parcelas | Taxa a.m. | Fonte |', '|---|---|---|---|---|---|---|---|');
    for (const c of f.contratos) l.push(`| ${c.numero || '—'} | ${c.tipo || '—'} | ${c.banco || '—'} | ${c.valor_liberado != null ? brl(c.valor_liberado) : '—'} | ${c.parcela != null ? brl(c.parcela) : '—'} | ${c.n_parcelas ?? '—'} | ${c.taxa_mensal != null ? `${c.taxa_mensal}%` : '—'} | ${c.fonte || '—'} |`);
  }
  if (f.descontos.length) l.push('', `Descontos lidos nos extratos: ${f.descontos.length}.`);
  for (const x of f.fatos.slice(0, 30)) l.push(`- ${x.data ? `${x.data}: ` : ''}${x.texto} _(fonte: ${x.fonte || '—'})_`);
  const tri = Object.entries(f.triagem).filter(([, v]) => v != null);
  if (tri.length) l.push('', `Triagem: ${tri.map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v ? 'sim' : 'não'}`).join(' · ')}`);
  l.push('', '## Cálculos (feitos pelo sistema)', blocoCalculos(d.calculo));
  const pend = [...f.lacunas, ...d.calculo.avisos];
  if (pend.length) { l.push('', '## Faltando ou a conferir'); for (const p of pend) l.push(`- ${p}`); }
  if (d.conferencia.length) {
    l.push('', '## Conferência da peça');
    for (const c of d.conferencia) l.push(`- ${c.presente ? '✓' : '✗'} ${c.rotulo}: ${brl(c.valor)}${c.presente ? '' : ' — NÃO aparece na peça; conferir'}`);
  }
  return l.join('\n');
}
