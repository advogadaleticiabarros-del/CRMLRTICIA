import { db } from '../config/database';
import { aiComplete } from './aiAssistant';
import { registrarAcaoAgente } from './usoIa';
import { conversaDeAcao, promptReuniao, parseReuniao } from './sociedadeAgentes';

/**
 * Sociedade dos agentes com banco e IA (regras em sociedadeAgentes.ts):
 * conversas a partir das ações reais, reunião diária e memória da equipe.
 */

const local = (col: string) => `DATE(CONVERT_TZ(${col},'+00:00','-03:00'))`;
const HOJE = "DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))";

/** Ações novas (agente_acoes) viram conversas entre colegas. Uma conversa por ação. */
export async function gerarConversas() {
  const [[w]] = await db.query("SELECT setting_value FROM office_settings WHERE setting_key = 'sociedade_ultima_acao'").catch(() => [[null]]) as any;
  const desde = Number(w?.setting_value) || 0;
  const [acoes] = await db.query('SELECT id, agente, texto FROM agente_acoes WHERE id > ? ORDER BY id ASC LIMIT 300', [desde]) as any;
  let criadas = 0;
  for (const a of acoes) {
    const c = conversaDeAcao(a);
    if (!c) continue;
    const [r] = await db.query('INSERT IGNORE INTO agente_conversas (de, para, tema, falas, ref) VALUES (?, ?, ?, ?, ?)',
      [c.de, c.para, c.tema, JSON.stringify(c.falas), c.ref]) as any;
    criadas += r.affectedRows;
  }
  if (acoes.length) {
    await db.query('INSERT INTO office_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
      ['sociedade_ultima_acao', String(acoes[acoes.length - 1].id)]);
  }
  return { acoes: acoes.length, conversas: criadas };
}

/** Reunião diária da equipe (fim do dia): ata, falas, ideias e o que cada um aprendeu. */
export async function reuniaoDiaria(forcar = false) {
  const [[dia]] = await db.query(`SELECT ${HOJE} AS d`) as any;
  const data = new Date(dia.d).toISOString().slice(0, 10);
  if (!forcar) {
    const [[ja]] = await db.query('SELECT id FROM agente_reunioes WHERE dia = ?', [data]) as any;
    if (ja) return { reuniao: false, motivo: 'já aconteceu hoje' };
  }
  const [acoes] = await db.query(`SELECT agente, texto FROM agente_acoes WHERE ${local('created_at')} = ${HOJE} ORDER BY id`) as any;
  const porAgente: Record<string, string[]> = {};
  for (const a of acoes) (porAgente[a.agente] ||= []).push(a.texto);
  const [runs] = await db.query(`SELECT job, COUNT(*) AS n FROM job_runs WHERE status = 'ok' AND ${local('ran_at')} = ${HOJE} GROUP BY job`) as any;
  const [[erros]] = await db.query(`SELECT COUNT(*) AS n FROM job_runs WHERE status = 'erro' AND ${local('ran_at')} = ${HOJE}`) as any;
  const numeros = [
    `rotinas automáticas concluídas hoje: ${runs.reduce((s: number, r: any) => s + Number(r.n), 0)}`,
    `rotinas com erro hoje: ${Number(erros?.n || 0)}`,
  ];
  const [mem] = await db.query('SELECT agente, texto FROM agente_memorias ORDER BY id DESC LIMIT 15') as any;
  const r = await aiComplete(promptReuniao({ data, acoes: porAgente, numeros, memorias: mem.map((m: any) => `${m.agente}: ${m.texto}`) }), 'openai');
  const reuniao = r.ok && r.text ? parseReuniao(r.text) : null;
  if (!reuniao) return { reuniao: false, motivo: 'IA indisponível' };
  await db.query(
    `INSERT INTO agente_reunioes (dia, ata, falas, ideias) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE ata = VALUES(ata), falas = VALUES(falas), ideias = VALUES(ideias)`,
    [data, reuniao.ata, JSON.stringify(reuniao.falas), JSON.stringify(reuniao.ideias)]);
  for (const a of reuniao.aprendizados) {
    await db.query("INSERT INTO agente_memorias (agente, tipo, texto) VALUES (?, 'aprendizado', ?)", [a.agente, a.texto.slice(0, 600)]);
  }
  registrarAcaoAgente('secretaria', `conduziu a reunião da equipe (${reuniao.falas.length} falas, ${reuniao.ideias.length} ideias)`);
  return { reuniao: true, falas: reuniao.falas.length, ideias: reuniao.ideias.length };
}

const json = (v: any) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : v || []);

export async function mural() {
  const [conversas] = await db.query('SELECT id, de, para, tema, falas, created_at FROM agente_conversas ORDER BY id DESC LIMIT 40') as any;
  const [[reuniao]] = await db.query('SELECT dia, ata, falas, ideias, created_at FROM agente_reunioes ORDER BY dia DESC LIMIT 1') as any;
  const [memorias] = await db.query('SELECT agente, tipo, texto, created_at FROM agente_memorias ORDER BY id DESC LIMIT 30') as any;
  return {
    conversas: conversas.map((c: any) => ({ ...c, falas: json(c.falas) })),
    reuniao: reuniao ? { ...reuniao, falas: json(reuniao.falas), ideias: json(reuniao.ideias) } : null,
    memorias,
  };
}
