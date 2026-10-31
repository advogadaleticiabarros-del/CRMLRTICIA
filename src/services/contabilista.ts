import { chaveContrato, mesmoBanco, familiaDoContrato } from './contratosDoCaso';
import { NOME_FAMILIA, type Familia } from './pecaConsolidacao';
import type { ContratoFicha, FichaDeFatos } from './pecaDossie';
import { brl, mesBr, calcularPeca, type CalculoPeca } from './pecaCalculos';
import { atualizarCalculo } from './planilhaCalculos';
import type { IndicesMensais } from './indicesEconomicos';

/**
 * Calculista na leitura dos documentos (pedido da Jessica, 31/10/2026: "a planilha deve
 * ser calculada no momento da leitura... para que a peça não fique zerada e para separar
 * o cálculo das próximas peças").
 *
 * O histórico de créditos do INSS (HISCRE) mostra cada desconto do benefício só pela
 * RUBRICA ("216 CONSIGNACAO EMPRESTIMO BANCARIO 43,64"), sem banco nem contrato. O extrato
 * de empréstimos (HISCON) traz cada contrato com banco, parcela e período. Aqui se faz o
 * que o contador faz à mão, em código e sem IA:
 *  1. cada desconto do extrato vai para o contrato da mesma família (empréstimo, RMC, RCC),
 *     ativo naquele mês e com a parcela do mesmo valor (cartão RMC/RCC varia: vale o único
 *     cartão ativo daquele tipo);
 *  2. o que não dá para atribuir com certeza fica "sem dono", com o motivo, e vira aviso;
 *  3. os meses que nenhum extrato de pagamento cobre são estimados pela parcela do contrato
 *     (do início do desconto até o fim, o nº de parcelas ou o último mês fechado).
 * Assim cada desconto tem banco, e cada peça (uma por banco) pega só os seus.
 */

export type FamiliaRubrica = 'emprestimo' | 'rmc' | 'rcc';

export interface LancamentoExtrato {
  competencia: string; valor: number; rubrica?: string | null; contrato?: string | null; banco?: string | null; fonte?: string | null;
}
export interface DescontoApurado {
  competencia: string; valor: number; contrato: string; banco: string | null; fonte: string | null;
  origem: 'extrato' | 'estimado'; rubrica?: string | null;
}
export interface ResultadoApuracao {
  descontos: DescontoApurado[];
  semDono: Array<LancamentoExtrato & { motivo: string }>;
  avisos: string[];
}

