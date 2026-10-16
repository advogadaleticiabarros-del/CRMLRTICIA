import { db } from '../config/database';
import { aiComplete } from './aiAssistant';
import { sendText } from './uazapiInstance';
import { registrarAcaoAgente } from './usoIa';
import { COMANDANTES_PADRAO, parseNumerosComandantes } from './assistenteRegras';
import { ehMensagemHumana } from './tomDeVoz';
import { aplicarPolitica, valoresDeTabela } from './esteiraComercial';
import { referenciaOab, textoReferencia } from './tabelaOabRj';
import {
  detectarIntencaoProposta, calcularCapacidade, promptSinaisCapacidade, parseSinais, promptCopiloto, parseSugestaoCopiloto, mensagemCopiloto,
  type ResultadoCapacidade, type SinaisCapacidade, type MsgConversa,
} from './copilotoComercial';

/**
 * Dr. Otávio com banco, IA e WhatsApp (regras em copilotoComercial.ts).
 * A cada conversa nova (2 min de espera para juntar as mensagens):
 *  1) qualifica o possível cliente em % e grava no lead (capacidade_*);
 *  2) se a Dra. ou a equipe está na conversa e apareceu intenção de proposta,
 *     manda a sugestão SÓ para a Dra. (uma vez por dia por conversa).
 * Nada vai ao cliente. Desligar: COPILOTO_DESLIGADO=1.
 */

const fim8 = (p: string | null | undefined) => String(p || '').replace(/\D/g, '').slice(-8);
const NUMERO_DRA = COMANDANTES_PADRAO.split(',')[0];
const ESPERA_MS = 120_000;
const REQUALIFICAR_MIN = 20;

const espera = new Map<string, NodeJS.Timeout>();
export function agendarCopiloto(phone: string): void {
  if (process.env.COPILOTO_DESLIGADO === '1') return;
  const k = fim8(phone);
  if (k.length < 8) return;
  const t = espera.get(k);
  if (t) clearTimeout(t);
  espera.set(k, setTimeout(() => {
    espera.delete(k);
    rodarCopiloto(phone).catch((e) => console.error('[copiloto] falhou:', e?.message || e));
  }, ESPERA_MS));
}

async function marcar(ref: string, marco: string): Promise<boolean> {
  const [r] = await db.query('INSERT IGNORE INTO esteira_avisos (ref, marco) VALUES (?, ?)', [ref, marco]) as any;
  return r.affectedRows === 1;
}

async function leadDoTelefone(phone: string) {
  const [[l]] = await db.query(
    `SELECT id, name, legal_area, case_summary, notes, status, capacidade_sinais, capacidade_em, fechamento_pct FROM leads
      WHERE RIGHT(REGEXP_REPLACE(COALESCE(phone,''), '[^0-9]', ''), 8) = ?
        AND status NOT IN ('perdida','convertido','fechada','contrato_assinado','newsletter','proposta_recusada')
      ORDER BY id DESC LIMIT 1`, [fim8(phone)]).catch(() => [[null]]) as any;
  return l || null;
}

const linhas = (msgs: any[]) => msgs.map((m) => `${m.from_me ? 'Escritório' : 'Cliente'}: ${String(m.body || '').replace(/\s+/g, ' ').slice(0, 500)}`);

/** Lê os sinais da conversa, calcula a % e grava no lead (quando houver). */
export async function qualificarCapacidade(phone: string, lead: any | null, msgs: any[]): Promise<ResultadoCapacidade | null> {
  if (msgs.filter((m) => !m.from_me).length < 2) return null;
  const r = await aiComplete(promptSinaisCapacidade(linhas(msgs), lead?.legal_area || null), 'openai');
  if (!r.ok || !r.text) return null;
  const sinais = parseSinais(r.text);
  const cap = calcularCapacidade(sinais);
  if (lead) {
    await db.query(
      'UPDATE leads SET capacidade_pct = ?, potencial_pct = ?, fechamento_pct = ?, capacidade_sinais = ?, capacidade_em = NOW() WHERE id = ?',
      [cap.capacidade, cap.potencial, cap.fechamento, JSON.stringify({ sinais, motivos: cap.motivos, modalidade: cap.modalidade, faltam: cap.faltam, confianca: cap.confianca }), lead.id]);
    if (lead.fechamento_pct == null || Math.abs(Number(lead.fechamento_pct) - cap.fechamento) >= 5) {
      registrarAcaoAgente('copiloto', `qualificou ${lead.name}: chance de fechar ${cap.fechamento}% (capacidade ${cap.capacidade}%, potencial ${cap.potencial}%)`);
    }
  }
  return cap;
}

function capacidadeGuardada(lead: any): ResultadoCapacidade | null {
  try {
    const s = typeof lead?.capacidade_sinais === 'string' ? JSON.parse(lead.capacidade_sinais) : lead?.capacidade_sinais;
    return s?.sinais ? calcularCapacidade(s.sinais as SinaisCapacidade) : null;
  } catch { return null; }
}

