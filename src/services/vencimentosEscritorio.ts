import { db } from '../config/database';
import { sendText } from './uazapiInstance';
import { destinoWhatsappPessoal } from './destinoWhatsappPessoal';
import { prepararParaAprovacao } from './aprovacaoMensagens';
import { calcularEncargos, regraDoCliente, serieIpca, type RegraEncargos, type SerieIpca, type Encargos } from './encargosContrato';

/**
 * Vencimentos de clientes: aviso ao ESCRITÓRIO e cobrança só com autorização.
 *
 * Pedido de 17/11/2026: "Não envie cobranças automáticas, quero receber lembretes
 * de vencimentos no WhatsApp, não estamos recebendo, e só pode enviar para o
 * cliente se eu autorizar o envio da cobrança e sempre, sempre calcular os juros
 * atualizados." E depois: "sempre calcule de acordo com cada contrato do cliente".
 *
 * - Todo dia às 8h: um WhatsApp para o número de `destinoWhatsappPessoal` com o
 *   que venceu (já com os encargos de hoje), o que vence hoje e nos 3 dias
 *   seguintes. Entram lançamentos, parcelas de proposta e parcelas de contrato.
 * - Multa, juros e IPCA saem da cláusula de atraso do CONTRATO de cada cliente
 *   (encargosContrato.ts). Sem cláusula (ou sem contrato), não há encargo e o
 *   aviso e o rascunho dizem isso.
 * - Para cada vencida de cliente com telefone, uma cobrança vira RASCUNHO em
 *   Escritório virtual → Mensagens para aprovar. Enquanto estiver pendente, o
 *   texto é recalculado todo dia, para sair com os encargos do dia em que for
 *   aprovado. Nada vai ao cliente sem alguém clicar em enviar.
 */