/** Rubrica do HISCRE → família do contrato. 216 empréstimo; 217 RMC; 268 RCC (cartão consignado de benefício). */
export function familiaDaRubrica(rubrica: string | null | undefined): FamiliaRubrica | null {
  const t = String(rubrica || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (!t.trim()) return null;
  if (/\bRCC\b|^\s*268\b|CARTAO CONSIGNADO DE BENEF|CONSIGNACAO\s*-\s*CARTAO/.test(t)) return 'rcc';
  if (/\bRMC\b|^\s*217\b|RESERVA DE MARGEM/.test(t)) return 'rmc';
  if (/^\s*216\b|EMPRESTIMO|CONSIGNACAO/.test(t)) return 'emprestimo';
  return null;
}

function familiaDoTipo(tipo: string | null): FamiliaRubrica | null {
  const t = String(tipo || '').toLowerCase();
  if (t === 'rmc') return 'rmc';
  if (t === 'rcc') return 'rcc';
  if (/^(emprestimo_consignado|refinanciamento|portabilidade)$/.test(t)) return 'emprestimo';
  return null;
}

const somarMeses = (c: string, n: number) => {
  const t = Number(c.slice(0, 4)) * 12 + Number(c.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const mesDe = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const comp = (v: string | null | undefined) => (v && /^\d{4}-\d{2}$/.test(v) ? v : null);
/** "dd/mm/aaaa" → "aaaa-mm". */
const mesDaData = (v: string | null | undefined) => { const m = String(v || '').match(/^\d{1,2}\/(\d{1,2})\/(\d{4})$/); return m ? `${m[2]}-${m[1].padStart(2, '0')}` : null; };

interface Janela { c: ContratoFicha; nome: string; familia: FamiliaRubrica | null; ini: string | null; fim: string | null }

function janela(c: ContratoFicha, ultimoFechado: string): Janela {
  const ini = comp(c.inicio_desconto) || mesDaData(c.data);
  const fins = [comp(c.fim_desconto), ini && c.n_parcelas ? somarMeses(ini, c.n_parcelas - 1) : null].filter((x): x is string => !!x);
  const encerrado = /exclu|encerr|liquid|cancel/i.test(String(c.situacao || ''));
  const fim = fins.length ? fins.sort()[0] : (encerrado ? null : ultimoFechado);
  return { c, nome: c.numero || `${c.tipo || 'contrato'} ${c.banco || ''}`.trim(), familia: familiaDoTipo(c.tipo), ini, fim: fim && fim > ultimoFechado ? ultimoFechado : fim };
}

const noPeriodo = (j: Janela, m: string) => (!j.ini || m >= j.ini) && (!j.fim || m <= j.fim);
const mesmoValor = (a: number | null, b: number) => a != null && Math.abs(a - b) <= 0.011;

export function apurarDescontos(e: { contratos: ContratoFicha[]; lancamentos: LancamentoExtrato[]; competenciasExtrato: string[]; hoje: Date }): ResultadoApuracao {
  const ultimoFechado = somarMeses(mesDe(e.hoje), -1);
  const janelas = e.contratos.map((c) => janela(c, ultimoFechado));
  const porChave = new Map(janelas.map((j) => [chaveContrato(j.c), j]));
  const descontos: DescontoApurado[] = [];
  const semDono: ResultadoApuracao['semDono'] = [];
  const usados = new Set<string>(); // "nome|aaaa-mm": um desconto por contrato e mês
  const atribuir = (j: Janela, l: LancamentoExtrato) => {
    usados.add(`${j.nome}|${l.competencia}`);
    descontos.push({ competencia: l.competencia, valor: l.valor, contrato: j.nome, banco: j.c.banco, fonte: l.fonte ?? null, origem: 'extrato', rubrica: l.rubrica ?? null });
  };

  const validos = e.lancamentos.filter((l) => comp(l.competencia) && l.valor > 0);
  const pendentes: LancamentoExtrato[] = [];
  for (const l of validos) {
    // O extrato já diz o contrato (ou o banco): vale o que está escrito.
    const j = l.contrato ? porChave.get(chaveContrato({ numero: l.contrato, tipo: null, banco: null, data: null })) : undefined;
    if (j) { atribuir(j, l); continue; }
    if (l.contrato) { descontos.push({ competencia: l.competencia, valor: l.valor, contrato: l.contrato, banco: l.banco ?? null, fonte: l.fonte ?? null, origem: 'extrato', rubrica: l.rubrica ?? null }); continue; }
    pendentes.push(l);
  }

  // Por mês: os descontos iguais disputam os contratos de mesma parcela.
  const porMes = new Map<string, LancamentoExtrato[]>();
  for (const l of pendentes) { if (!porMes.has(l.competencia)) porMes.set(l.competencia, []); porMes.get(l.competencia)!.push(l); }
  for (const [mes, lista] of [...porMes].sort(([a], [b]) => a.localeCompare(b))) {
    for (const l of lista) {
      const fam = familiaDaRubrica(l.rubrica);
      if (l.rubrica && !fam) continue; // imposto, pensão, mensalidade: não é desconto de banco
      const livres = janelas.filter((j) => (!fam || j.familia === fam || (!j.familia && !fam)) && noPeriodo(j, mes) && !usados.has(`${j.nome}|${mes}`)
        && (!l.banco || !j.c.banco || mesmoBanco(l.banco, j.c.banco)));
      const peloValor = livres.filter((j) => mesmoValor(j.c.parcela, l.valor));
      if (peloValor.length) {
        const bancos = new Set(peloValor.map((j) => j.c.banco || '?'));
        const iguais = lista.filter((x) => x.valor === l.valor && familiaDaRubrica(x.rubrica) === fam).length;
        const jaFeitos = janelas.filter((j) => usados.has(`${j.nome}|${mes}`) && mesmoValor(j.c.parcela, l.valor)).length;
        if (bancos.size > 1 && iguais - jaFeitos < peloValor.length) {
          semDono.push({ ...l, motivo: `parcela de ${brl(l.valor)} igual em mais de um contrato (${peloValor.map((j) => `${j.nome}, ${j.c.banco || 'banco?'}`).join('; ')}): decidir à mão` });
          continue;
        }
        atribuir(peloValor[0], l);
        continue;
      }
      // Cartão (RMC/RCC) varia mês a mês: vale o único cartão daquele tipo ativo no mês.
      const semParcela = livres.filter((j) => j.familia === fam && (fam === 'rmc' || fam === 'rcc' || j.c.parcela == null));
      if (fam && semParcela.length === 1) { atribuir(semParcela[0], l); continue; }
      semDono.push({ ...l, motivo: semParcela.length > 1
        ? `mais de um contrato possível (${semParcela.map((j) => j.nome).join(', ')}): decidir à mão`
        : `nenhum contrato ${fam ? `de ${fam === 'emprestimo' ? 'empréstimo' : fam.toUpperCase()} ` : ''}ativo em ${mesBr(mes)} com parcela de ${brl(l.valor)}` });
    }
  }

  // Meses sem extrato de pagamento: estima pela parcela do contrato.
  const cobertos = new Set([...e.competenciasExtrato.filter((c) => comp(c)), ...validos.map((l) => l.competencia)]);
  const avisos: string[] = [];
  for (const j of janelas) {
    if (!j.c.parcela || !j.ini || !j.fim) continue;
    const est: string[] = [];
    for (let m = j.ini; m <= j.fim; m = somarMeses(m, 1)) {
      if (cobertos.has(m) || usados.has(`${j.nome}|${m}`)) continue;
      descontos.push({ competencia: m, valor: j.c.parcela, contrato: j.nome, banco: j.c.banco, fonte: 'estimado pela parcela do contrato (HISCON)', origem: 'estimado' });
      est.push(m);
    }
    if (est.length) avisos.push(`Contrato ${j.nome}${j.c.banco ? ` (${j.c.banco})` : ''}: ${est.length} desconto(s) de ${mesBr(est[0])} a ${mesBr(est[est.length - 1])} estimados pela parcela de ${brl(j.c.parcela)}, porque nenhum extrato de pagamento do benefício cobre esses meses. Juntar o histórico de créditos do período confirma os valores.`);
  }
  for (const j of janelas) {
    if (!descontos.some((d) => d.contrato === j.nome)) avisos.push(`Contrato ${j.nome}${j.c.banco ? ` (${j.c.banco})` : ''}: nenhum desconto encontrado${j.c.parcela ? '' : ' (sem o valor da parcela no extrato de empréstimos)'}${j.ini ? '' : ' (sem a data de início do desconto)'}.`);
  }
  if (semDono.length) {
    const total = semDono.reduce((s, x) => s + x.valor, 0);
    avisos.push(`${semDono.length} desconto(s) do extrato sem contrato certo (${brl(total)}), fora do cálculo até a Dra. decidir: ${semDono.slice(0, 6).map((x) => `${mesBr(x.competencia)} ${brl(x.valor)} — ${x.motivo}`).join('; ')}${semDono.length > 6 ? '; …' : ''}.`);
  }
  descontos.sort((a, b) => a.contrato.localeCompare(b.contrato, 'pt-BR', { numeric: true }) || a.competencia.localeCompare(b.competencia));
  return { descontos, semDono, avisos };
}

/** A ficha lida com os descontos já apurados por contrato (e banco); os avisos vão para as lacunas. */
export function apurarFicha(ficha: FichaDeFatos, hoje: Date): FichaDeFatos {
  const r = apurarDescontos({ contratos: ficha.contratos, lancamentos: ficha.descontos, competenciasExtrato: ficha.competencias_extrato || [], hoje });
  return {
    ...ficha,
    descontos: r.descontos.map((d) => ({ competencia: d.competencia, valor: d.valor, contrato: d.contrato, banco: d.banco, fonte: d.fonte, rubrica: d.rubrica ?? null, origem: d.origem })),
    lacunas: [...ficha.lacunas, ...r.avisos],
  };
}

export interface CalculoDoBanco {
  banco: string;
  /** Família de tese (empréstimo consignado, cartão consignado RMC/RCC…): cada uma é uma peça. */
  familia: Familia | null; modalidade: string;
  contratos: ContratoFicha[]; calculo: CalculoPeca;
}

/**
 * O cálculo de cada peça, feito na leitura: um por banco E modalidade (regra da Jessica:
 * uma peça por banco; empréstimo consignado e cartão consignado são processos separados;
 * RMC e RCC do mesmo banco vão juntos). Dentro de cada um, cada contrato tem a sua linha.
 * Contrato sem banco fica de fora (aviso na apuração).
 */
export function calcularPorBanco(ficha: FichaDeFatos, indices: IndicesMensais | null, hoje: Date): CalculoDoBanco[] {
  const grupos: Array<{ familia: Familia | null; contratos: ContratoFicha[] }> = [];
  for (const c of ficha.contratos.filter((x) => x.banco)) {
    const familia = familiaDoContrato(c.tipo);
    const g = grupos.find((x) => x.familia === familia && mesmoBanco(x.contratos[0].banco, c.banco));
    if (g) g.contratos.push(c); else grupos.push({ familia, contratos: [c] });
  }
  return grupos.map(({ familia, contratos }) => {
    const nomes = new Set(contratos.map((c) => c.numero || `${c.tipo || 'contrato'} ${c.banco || ''}`.trim()));
    const descontos = ficha.descontos.filter((d) => d.contrato && nomes.has(d.contrato))
      .map((d) => ({ competencia: d.competencia, valor: d.valor, contrato: d.contrato, fonte: d.fonte }));
    const base = calcularPeca({ contratos, descontos, hoje, jaApurados: true });
    return { banco: contratos[0].banco as string, familia, modalidade: familia ? NOME_FAMILIA[familia] : 'Modalidade não identificada', contratos, calculo: atualizarCalculo(base, indices, hoje) };
  }).sort((a, b) => a.banco.localeCompare(b.banco, 'pt-BR') || a.modalidade.localeCompare(b.modalidade, 'pt-BR'));
}