export async function rodarCopiloto(phone: string) {
  const comandantes = await db.query("SELECT setting_value FROM office_settings WHERE setting_key = 'assistente_whatsapp_numeros'")
    .then(([[r]]: any) => parseNumerosComandantes(r?.setting_value || COMANDANTES_PADRAO)).catch(() => parseNumerosComandantes(COMANDANTES_PADRAO));
  if (comandantes.some((c) => fim8(c) === fim8(phone))) return { ok: false, motivo: 'comandante' };
  const [[meta]] = await db.query('SELECT labels FROM whatsapp_chat_meta WHERE phone = ?', [phone]).catch(() => [[null]]) as any;
  if (String(meta?.labels || '').includes('Parceiro')) return { ok: false, motivo: 'parceiro' };

  const [rows] = await db.query('SELECT from_me, body, sent_by, msg_time FROM whatsapp_messages WHERE phone = ? ORDER BY msg_time DESC LIMIT 40', [phone]) as any;
  const msgs = [...rows].reverse();
  if (!msgs.length) return { ok: false, motivo: 'sem conversa' };
  const lead = await leadDoTelefone(phone);
  const [[cliente]] = await db.query(
    "SELECT id, name FROM clients WHERE RIGHT(REGEXP_REPLACE(COALESCE(phone,''), '[^0-9]', ''), 8) = ? LIMIT 1", [fim8(phone)]).catch(() => [[null]]) as any;

  // 1) Qualificação em % (só possível cliente: quem já é cliente não precisa).
  let cap: ResultadoCapacidade | null = capacidadeGuardada(lead);
  const velha = !lead?.capacidade_em || Date.now() - new Date(lead.capacidade_em).getTime() > REQUALIFICAR_MIN * 60000;
  if (!cliente && lead && (velha || !cap)) cap = await qualificarCapacidade(phone, lead, msgs).catch(() => cap);

  // 2) Copiloto: a Dra./equipe está conversando e chegou na proposta?
  const lista: MsgConversa[] = msgs.map((m: any) => ({ from_me: !!m.from_me, body: String(m.body || ''), humano: !m.from_me || ehMensagemHumana(m.sent_by) }));
  const intencao = detectarIntencaoProposta(lista);
  if (!intencao.intencao) return { ok: true, qualificado: !!cap };
  const humanaRecente = msgs.some((m: any) => m.from_me && ehMensagemHumana(m.sent_by) && Date.now() - new Date(m.msg_time).getTime() < 24 * 3600000);
  if (!humanaRecente) return { ok: true, qualificado: !!cap, motivo: 'sem a Dra. na conversa' };
  const dia = new Date().toISOString().slice(0, 10);
  if (!(await marcar(`copiloto:${fim8(phone)}`, `intencao_${dia}`))) return { ok: true, motivo: 'já sugerido hoje' };

  if (!cap && !cliente) cap = await qualificarCapacidade(phone, null, msgs).catch(() => null);
  if (!cap) cap = calcularCapacidade({});
  const nome = lead?.name || cliente?.name || `+${phone}`;
  const area = lead?.legal_area || null;
  const assunto = String(lead?.case_summary || lead?.notes || '').trim();
  const { configuracao, historicoAceitas } = await import('./esteiraComercialServico');
  const cfg = await configuracao();
  const ref = area ? referenciaOab(area, assunto) : null;
  const v = area ? valoresDeTabela(area, await historicoAceitas(), cfg.tabela, ref) : null;
  const parc = v ? aplicarPolitica(v, cfg.politica) : null;
  const sugestao = v && parc ? { total: parc.total, entrada: parc.entrada, parcelas: parc.parcelas, valorParcela: parc.valor_parcela, exito: v.exito, origem: v.origem } : null;

  const { guiaAtual } = await import('./atendenteServico');
  const textoSugestao = sugestao
    ? `${sugestao.total ? `honorários R$ ${sugestao.total}, entrada R$ ${sugestao.entrada}, ${sugestao.parcelas}x de R$ ${sugestao.valorParcela}` : 'só êxito'}, êxito ${sugestao.exito}% (${sugestao.origem})`
    : 'área ainda não definida';
  const r = await aiComplete(promptCopiloto({ guia: (await guiaAtual()).texto, nome, area, conversa: linhas(msgs), cap, sugestao: textoSugestao }), 'openai');
  const s = r.ok && r.text ? parseSugestaoCopiloto(r.text) : { proxima_mensagem: '', pontos: [] };

  const texto = [
    mensagemCopiloto({ nome, leadId: lead?.id ?? null, area, gatilho: intencao.gatilho, quem: intencao.quem, cap, sugestao, proximaMensagem: s.proxima_mensagem, pontos: s.pontos }),
    ref ? textoReferencia(ref) : null,
  ].filter(Boolean).join('\n');
  await sendText(NUMERO_DRA, texto, 'Agente Dr. Otávio');
  registrarAcaoAgente('copiloto', `sugeriu à Dra. a proposta de ${nome} (chance de fechar ${cap.fechamento}%)`);
  return { ok: true, sugerido: true };
}

/** Painel do Dr. Otávio: possíveis clientes qualificados, do maior para o menor. */
export async function qualificados() {
  const [rows] = await db.query(
    `SELECT id, name, legal_area, status, capacidade_pct, potencial_pct, fechamento_pct, capacidade_sinais, capacidade_em FROM leads
      WHERE fechamento_pct IS NOT NULL AND status NOT IN ('perdida','newsletter') AND capacidade_em >= NOW() - INTERVAL 60 DAY
      ORDER BY fechamento_pct DESC, capacidade_em DESC LIMIT 60`).catch(() => [[]]) as any;
  return rows;
}
