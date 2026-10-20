import { db } from '../config/database';
import { aiComplete } from './aiAssistant';
import { sendText } from './uazapiInstance';
import { registrarAcaoAgente } from './usoIa';
import { COMANDANTES_PADRAO, parseNumerosComandantes } from './assistenteRegras';
import { trechosDeConversa, promptGuia, parseGuia, guiaEmTexto, ehMensagemHumana } from './tomDeVoz';
import { PERGUNTAS_POR_AREA, deveResponder, montarPromptAtendente, parseRespostaAtendente, alertasDaResposta, type ContatoAtendente } from './atendente';
import { calcularCapacidade, perguntasQueFaltam } from './copilotoComercial';

/**
 * Dra. Lívia com banco, IA e WhatsApp (regras em atendente.ts e tomDeVoz.ts).
 * Modo rascunho: ela prepara a resposta, a equipe envia/edita/descarta.
 * Desligar de emergência: ATENDENTE_DESLIGADO=1 no .env.
 */

const fim8 = (p: string | null | undefined) => String(p || '').replace(/\D/g, '').slice(-8);
const NUMERO_DRA = COMANDANTES_PADRAO.split(',')[0];

async function comandantes(): Promise<string[]> {
  const [[r]] = await db.query("SELECT setting_value FROM office_settings WHERE setting_key = 'assistente_whatsapp_numeros'").catch(() => [[null]]) as any;
  return parseNumerosComandantes(r?.setting_value || COMANDANTES_PADRAO);
}

