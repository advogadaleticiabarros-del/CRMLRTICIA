import { db } from '../config/database';
import { aiComplete } from './aiAssistant';
import { sendText } from './uazapiInstance';
import { registrarAcaoAgente } from './usoIa';
import { NUMERO_DRA } from './esteiraComercialServico';
import {
  detectarObjecoes, montarPromptNegociador, parseRespostaNegociador, alertasNegociador, valoresDaProposta, mensagemDraObjecao,
  type CategoriaObjecao,
} from './negociador';

/**
 * Dr. Rafael com banco, IA e WhatsApp (regras em negociador.ts). Entra no
 * lugar da Dra. Lívia quando quem escreve tem proposta enviada e a mensagem
 * traz objeção. Modo rascunho: a resposta vai para a mesma fila de aprovação
 * (atendente_rascunhos, agente = 'negociador'). Pedido de desconto ou dúvida
 * de risco/custo avisa a Dra. no WhatsApp.
 */

const fim8 = (p: string | null | undefined) => String(p || '').replace(/\D/g, '').slice(-8);

async function propostaAberta(phone: string) {
  const [[p]] = await db.query(
    `SELECT p.id, p.status, p.honorarios, p.legal_area, p.validade, COALESCE(p.contact_name, l.name) AS nome
       FROM propostas p LEFT JOIN leads l ON l.id = p.lead_id
      WHERE p.status IN ('enviada','em_negociacao')
        AND RIGHT(REGEXP_REPLACE(COALESCE(NULLIF(p.phone,''), l.phone, ''), '[^0-9]', ''), 8) = ?
        AND (p.validade IS NULL OR p.validade >= CURDATE() - INTERVAL 15 DAY)
      ORDER BY p.id DESC LIMIT 1`, [fim8(phone)]).catch(() => [[null]]) as any;
  return p || null;
}

interface MsgConversa { from_me: number | boolean; body: string }

/**
 * Se for objeção a uma proposta aberta, prepara a resposta do Dr. Rafael e
 * devolve o id do rascunho. null = não é negociação (a Lívia segue normal).
 */
export async function tentarNegociacao(d: { phone: string; clientId: number | null; lista: MsgConversa[]; guia: string }): Promise<number | null> {
  if (process.env.NEGOCIADOR_DESLIGADO === '1') return null;
  // Só as mensagens do cliente depois da última resposta do escritório.
  const bloco: string[] = [];
  for (let i = d.lista.length - 1; i >= 0 && !d.lista[i].from_me; i--) bloco.unshift(String(d.lista[i].body || ''));
  const trecho = bloco.join(' ');
  const objecoes = detectarObjecoes(trecho);
  if (!objecoes.length) return null;
  const p = await propostaAberta(d.phone);
  if (!p) return null;

  let h: any = {};
  try { h = typeof p.honorarios === 'string' ? JSON.parse(p.honorarios) : p.honorarios || {}; } catch { /* proposta sem honorários estruturados */ }
  const parc = h.parcelamento || {};
  const total = Number(parc.total) || 0, entrada = Number(parc.entrada) || 0, parcelas = Math.max(1, Number(parc.parcelas) || 1);
  const exito = Number(h.values?.exito) || null;
  const valorParcela = Number(parc.valor_parcela) || Math.round(((total - entrada) / parcelas) * 100) / 100;
  const permitidos = valoresDaProposta({ total, entrada, parcelas }, exito);
  permitidos.reais.push(...[parc.valor_parcela, parc.ultima_parcela].map(Number).filter((x) => x > 0));
  const validade = p.validade ? (p.validade instanceof Date ? p.validade.toISOString().slice(0, 10) : String(p.validade).slice(0, 10)) : null;

  const [mem] = await db.query("SELECT texto FROM agente_memorias WHERE agente = 'negociador' ORDER BY id DESC LIMIT 8").catch(() => [[]]) as any;
  const prompt = montarPromptNegociador({
    guia: d.guia, correcoes: mem.map((m: any) => m.texto), objecoes,
    proposta: { id: p.id, nome: p.nome || 'cliente', area: p.legal_area, total, entrada, parcelas, valorParcela, exito, validade },
    conversa: d.lista.map((m) => `${m.from_me ? 'Escritório' : 'Cliente'}: ${String(m.body || '').replace(/\s+/g, ' ').slice(0, 500)}`),
  });
  const r = await aiComplete(prompt, 'openai');
  const resp = r.ok && r.text ? parseRespostaNegociador(r.text) : null;
  if (!resp) return null;
  const todas = [...new Set<CategoriaObjecao>([...objecoes, ...resp.objecoes])];
  const alertas = alertasNegociador(resp.resposta, permitidos);

  await db.query("UPDATE atendente_rascunhos SET status = 'substituida' WHERE phone = ? AND status = 'pendente'", [d.phone]);
  const [ins] = await db.query(
    `INSERT INTO atendente_rascunhos (agente, phone, client_id, nome, mensagem_cliente, resposta, intencao, area, urgente, motivo_urgencia, encaminhar, alertas, objecoes, proposta_id)
     VALUES ('negociador', ?, ?, ?, ?, ?, 'negociacao', ?, 0, ?, ?, ?, ?, ?)`,
    [d.phone, d.clientId, p.nome, trecho.slice(0, 4000), resp.resposta, p.legal_area, resp.precisa_dra ? (resp.motivo_dra || 'pediu outra condição').slice(0, 500) : null,
     resp.precisa_dra ? 'dra' : null, JSON.stringify(alertas), JSON.stringify(todas), p.id]) as any;
  await db.query("UPDATE propostas SET status = 'em_negociacao' WHERE id = ? AND status = 'enviada'", [p.id]).catch(() => {});

  const [equipe] = await db.query("SELECT id FROM users WHERE role IN ('admin','advogado','staff') AND active = 1").catch(() => [[]]) as any;
  for (const u of equipe) {
    await db.query(
      `INSERT INTO notifications (user_id, client_id, title, message, notification_type, channel, scheduled_at, status)
       VALUES (?, ?, ?, ?, 'atendente_rascunho', 'sistema', NOW(), 'pendente')`,
      [u.id, d.clientId, `🤝 Dr. Rafael preparou resposta à objeção de ${p.nome}`, `${resp.resposta.slice(0, 200)}\n\nAprove em Escritório virtual → Dra. Lívia.`]).catch(() => {});
  }
  if (resp.precisa_dra) {
    await sendText(NUMERO_DRA, mensagemDraObjecao({ id: p.id, nome: p.nome, objecoes: todas, trecho, pedidoDesconto: resp.pedido_desconto, motivo: resp.motivo_dra }), 'Agente Dr. Rafael').catch(() => false);
  }
  registrarAcaoAgente('negociador', `preparou resposta à objeção de ${p.nome} na proposta nº ${p.id} (${todas.join(', ')})`);
  return ins.insertId;
}
