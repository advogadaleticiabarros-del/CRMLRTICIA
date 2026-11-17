import { db } from '../config/database';
import { sendText } from './uazapiInstance';
import { destinoWhatsappPessoal } from './destinoWhatsappPessoal';
import { prepararParaAprovacao } from './aprovacaoMensagens';

/**
 * Vencimentos de clientes: aviso ao ESCRITÓRIO e cobrança só com autorização.
 *
 * Pedido de 17/11/2026: "Não envie cobranças automáticas, quero receber lembretes
 * de vencimentos no WhatsApp, não estamos recebendo, e só pode enviar para o
 * cliente se eu autorizar o envio da cobrança e sempre, sempre calcular os juros
 * atualizados."
 *
 * - Todo dia às 8h: um WhatsApp para o número de `destinoWhatsappPessoal` com o
 *   que venceu (já com multa e juros de hoje), o que vence hoje e nos 3 dias
 *   seguintes. Entram lançamentos, parcelas de proposta e parcelas de contrato.
 * - Para cada vencida de cliente com telefone, uma cobrança vira RASCUNHO em
 *   Escritório virtual → Mensagens para aprovar. Enquanto estiver pendente, o
 *   texto é recalculado todo dia, para sair com os juros do dia em que for
 *   aprovado. Nada vai ao cliente sem alguém clicar em enviar.
 */

/** Cláusula de inadimplemento dos modelos de contrato (contractTemplates.ts). */
export const ENCARGOS_CONTRATO = { multaPct: 2, jurosMesPct: 1 } as const;

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const dia = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
/** Data ISO (AAAA-MM-DD) para dd/mm/aaaa, sem passar por fuso (evita voltar um dia). */
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const money = (v: number) => `R$ ${v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
/** Hoje em Brasília, AAAA-MM-DD. */
export const hojeBrasilia = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

export interface Encargos { diasAtraso: number; multa: number; juros: number; total: number }

/** Multa sobre a parcela + juros simples ao mês pro rata die (mês de 30 dias). */
export function calcularEncargos(valor: number, vencimento: string, hoje: string,
  regra: { multaPct: number; jurosMesPct: number } = ENCARGOS_CONTRATO): Encargos {
  const diasAtraso = Math.max(0, Math.round((dia(hoje) - dia(vencimento)) / 86400000));
  if (!diasAtraso) return { diasAtraso: 0, multa: 0, juros: 0, total: r2(valor) };
  const multa = r2(valor * regra.multaPct / 100);
  const juros = r2(valor * regra.jurosMesPct / 100 * diasAtraso / 30);
  return { diasAtraso, multa, juros, total: r2(valor + multa + juros) };
}

export interface ItemVencimento {
  cliente: string; descricao: string; valor: number; vencimento: string;
  fonte?: string; id?: number; clientId?: number | null; phone?: string | null;
}

const MAX_LINHAS = 25;
function bloco(titulo: string, linhas: string[]): string[] {
  if (!linhas.length) return [];
  const extra = linhas.length > MAX_LINHAS ? [`  … e mais ${linhas.length - MAX_LINHAS}`] : [];
  return ['', titulo, ...linhas.slice(0, MAX_LINHAS), ...extra];
}

/** Texto do WhatsApp ao escritório. null quando não há nada a avisar. */
export function montarAvisoVencimentos(itens: ItemVencimento[], hoje: string): string | null {
  const ate3 = dia(hoje) + 3 * 86400000;
  const vencidas = itens.filter((i) => i.vencimento < hoje);
  const hojeV = itens.filter((i) => i.vencimento === hoje);
  const proximas = itens.filter((i) => i.vencimento > hoje && dia(i.vencimento) <= ate3);
  if (!vencidas.length && !hojeV.length && !proximas.length) return null;

  let totalAtual = 0;
  const lv = vencidas.map((i) => {
    const e = calcularEncargos(i.valor, i.vencimento, hoje);
    totalAtual += e.total;
    return `• ${i.cliente} — ${i.descricao} — venceu ${br(i.vencimento)} (${e.diasAtraso} dia${e.diasAtraso > 1 ? 's' : ''}) — ${money(i.valor)} → ${money(e.total)}`;
  });
  const simples = (i: ItemVencimento) => `• ${i.cliente} — ${i.descricao} — ${money(i.valor)}${i.vencimento !== hoje ? ` — ${br(i.vencimento)}` : ''}`;
  const { multaPct, jurosMesPct } = ENCARGOS_CONTRATO;
  return [
    `💰 *Vencimentos — ${br(hoje)}*`,
    ...bloco(`*Vencidas* (valor atualizado hoje: multa ${multaPct}% + juros ${jurosMesPct}% a.m. pro rata)`, lv),
    ...(vencidas.length ? [`Total atualizado: ${money(r2(totalAtual))}`] : []),
    ...bloco('*Vencem hoje*', hojeV.map(simples)),
    ...bloco('*Próximos 3 dias*', proximas.map(simples)),
    '',
    vencidas.length
      ? 'As cobranças das vencidas estão em Escritório virtual → Mensagens para aprovar, com os juros de hoje. Nada foi enviado ao cliente.'
      : 'Nada foi enviado ao cliente.',
  ].join('\n');
}

/** Mensagem de cobrança ao cliente (vai para aprovação, nunca direto). */
export function textoCobrancaCliente(i: ItemVencimento, hoje: string): string {
  const e = calcularEncargos(i.valor, i.vencimento, hoje);
  const nome = String(i.cliente || '').trim().split(/\s+/)[0] || 'tudo bem';
  const { multaPct, jurosMesPct } = ENCARGOS_CONTRATO;
  return [
    `Olá, ${nome}! Tudo bem?`,
    `Consta em aberto a parcela ${i.descricao}, com vencimento em ${br(i.vencimento)}, no valor de ${money(i.valor)}.`,
    '',
    `Conforme o contrato, o valor atualizado para hoje (${br(hoje)}) é:`,
    `• Parcela: ${money(i.valor)}`,
    `• multa de ${multaPct}%: ${money(e.multa)}`,
    `• juros de ${jurosMesPct}% ao mês (${e.diasAtraso} dia${e.diasAtraso > 1 ? 's' : ''}): ${money(e.juros)}`,
    `*Total: ${money(e.total)}*`,
    '',
    'O pagamento pode ser feito por Pix pelo portal: https://crm.advogadaleticiabarros.com.br. Se já pagou, desconsidere e nos envie o comprovante, por favor. Qualquer dificuldade, me chama que encontramos uma solução.',
  ].join('\n');
}

/** Contas a receber de clientes ainda em aberto, até 3 dias à frente. Datas como texto. */
async function itensEmAberto(hoje: string): Promise<ItemVencimento[]> {
  const out: ItemVencimento[] = [];
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
            re.descricao, cl.id AS client_id, cl.name AS cliente, cl.phone
       FROM parcelas pa JOIN receitas re ON re.id = pa.receita_id JOIN clients cl ON cl.id = re.client_id
      WHERE pa.status IN ('aberto','atrasado','parcial') AND pa.data_vencimento <= DATE_ADD(?, INTERVAL 3 DAY)`, [hoje]).catch(() => [[]]) as any;
  for (const r of parc) {
    // "— Contrato — Fulano" no fim da descrição repete o nome do cliente.
    const desc = String(r.descricao || '').replace(/\s+—\s+Contrato\s+—\s+.*$/, '');
    out.push({ fonte: 'contrato', id: r.id, descricao: `${r.numero}/${r.total_parcelas}${desc ? ' — ' + desc : ''}`, valor: Number(r.valor_final) || 0, vencimento: r.venc, cliente: r.cliente, clientId: r.client_id, phone: r.phone });
  }
  return out.filter((i) => i.vencimento).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}