async function salvarConfig(chave: string, valor: string) {
  await db.query('INSERT INTO office_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [chave, valor]);
}

// ── Tom de voz ──────────────────────────────────────────────────────────────

/** Lê 90 dias de conversas escritas pela equipe e atualiza o guia de tom de voz (CRM + Cérebro). */
export async function estudarTomDeVoz() {
  const [msgs] = await db.query(
    "SELECT phone, from_me, body, sent_by, msg_time FROM whatsapp_messages WHERE msg_time >= NOW() - INTERVAL 90 DAY AND body <> '' ORDER BY msg_time DESC LIMIT 8000") as any;
  const trechos = trechosDeConversa(msgs, await comandantes());
  if (trechos.length < 3) return { conversas: trechos.length, guia: false };
  const r = await aiComplete(promptGuia(trechos), 'openai');
  const g = r.ok && r.text ? parseGuia(r.text) : null;
  if (!g) return { conversas: trechos.length, guia: false };
  await salvarConfig('guia_tom_de_voz', JSON.stringify(g));
  await import('./cerebroServico').then((m) => m.importarNotas([{ caminho: 'CRM/Guia de tom de voz do escritório.md', texto: guiaEmTexto(g) }])).catch(() => {});
  registrarAcaoAgente('atendente', `estudou ${trechos.length} conversas da equipe e atualizou o guia de tom de voz`);
  return { conversas: trechos.length, guia: true };
}

export async function guiaAtual(): Promise<{ texto: string; guia: any | null }> {
  const [[r]] = await db.query("SELECT setting_value FROM office_settings WHERE setting_key = 'guia_tom_de_voz'").catch(() => [[null]]) as any;
  try { const g = r?.setting_value ? JSON.parse(r.setting_value) : null; return { texto: g ? guiaEmTexto(g) : '', guia: g }; } catch { return { texto: '', guia: null }; }
}

// ── Rascunhos ───────────────────────────────────────────────────────────────

// Cliente costuma mandar várias mensagens seguidas: espera 90 s e responde tudo de uma vez.
const espera = new Map<string, NodeJS.Timeout>();
export function agendarRascunho(phone: string, clientId: number | null, parceiro: boolean): void {
  if (process.env.ATENDENTE_DESLIGADO === '1') return;
  const k = fim8(phone);
  const t = espera.get(k);
  if (t) clearTimeout(t);
  espera.set(k, setTimeout(() => {
    espera.delete(k);
    gerarRascunho(phone, clientId, parceiro).catch((e) => console.error('[atendente] falhou:', e?.message || e));
  }, 90_000));
}

async function contatoDe(phone: string, clientId: number | null): Promise<ContatoAtendente> {
  if (clientId) {
    const [[c]] = await db.query('SELECT name FROM clients WHERE id = ?', [clientId]) as any;
    const [[cs]] = await db.query('SELECT legal_area FROM cases WHERE client_id = ? ORDER BY id DESC LIMIT 1', [clientId]).catch(() => [[null]]) as any;
    const [procs] = await db.query(
      `SELECT lp.process_number,
              (SELECT CONCAT(DATE_FORMAT(pm.movement_date, '%d/%m/%Y'), ': ', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pm.ai_summary, '$.resumo')), pm.title, ''))
                 FROM process_movements pm WHERE pm.process_id = lp.id ORDER BY pm.movement_date DESC LIMIT 1) AS ultima
         FROM legal_processes lp WHERE lp.client_id = ? AND lp.status = 'ativo' LIMIT 5`, [clientId]).catch(() => [[]]) as any;
    return { tipo: 'cliente', nome: c?.name || null, area: cs?.legal_area || null, processos: procs.map((p: any) => ({ numero: p.process_number, ultimaMov: p.ultima ? String(p.ultima).slice(0, 300) : null })) };
  }
  const [[l]] = await db.query("SELECT name, legal_area FROM leads WHERE RIGHT(REGEXP_REPLACE(COALESCE(phone,''), '[^0-9]', ''), 8) = ? ORDER BY id DESC LIMIT 1", [fim8(phone)]).catch(() => [[null]]) as any;
  return l ? { tipo: 'possivel_cliente', nome: l.name, area: l.legal_area, processos: [] } : { tipo: 'novo', nome: null, area: null, processos: [] };
}

/** A próxima pergunta sutil que o Dr. Otávio ainda precisa (situação, salário, verbas, decisão, pagamento). */
async function perguntaSutilDo(phone: string): Promise<string | null> {
  const [[l]] = await db.query(
    "SELECT capacidade_sinais FROM leads WHERE RIGHT(REGEXP_REPLACE(COALESCE(phone,''), '[^0-9]', ''), 8) = ? ORDER BY id DESC LIMIT 1", [fim8(phone)]).catch(() => [[null]]) as any;
  let sinais = {};
  try { const s = typeof l?.capacidade_sinais === 'string' ? JSON.parse(l.capacidade_sinais) : l?.capacidade_sinais; sinais = s?.sinais || {}; } catch { /* sem qualificação */ }
  return perguntasQueFaltam(calcularCapacidade(sinais), 1)[0] || null;
}

export async function gerarRascunho(phone: string, clientId: number | null, parceiro: boolean): Promise<number | null> {
  const [msgs] = await db.query(
    'SELECT from_me, body, sent_by, msg_time FROM whatsapp_messages WHERE phone = ? ORDER BY msg_time DESC LIMIT 30', [phone]) as any;
  const lista = [...msgs].reverse();
  const ultimaCliente = [...lista].reverse().find((m: any) => !m.from_me);
  if (!ultimaCliente) return null;
  const ultimaHumana = [...lista].reverse().find((m: any) => m.from_me && ehMensagemHumana(m.sent_by));
  const ultimaHumanaHaMin = ultimaHumana ? (Date.now() - new Date(ultimaHumana.msg_time).getTime()) / 60000 : null;
  const ehComandante = (await comandantes()).some((c) => fim8(c) === fim8(phone));
  if (!deveResponder({ comandante: ehComandante, parceiro, texto: ultimaCliente.body, ultimaHumanaHaMin })) return null;

  const guia = (await guiaAtual()).texto;
  // Objeção a uma proposta enviada: quem responde é o Dr. Rafael (negociação).
  const negociacao = await import('./negociadorServico')
    .then((m) => m.tentarNegociacao({ phone, clientId, lista, guia }))
    .catch((e) => { console.error('[negociador] falhou:', e?.message || e); return null; });
  if (negociacao) return negociacao;

  const contato = await contatoDe(phone, clientId);
  const [mem] = await db.query("SELECT texto FROM agente_memorias WHERE agente = 'atendente' ORDER BY id DESC LIMIT 8").catch(() => [[]]) as any;
  const area = String(contato.area || '').toLowerCase();
  const prompt = montarPromptAtendente({
    guia, correcoes: mem.map((m: any) => m.texto), contato,
    conversa: lista.map((m: any) => `${m.from_me ? 'Escritório' : 'Cliente'}: ${String(m.body || '').replace(/\s+/g, ' ').slice(0, 500)}`),
    perguntas: PERGUNTAS_POR_AREA[area] || PERGUNTAS_POR_AREA.geral,
    perguntaSutil: contato.tipo === 'cliente' ? null : await perguntaSutilDo(phone),
  });
  const r = await aiComplete(prompt, 'openai');
  const resp = r.ok && r.text ? parseRespostaAtendente(r.text) : null;
  if (!resp) return null;

  // Só substitui rascunhos de atendimento: os dos outros agentes (documentos, assinatura) ficam para aprovar.
  await db.query("UPDATE atendente_rascunhos SET status = 'substituida' WHERE phone = ? AND status = 'pendente' AND agente IN ('atendente','negociador')", [phone]);
  const alertas = alertasDaResposta(resp.resposta);
  const [ins] = await db.query(
    `INSERT INTO atendente_rascunhos (phone, client_id, nome, mensagem_cliente, resposta, intencao, area, urgente, motivo_urgencia, encaminhar, alertas)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [phone, clientId, contato.nome, String(ultimaCliente.body).slice(0, 4000), resp.resposta, resp.intencao, resp.area, resp.urgente ? 1 : 0,
     resp.motivo_urgencia || null, resp.encaminhar, JSON.stringify(alertas)]) as any;
  const nome = contato.nome || `+${phone}`;
  const [admins] = await db.query("SELECT id FROM users WHERE role IN ('admin','advogado','staff') AND active = 1").catch(() => [[]]) as any;
  for (const a of admins) {
    await db.query(
      `INSERT INTO notifications (user_id, client_id, title, message, notification_type, channel, scheduled_at, status)
       VALUES (?, ?, ?, ?, 'atendente_rascunho', 'sistema', NOW(), 'pendente')`,
      [a.id, clientId, `${resp.urgente ? '🚨 ' : '💬 '}Dra. Lívia preparou uma resposta para ${nome}`,
       `${resp.resposta.slice(0, 200)}\n\nAprove em Escritório virtual → Dra. Lívia.`]).catch(() => {});
  }
  if (resp.urgente) await sendText(NUMERO_DRA, `🚨 *Atendimento urgente* — ${nome}\n${resp.motivo_urgencia || ultimaCliente.body.slice(0, 200)}\n\nA Dra. Lívia deixou uma resposta pronta para aprovar no CRM (Escritório virtual).`, 'Agente Dra. Lívia').catch(() => false);
  registrarAcaoAgente('atendente', `preparou resposta para ${nome} (${resp.intencao.replace('_', ' ')})`);
  return ins.insertId;
}

export async function listarRascunhos(status = 'pendente') {
  const [rows] = await db.query(
    'SELECT * FROM atendente_rascunhos WHERE status = ? ORDER BY urgente DESC, created_at DESC LIMIT 50', [status]) as any;
  return rows;
}

export async function enviarRascunho(id: number, texto: string, quem: string): Promise<{ ok: boolean; erro?: string }> {
  const [[r]] = await db.query('SELECT * FROM atendente_rascunhos WHERE id = ?', [id]) as any;
  if (!r) return { ok: false, erro: 'Rascunho não encontrado' };
  if (r.status !== 'pendente') return { ok: false, erro: `Este rascunho já está como "${r.status}".` };
  const final = String(texto || r.resposta).trim();
  const agente = r.agente || 'atendente';
  const { NOME_AGENTE } = await import('./aprovacaoMensagens');
  // "Agente" no sent_by: o estudo de tom de voz não aprende com o texto dos agentes.
  // Sai do jeito que o agente ou a automação montou (texto, botões, PIX): ver envioAprovado.ts.
  const { executarEnvioAprovado, lerEnvio } = await import('./envioAprovado');
  const ok = await executarEnvioAprovado(r.phone, final.slice(0, 4000), lerEnvio(r.envio), `Agente ${NOME_AGENTE[agente] || 'Dra. Lívia'} (aprovado por ${quem})`);
  if (!ok) return { ok: false, erro: 'Não deu para enviar: confira se o WhatsApp está conectado.' };
  const editada = final !== String(r.resposta).trim();
  await db.query("UPDATE atendente_rascunhos SET status = ?, resposta_final = ?, decidido_por = ?, decidido_em = NOW() WHERE id = ?",
    [editada ? 'editada' : 'enviada', final, quem, id]);
  if (editada) {
    await db.query("INSERT INTO agente_memorias (agente, tipo, texto) VALUES (?, 'correcao', ?)",
      [agente, `Em vez de "${String(r.resposta).slice(0, 220)}", a equipe enviou "${final.slice(0, 220)}".`]);
  }
  registrarAcaoAgente(agente, `teve a resposta para ${r.nome || r.phone} ${editada ? 'ajustada e enviada' : 'aprovada e enviada'} por ${quem}`);
  return { ok: true };
}

export async function descartarRascunho(id: number, quem: string, motivo: string | null) {
  const [[r]] = await db.query('SELECT agente FROM atendente_rascunhos WHERE id = ?', [id]) as any;
  await db.query("UPDATE atendente_rascunhos SET status = 'descartada', decidido_por = ?, decidido_em = NOW() WHERE id = ? AND status = 'pendente'", [quem, id]);
  if (motivo && motivo.trim()) {
    await db.query("INSERT INTO agente_memorias (agente, tipo, texto) VALUES (?, 'correcao', ?)",
      [r?.agente || 'atendente', `Resposta descartada: ${motivo.trim().slice(0, 400)}`]);
  }
}