const dia = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
/** Data ISO (AAAA-MM-DD) para dd/mm/aaaa, sem passar por fuso (evita voltar um dia). */
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const money = (v: number) => `R$ ${v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
const pct = (v: number) => `${String(v).replace('.', ',')}%`;
/** Hoje em Brasília, AAAA-MM-DD. */
export const hojeBrasilia = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

export interface ItemVencimento {
  cliente: string; descricao: string; valor: number; vencimento: string;
  fonte?: string; id?: number; clientId?: number | null; phone?: string | null;
  /** Cláusula de atraso do contrato do cliente; null = contrato sem cláusula (ou sem contrato). */
  regra?: RegraEncargos | null; contratoId?: number | null;
}

const enc = (i: ItemVencimento, hoje: string, ipca: SerieIpca | null): Encargos =>
  calcularEncargos(i.valor, i.vencimento, hoje, i.regra ?? null, ipca);

/** "multa 2% + juros 1% a.m. + IPCA", do jeito que está no contrato. */
export function descreverRegra(r: RegraEncargos | null | undefined): string {
  if (!r) return 'contrato sem cláusula de atraso: sem encargos';
  return [r.multaPct ? `multa ${pct(r.multaPct)}` : '', r.jurosMesPct ? `juros ${pct(r.jurosMesPct)} a.m.` : '', r.ipca ? 'IPCA' : '']
    .filter(Boolean).join(' + ');
}

const MAX_LINHAS = 25;
function bloco(titulo: string, linhas: string[]): string[] {
  if (!linhas.length) return [];
  const extra = linhas.length > MAX_LINHAS ? [`  … e mais ${linhas.length - MAX_LINHAS}`] : [];
  return ['', titulo, ...linhas.slice(0, MAX_LINHAS), ...extra];
}

/** Texto do WhatsApp ao escritório. null quando não há nada a avisar. */
export function montarAvisoVencimentos(itens: ItemVencimento[], hoje: string, ipca: SerieIpca | null = null): string | null {
  const ate3 = dia(hoje) + 3 * 86400000;
  const vencidas = itens.filter((i) => i.vencimento < hoje);
  const hojeV = itens.filter((i) => i.vencimento === hoje);
  const proximas = itens.filter((i) => i.vencimento > hoje && dia(i.vencimento) <= ate3);
  if (!vencidas.length && !hojeV.length && !proximas.length) return null;

  let totalAtual = 0;
  let semClausula = 0;
  let ipcaFora = false;
  const lv = vencidas.map((i) => {
    const e = enc(i, hoje, ipca);
    totalAtual += e.total;
    if (!i.regra) semClausula++;
    if (e.ipcaIndisponivel) ipcaFora = true;
    const valor = i.regra
      ? `${money(i.valor)} → ${money(e.total)} (${descreverRegra(i.regra)})`
      : `${money(i.valor)} ⚠️ ${descreverRegra(null)}`;
    return `• ${i.cliente} — ${i.descricao} — venceu ${br(i.vencimento)} (${e.diasAtraso} dia${e.diasAtraso > 1 ? 's' : ''}) — ${valor}`;
  });
  const simples = (i: ItemVencimento) => `• ${i.cliente} — ${i.descricao} — ${money(i.valor)}${i.vencimento !== hoje ? ` — ${br(i.vencimento)}` : ''}`;
  return [
    `💰 *Vencimentos — ${br(hoje)}*`,
    ...bloco('*Vencidas* (valor atualizado hoje, pela cláusula de atraso do contrato de cada cliente)', lv),
    ...(vencidas.length ? [`Total atualizado: ${money(Math.round(totalAtual * 100) / 100)}`] : []),
    ...(semClausula ? [`⚠️ ${semClausula} sem cláusula de atraso no contrato (ou sem contrato no CRM): sem multa e juros. Confira o contrato.`] : []),
    ...(ipcaFora ? ['⚠️ O IPCA do Banco Central não respondeu hoje: a correção ficou de fora.'] : []),
    ...bloco('*Vencem hoje*', hojeV.map(simples)),
    ...bloco('*Próximos 3 dias*', proximas.map(simples)),
    '',
    vencidas.length
      ? 'As cobranças das vencidas estão em Escritório virtual → Mensagens para aprovar, com os encargos de hoje. Nada foi enviado ao cliente.'
      : 'Nada foi enviado ao cliente.',
  ].join('\n');
}

/** Mensagem de cobrança ao cliente (vai para aprovação, nunca direto). */
export function textoCobrancaCliente(i: ItemVencimento, hoje: string, ipca: SerieIpca | null = null): string {
  const e = enc(i, hoje, ipca);
  const nome = String(i.cliente || '').trim().split(/\s+/)[0] || 'tudo bem';
  const r = i.regra;
  const linhas = [
    `Olá, ${nome}! Tudo bem?`,
    `Consta em aberto a parcela ${i.descricao}, com vencimento em ${br(i.vencimento)}, no valor de ${money(i.valor)}.`,
  ];
  if (r && e.diasAtraso) {
    const dias = `${e.diasAtraso} dia${e.diasAtraso > 1 ? 's' : ''}`;
    linhas.push('', `Conforme o contrato, o valor atualizado para hoje (${br(hoje)}) é:`, `• Parcela: ${money(i.valor)}`);
    if (r.ipca && !e.ipcaIndisponivel) linhas.push(`• correção pelo IPCA (${dias}): ${money(e.correcao)}`);
    if (r.multaPct) linhas.push(`• multa de ${pct(r.multaPct)}: ${money(e.multa)}`);
    if (r.jurosMesPct) linhas.push(`• juros de ${pct(r.jurosMesPct)} ao mês (${dias}): ${money(e.juros)}`);
    linhas.push(`*Total: ${money(e.total)}*`);
  }
  linhas.push('', 'O pagamento pode ser feito por Pix pelo portal: https://crm.advogadaleticiabarros.com.br. Se já pagou, desconsidere e nos envie o comprovante, por favor. Qualquer dificuldade, me chama que encontramos uma solução.');
  return linhas.join('\n');
}

/** Contas a receber de clientes ainda em aberto, até 3 dias à frente, com a regra do contrato de cada um. */
async function itensEmAberto(hoje: string): Promise<ItemVencimento[]> {
  const out: Array<ItemVencimento & { _receita?: number | null }> = [];
  const [fr] = await db.query(
    `SELECT fr.id, fr.description AS descricao, fr.valor, DATE_FORMAT(fr.due_date, '%Y-%m-%d') AS venc,
            cl.id AS client_id, cl.name AS cliente, cl.phone
       FROM financial_records fr JOIN clients cl ON cl.id = fr.client_id
      WHERE fr.tipo = 'receita' AND fr.status IN ('pendente','vencido') AND fr.due_date IS NOT NULL
        AND fr.due_date <= DATE_ADD(?, INTERVAL 3 DAY)`, [hoje]) as any;
  for (const r of fr) out.push({ fonte: 'lancamento', id: r.id, descricao: r.descricao || 'Lançamento', valor: Number(r.valor) || 0, vencimento: r.venc, cliente: r.cliente, clientId: r.client_id, phone: r.phone });
  const [inst] = await db.query(
    `SELECT i.id, i.numero, i.valor, DATE_FORMAT(i.due_date, '%Y-%m-%d') AS venc, p.title,
            cl.id AS client_id, cl.name AS cliente, cl.phone
       FROM installments i JOIN clients cl ON cl.id = i.client_id LEFT JOIN propostas p ON p.id = i.proposta_id
      WHERE i.status IN ('pendente','vencido') AND i.due_date <= DATE_ADD(?, INTERVAL 3 DAY)`, [hoje]) as any;
  for (const r of inst) out.push({ fonte: 'parcela', id: r.id, descricao: `${r.numero}ª parcela${r.title ? ' — ' + r.title : ''}`, valor: Number(r.valor) || 0, vencimento: r.venc, cliente: r.cliente, clientId: r.client_id, phone: r.phone });
  const [parc] = await db.query(
    `SELECT pa.id, pa.numero, pa.total_parcelas, pa.valor_final, DATE_FORMAT(pa.data_vencimento, '%Y-%m-%d') AS venc,
            re.descricao, re.valor AS receita_valor, cl.id AS client_id, cl.name AS cliente, cl.phone
       FROM parcelas pa JOIN receitas re ON re.id = pa.receita_id JOIN clients cl ON cl.id = re.client_id
      WHERE pa.status IN ('aberto','atrasado','parcial') AND pa.data_vencimento <= DATE_ADD(?, INTERVAL 3 DAY)`, [hoje]).catch(() => [[]]) as any;
  for (const r of parc) {
    // "— Contrato — Fulano" no fim da descrição repete o nome do cliente.
    const desc = String(r.descricao || '').replace(/\s+—\s+Contrato\s+—\s+.*$/, '');
    out.push({ fonte: 'contrato', id: r.id, descricao: `${r.numero}/${r.total_parcelas}${desc ? ' — ' + desc : ''}`, valor: Number(r.valor_final) || 0, vencimento: r.venc, cliente: r.cliente, clientId: r.client_id, phone: r.phone, _receita: Number(r.receita_valor) || null });
  }
  // Regra do contrato de cada cliente (uma consulta por cliente e valor de receita).
  const cache = new Map<string, Promise<{ regra: RegraEncargos | null; contratoId: number | null }>>();
  for (const i of out) {
    const k = `${i.clientId}|${i._receita ?? ''}`;
    if (!cache.has(k)) cache.set(k, regraDoCliente(i.clientId, i._receita).catch(() => ({ regra: null, contratoId: null })));
    const { regra, contratoId } = await cache.get(k)!;
    i.regra = regra; i.contratoId = contratoId; delete i._receita;
  }
  return out.filter((i) => i.vencimento).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}

const marca = (i: ItemVencimento) => `[cobranca:${i.fonte}:${i.id}]`;

/**
 * Rascunho de cobrança para aprovação. Cria uma vez por parcela; enquanto o
 * rascunho estiver pendente, só atualiza o texto com os encargos do dia.
 */
export async function prepararCobranca(i: ItemVencimento, hoje: string, ipca: SerieIpca | null): Promise<'criado' | 'atualizado' | 'nada'> {
  const { normalizePhone } = await import('./whatsappQueue');
  const phone = normalizePhone(i.phone);
  if (!phone) return 'nada';
  const texto = textoCobrancaCliente(i, hoje, ipca);
  const e = enc(i, hoje, ipca);
  const regraTxt = i.regra
    ? `Regra do contrato${i.contratoId ? ' nº ' + i.contratoId : ''}: ${descreverRegra(i.regra)}. ` +
      `Valor recalculado em ${br(hoje)}: ${money(i.valor)} + correção ${money(e.correcao)}` +
      `${e.ipcaEstimado ? ' (mês sem IPCA publicado: usado o último índice)' : ''}${e.ipcaIndisponivel ? ' (IPCA indisponível hoje: correção fora)' : ''}` +
      ` + multa ${money(e.multa)} + juros ${money(e.juros)} = ${money(e.total)}. `
    : `ATENÇÃO: ${i.contratoId ? `o contrato nº ${i.contratoId} não tem cláusula de atraso` : 'não há contrato deste cliente no CRM'}; a mensagem vai sem multa e juros. Confira antes de enviar. `;
  const contexto = `${marca(i)} Parcela vencida em ${br(i.vencimento)} (${i.descricao}), ${e.diasAtraso} dia(s) de atraso. ` +
    regraTxt + 'Enquanto este rascunho estiver aqui, o valor é atualizado todo dia. Só sai se alguém da equipe enviar.';
  const [[pend]] = await db.query(
    "SELECT id FROM atendente_rascunhos WHERE agente = 'cobranca' AND status = 'pendente' AND mensagem_cliente LIKE ? LIMIT 1",
    [`%${marca(i)}%`]) as any;
  if (pend) {
    await db.query('UPDATE atendente_rascunhos SET resposta = ?, mensagem_cliente = ? WHERE id = ?', [texto, `CONTEXTO: ${contexto}`, pend.id]);
    return 'atualizado';
  }
  // Uma vez só por parcela: se a equipe descartou ou já enviou, não volta a aparecer.
  const [claim] = await db.query('INSERT IGNORE INTO sent_reminders (ref_key, channel) VALUES (?, ?)',
    [`cobr_rascunho_${i.fonte}_${i.id}`, 'aprovacao']) as any;
  if (!claim.affectedRows) return 'nada';
  await prepararParaAprovacao({ agente: 'cobranca', phone, clientId: i.clientId ?? null, nome: i.cliente, texto, contexto, area: 'financeiro' });
  return 'criado';
}

/** Job diário (8h): aviso ao escritório + rascunhos de cobrança das vencidas. */
export async function avisarVencimentosEscritorio(): Promise<{ enviado: boolean; rascunhos: number }> {
  const hoje = hojeBrasilia();
  const itens = await itensEmAberto(hoje);
  const ipca = await serieIpca();
  let rascunhos = 0;
  for (const i of itens.filter((x) => x.vencimento < hoje)) {
    if ((await prepararCobranca(i, hoje, ipca).catch(() => 'nada')) !== 'nada') rascunhos++;
  }
  const texto = montarAvisoVencimentos(itens, hoje, ipca);
  if (!texto) return { enviado: false, rascunhos };
  const [dup] = await db.query('INSERT IGNORE INTO sent_reminders (ref_key, channel) VALUES (?, ?)', [`vencimentos_escritorio_${hoje}`, 'whatsapp']) as any;
  if (!dup.affectedRows) return { enviado: false, rascunhos };
  const destino = await destinoWhatsappPessoal();
  const ok = await sendText(destino, texto, 'Automático — vencimentos do dia').catch(() => false);
  if (!ok) {
    // Libera o marco para a próxima tentativa (ex.: WhatsApp desconectado às 8h).
    await db.query('DELETE FROM sent_reminders WHERE ref_key = ?', [`vencimentos_escritorio_${hoje}`]).catch(() => {});
    throw new Error('WhatsApp do escritório não enviou o aviso de vencimentos');
  }
  return { enviado: true, rascunhos };
}