const marca = (i: ItemVencimento) => `[cobranca:${i.fonte}:${i.id}]`;

/**
 * Rascunho de cobrança para aprovação. Cria uma vez por parcela; enquanto o
 * rascunho estiver pendente, só atualiza o texto com os juros do dia.
 */
export async function prepararCobranca(i: ItemVencimento, hoje: string): Promise<'criado' | 'atualizado' | 'nada'> {
  const { normalizePhone } = await import('./whatsappQueue');
  const phone = normalizePhone(i.phone);
  if (!phone) return 'nada';
  const texto = textoCobrancaCliente(i, hoje);
  const e = calcularEncargos(i.valor, i.vencimento, hoje);
  const contexto = `${marca(i)} Parcela vencida em ${br(i.vencimento)} (${i.descricao}), ${e.diasAtraso} dia(s) de atraso. ` +
    `Valor recalculado em ${br(hoje)}: ${money(i.valor)} + multa ${money(e.multa)} + juros ${money(e.juros)} = ${money(e.total)}. ` +
    'Enquanto este rascunho estiver aqui, o valor é atualizado todo dia. Só sai se alguém da equipe enviar.';
  const [[pend]] = await db.query(
    "SELECT id FROM atendente_rascunhos WHERE agente = 'cobranca' AND status = 'pendente' AND mensagem_cliente LIKE ? LIMIT 1",
    [`%${marca(i)}%`]) as any;
  if (pend) {
    await db.query('UPDATE atendente_rascunhos SET resposta = ?, mensagem_cliente = ? WHERE id = ?', [texto, `CONTEXTO: ${contexto}`, pend.id]);
    return 'atualizado';
  }
  // Uma vez só por parcela: se a equipe descartou, não volta a aparecer.
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
  let rascunhos = 0;
  for (const i of itens.filter((x) => x.vencimento < hoje)) {
    if ((await prepararCobranca(i, hoje).catch(() => 'nada')) !== 'nada') rascunhos++;
  }
  const texto = montarAvisoVencimentos(itens, hoje);
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
