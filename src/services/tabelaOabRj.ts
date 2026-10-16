/**
 * Referência de honorários para as propostas: Tabela de Honorários da OAB/RJ
 * (arquivo nova_tabela_honorarios_oabrj.pdf, enviado pela Jessica em
 * 16/10/2026). Cada item tem o MÍNIMO da tabela (piso) e a SUGESTÃO MÉDIA
 * RJ/MG/SP; usamos como sugerido o maior dos dois. Só os itens das áreas do
 * escritório. "percentual" = o item é cobrado sobre o valor econômico (êxito),
 * com o mínimo da tabela; "fixo" = honorário inicial.
 * Observação: o piso ético é o da seccional onde o serviço é prestado (CED,
 * art. 48, §6º); a OAB/RJ é o parâmetro escolhido pelo escritório.
 * Regras puras — tests/tabelaOabRj.test.mjs.
 */

const semAcento = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface ItemOab {
  codigo: string; area: string; descricao: string; minimo: number; media: number; sugerido: number;
  tipo: 'fixo' | 'percentual'; re: RegExp | null;
}

const item = (codigo: string, area: string, descricao: string, minimo: number, media: number | null, tipo: ItemOab['tipo'], re: RegExp | null): ItemOab =>
  ({ codigo, area, descricao, minimo, media: media ?? minimo, sugerido: Math.max(minimo, media ?? minimo), tipo, re });

/** Ordem importa: o primeiro item cujo assunto bate vale; o item sem assunto é o padrão da área. */
export const ITENS_OAB_RJ: ItemOab[] = [
  item('14.18', 'trabalhista', 'Ação de indenização por acidente de trabalho (20% a 30% sobre o valor econômico)', 5000, 5000, 'percentual', /acidente|\bcat\b|sequela|doenca ocupacional/),
  item('14.11', 'trabalhista', 'Patrocínio de reclamante, sobre o valor econômico da questão, da condenação ou do acordo', 1000, 1529.26, 'percentual', null),
  item('13.28', 'previdenciario', 'Ação para concessão de salário-maternidade', 1000, 1022.28, 'fixo', /maternidade/),
  item('13.30', 'previdenciario', 'Ação de revisão de benefício', 2000, 2600.28, 'fixo', /revis/),
  item('13.29', 'previdenciario', 'Ação de concessão ou restabelecimento de benefício por incapacidade', 3000, null, 'fixo', /auxilio.?doenca|incapacidade|invalidez|afastamento/),
  item('13.32', 'previdenciario', 'Ação de reconhecimento de tempo de serviço/contribuição', 3000, 4825.14, 'fixo', /tempo de (servico|contribuicao)|averbacao/),
  item('13.26', 'previdenciario', 'Ação de concessão ou restabelecimento de aposentadoria, auxílio-acidente, pensão por morte e BPC', 5000, 4908.20, 'fixo', null),
  item('12.13', 'familia', 'Execução de alimentos (prisão ou penhora)', 3000, 2846.68, 'fixo', /execucao de alimentos|pensao atrasad|prisao/),
  item('12.2c', 'familia', 'Divórcio judicial litigioso', 12000, 11353.87, 'fixo', /litigios/),
  item('12.2a', 'familia', 'Divórcio judicial consensual', 7000, 7613.47, 'fixo', /divorcio/),
  item('12.6a', 'familia', 'Dissolução de união estável consensual', 7000, 5715.02, 'fixo', /uniao estavel/),
  item('12.21', 'familia', 'Ação de regulamentação de visitas', 6000, 6572.54, 'fixo', /visita|convivencia/),
  item('12.24', 'familia', 'Ação de alteração de guarda', 6000, 5403.90, 'fixo', /guarda/),
  item('12.7', 'familia', 'Investigação de paternidade', 8000, 8000, 'fixo', /paternidade|dna/),
  item('12.12', 'familia', 'Ação de alimentos (proposição ou contestação: valor de 3 pensões mensais)', 3000, 2793.90, 'fixo', null),
  item('16.3', 'consumidor', 'Ação movida pelo consumidor contra o fornecedor', 1000, 2685.76, 'fixo', null),
  item('8.1', 'civel', 'Juizado Especial (estadual ou federal): ação ou defesa e audiência', 2000, 1816.90, 'fixo', /juizado|pequenas causas/),
  item('9.1', 'civel', 'Procedimento comum: proposição ou defesa', 6000, 5858.03, 'fixo', null),
];

const AREA_DA_TABELA: Record<string, string> = { gestante: 'trabalhista' };

export interface ReferenciaOab { codigo: string; descricao: string; minimo: number; media: number; sugerido: number; tipo: ItemOab['tipo'] }

/** Item da tabela para a área e o assunto do caso (null = área sem referência). */
export function referenciaOab(area: string | null | undefined, assunto: string | null | undefined): ReferenciaOab | null {
  const a = AREA_DA_TABELA[String(area || '')] || String(area || '');
  const itens = ITENS_OAB_RJ.filter((i) => i.area === a);
  if (!itens.length) return null;
  const t = semAcento(assunto || '');
  const i = itens.find((x) => x.re && x.re.test(t)) || itens.find((x) => !x.re) || itens[0];
  return { codigo: i.codigo, descricao: i.descricao, minimo: i.minimo, media: i.media, sugerido: i.sugerido, tipo: i.tipo };
}

const brl = (n: number) => `R$ ${Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function textoReferencia(r: ReferenciaOab | null): string {
  if (!r) return '';
  return r.tipo === 'percentual'
    ? `📘 Referência OAB/RJ ${r.codigo} (${r.descricao}): cobrança sobre o valor econômico, mínimo de ${brl(r.minimo)}.`
    : `📘 Referência OAB/RJ ${r.codigo} (${r.descricao}): mínimo ${brl(r.minimo)}, sugestão média ${brl(r.media)}.`;
}
