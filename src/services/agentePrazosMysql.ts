/**
 * Liga o agente de prazos (agentePrazos.ts) ao banco, à IA e ao WhatsApp da
 * EQUIPE (Dra. e Jessica; nunca cliente). Ver o cabeçalho de agentePrazos.ts.
 */
import { db } from '../config/database';
import { aiComplete, aiCompleteJson } from './aiAssistant';
import { sendText } from './uazapiInstance';
import {
  rodarAgentePrazos, parseInterpretacao, parseJulgamento,
  type DepsAgentePrazos, type DetectadoParaAgente, type PrazoPendente, type MovimentoPosterior,
} from './agentePrazos';

/** Mesmos números que recebem os avisos de prazo (monitoringService). */
const EQUIPE_WHATSAPP = ['5544991011402', '5527988798093'];
/** Teto por rodada: o acúmulo antigo é lido aos poucos, sem estourar a IA. */
const MAX_INTIMACOES_POR_RODADA = 40;
const MAX_PRAZOS_POR_RODADA = 60;

const json = (v: unknown): any => {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch { return null; }
};
const iso = (d: unknown): string | null => {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(String(d));
  return Number.isNaN(x.getTime()) ? null : x.toISOString().slice(0, 10);
};
const hojeSP = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

async function perguntarIa(prompt: string): Promise<string | null> {
  const a = await aiComplete(prompt, 'openai').catch(() => null);
  if (a?.ok && a.text) return a.text;
  const b = await aiCompleteJson(prompt, 'groq').catch(() => null);
  return b?.ok && b.text ? b.text : null;
}

function promptInterpretar(texto: string, d: DetectadoParaAgente): string {
  return `Você é advogada processualista brasileira e lê uma publicação (intimação) do Diário de Justiça.
Escritório da Dra. Letícia Elias Barros (OAB/ES 39.948). Nosso cliente: ${d.cliente || 'não informado'}.
Processo: ${d.numero || 'sem número'} · Órgão: ${d.orgao || d.tribunal || 'não informado'} · Classe: ${d.classe || 'não informada'}.

Diga O QUE é o ato e PARA QUEM é a ordem. NÃO calcule datas nem prazos (o sistema calcula).
Responda só um JSON:
{"tipo": um de ["sentenca","acordao","contrarrazoes","embargos_outra_parte","replica","laudo","prazo_escrito","citacao","sem_prazo","incerto"],
 "destinatario": um de ["nosso_cliente","outra_parte","ambos","incerto"],
 "dias": número de dias SÓ se tipo = "prazo_escrito" e o texto disser o prazo,
 "corridos": true só se o texto disser "dias corridos",
 "resumo": "uma frase em português simples dizendo o que a publicação determina"}
Regras: "sentenca"/"acordao" quando a publicação é a própria decisão (cabe recurso); "prazo_escrito" quando o juiz manda fazer algo em X dias;
"sem_prazo" para ciência, ata, alvará, remessa, arquivamento, audiência marcada; "incerto" se o recorte não permite saber. Na dúvida, "incerto".

PUBLICAÇÃO:
${texto.replace(/\s+/g, ' ').slice(0, 5000)}`;
}

function promptJulgar(p: PrazoPendente, movs: MovimentoPosterior[]): string {
  return `Você é advogada processualista brasileira. Há um prazo do NOSSO cliente (${p.cliente || 'não informado'}), escritório da Dra. Letícia Elias Barros (OAB/ES 39.948):
Prazo: ${p.ato} · limite ${p.termo} · intimação de ${p.desde}.
Trecho da intimação: ${p.intimacao.replace(/\s+/g, ' ').slice(0, 1200)}

Movimentações do processo DEPOIS da intimação (id · data · título · texto):
${movs.map((m) => `${m.id} · ${m.data} · ${m.titulo} · ${m.texto.replace(/\s+/g, ' ').slice(0, 700)}`).join('\n')}

Pergunta: alguma dessas movimentações mostra que a NOSSA parte já cumpriu esse prazo (protocolou a peça/manifestação pedida)?
Atenção: petição da OUTRA parte não cumpre o nosso prazo. "Juntada de petição" sem dizer de quem é = incerto.
Responda só um JSON: {"cumprido":"sim"|"nao"|"incerto","movimento_id": id da movimentação que prova ou null,"quem":"nosso_cliente"|"outra_parte"|"incerto","motivo":"uma frase"}`;
}

async function usuarioAdmin(): Promise<{ id: number }> {
  const [[u]] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1") as any;
  return { id: u?.id ?? 1 };
}

async function termosDoEscritorio(): Promise<string[]> {
  const [rows] = await db.query('SELECT name, oab_number FROM lawyers WHERE active = 1').catch(() => [[]]) as any;
  const t = new Set<string>(['LETICIA ELIAS BARROS', '39948', '39.948']);
  for (const r of rows) { if (r.name) t.add(String(r.name)); if (r.oab_number) t.add(String(r.oab_number)); }
  return [...t];
}

function deps(opts: { lembrarVencendo: boolean; termos: string[]; admin: { id: number } }): DepsAgentePrazos {
  return {
    hoje: hojeSP,
    termosDoEscritorio: opts.termos,
    lembrarVencendo: opts.lembrarVencendo,

    async prazosAConfirmar() {
      const [rows] = await db.query(
        `SELECT d.id, d.movement_id, d.analise, d.movement_text, d.start_date, d.created_at,
                lp.process_number, lp.court, COALESCE(c.name, cd.name) AS cliente,
                pm.description, pm.title, pm.movement_metadata, pm.movement_date
           FROM detected_deadlines d
           LEFT JOIN legal_processes lp ON lp.id = d.process_id
           LEFT JOIN clients c ON c.id = lp.client_id
           LEFT JOIN clients cd ON cd.id = d.client_id
           LEFT JOIN process_movements pm ON pm.id = d.movement_id
          WHERE d.status = 'a_confirmar' AND d.agente_em IS NULL
          ORDER BY d.id DESC
          LIMIT ${MAX_INTIMACOES_POR_RODADA}`
      ) as any;
      return rows.map((r: any) => {
        const meta = json(r.movement_metadata) || {};
        const analise = json(r.analise);
        const disponibilizacao = String(meta.disponibilizacao_date || analise?.disponibilizacao || iso(r.movement_date) || iso(r.start_date) || iso(r.created_at)).slice(0, 10);
        return {
          id: r.id, movementId: r.movement_id ?? null, numero: r.process_number ?? null, cliente: r.cliente ?? null,
          texto: String(r.description || r.movement_text || r.title || ''), disponibilizacao,
          tribunal: r.court ?? null, orgao: meta.orgao ?? null, classe: meta.classe ?? null,
          analise: analise?.categoria ? analise : null,
        } as DetectadoParaAgente;
      });
    },

    async interpretar(texto, d) {
      if (!texto.trim()) return null;
      return parseInterpretacao(await perguntarIa(promptInterpretar(texto, d)));
    },

    async definirPrazo(d, a, origem, nota) {
      const { confirmarPrazoDetectado } = await import('../routes/detected-deadlines');
      await db.query('UPDATE detected_deadlines SET analise = ?, protocolar_ate = ?, agente_em = NOW(), agente_nota = ? WHERE id = ?',
        [JSON.stringify(a), a.protocolarAte, nota.slice(0, 600), d.id]);
      const r = await confirmarPrazoDetectado(d.id, opts.admin, {
        deadline_type: a.ato, days: a.dias, start_date: a.publicacao, due_date: a.termoFinal || undefined,
        descricao: `${a.ato} — protocolar até ${a.protocolarAte ? a.protocolarAte.split('-').reverse().join('/') : '?'} (Dra. Paula${origem === 'ia' ? ', lido pela IA: conferir' : ''})`,
        agente_origem: origem === 'ia' ? 'agente_ia' : 'agente_regra',
      });
      return { deadlineId: r?.deadline_id ?? null };
    },

    async registrarExame(id, nota) {
      await db.query('UPDATE detected_deadlines SET agente_em = NOW(), agente_nota = ? WHERE id = ?', [nota.slice(0, 600), id]);
    },

    async marcarAndamentoTratado(movementId) {
      await db.query('UPDATE process_movements SET lida_em = COALESCE(lida_em, NOW()), tratada_em = COALESCE(tratada_em, NOW()) WHERE id = ?', [movementId]);
    },

    async prazosPendentes() {
      const [rows] = await db.query(
        `SELECT dl.id, dl.description, dl.deadline_date, dl.created_at, dl.movement_text, dl.agente_ultimo_mov,
                pm.process_id, pm.movement_date, c.name AS cliente,
                (SELECT lp.id FROM legal_processes lp WHERE lp.case_id = dl.case_id ORDER BY lp.id LIMIT 1) AS process_do_caso,
                (SELECT COUNT(*) FROM legal_processes lp WHERE lp.case_id = dl.case_id) AS n_processos
           FROM deadlines dl
           LEFT JOIN process_movements pm ON pm.id = dl.movement_id
           LEFT JOIN clients c ON c.id = dl.client_id
          WHERE dl.status = 'pendente'
          ORDER BY dl.deadline_date
          LIMIT ${MAX_PRAZOS_POR_RODADA}`
      ) as any;
      const ids = rows.map((r: any) => r.process_id || (Number(r.n_processos) === 1 ? r.process_do_caso : null)).filter(Boolean);
      const numeros = new Map<number, string>();
      if (ids.length) {
        const [ps] = await db.query('SELECT id, process_number FROM legal_processes WHERE id IN (?)', [ids]) as any;
        for (const p of ps) numeros.set(p.id, p.process_number);
      }
      return rows.map((r: any) => {
        const processId = r.process_id || (Number(r.n_processos) === 1 ? r.process_do_caso : null);
        return {
          id: r.id, processId, numero: processId ? numeros.get(processId) ?? null : null, cliente: r.cliente ?? null,
          ato: String(r.description || 'Prazo').replace(/\s*\(.*$/, '').slice(0, 120),
          termo: iso(r.deadline_date) || hojeSP(), desde: iso(r.movement_date) || iso(r.created_at) || hojeSP(),
          ultimoMovVerificado: r.agente_ultimo_mov ?? null, intimacao: String(r.movement_text || ''),
        } as PrazoPendente;
      });
    },

    async movimentosDepois(processId, desde, depoisDoId) {
      const [rows] = await db.query(
        `SELECT id, movement_date, title, LEFT(COALESCE(description, ''), 1500) AS texto
           FROM process_movements
          WHERE process_id = ? AND DATE(COALESCE(movement_date, created_at)) >= ? ${depoisDoId ? 'AND id > ?' : ''}
          ORDER BY COALESCE(movement_date, created_at), id
          LIMIT 30`,
        depoisDoId ? [processId, desde, depoisDoId] : [processId, desde]
      ) as any;
      return rows.map((r: any) => ({ id: r.id, data: iso(r.movement_date) || desde, titulo: String(r.title || ''), texto: String(r.texto || '') }));
    },

    async julgar(p, movs) {
      return parseJulgamento(await perguntarIa(promptJulgar(p, movs)));
    },

    async marcarCumprido(id, evidencia) {
      await db.query(
        "UPDATE deadlines SET status = 'cumprido', cumprido_em = NOW(), cumprido_evidencia = ? WHERE id = ? AND status = 'pendente'",
        [`Dra. Paula: ${evidencia}`.slice(0, 600), id]);
    },

    async registrarVerificacao(id, ultimoMovId) {
      await db.query('UPDATE deadlines SET agente_ultimo_mov = ? WHERE id = ?', [ultimoMovId, id]);
    },

    async avisar(texto) {
      let algum = false;
      for (const n of EQUIPE_WHATSAPP) {
        const ok = await sendText(n, texto, 'Automático — Dra. Paula (prazos)').catch(() => false);
        algum = algum || !!ok;
      }
      return algum;
    },
  };
}

/** Rodada da rotina `prazos:agente` (7h40, 13h40, 19h40). Só a da manhã lembra os que vencem em 2 dias. */
export async function rodarAgentePrazosAgora(opts: { lembrarVencendo?: boolean; simular?: (texto: string) => void } = {}) {
  const lembrar = opts.lembrarVencendo ?? new Date(Date.now() - 3 * 3600_000).getUTCHours() < 10;
  const d = deps({ lembrarVencendo: lembrar, termos: await termosDoEscritorio(), admin: await usuarioAdmin() });
  if (opts.simular) {
    // Simulação (conferência manual): lê o banco e chama a IA, mas não grava nada nem envia.
    const nada = async () => {};
    Object.assign(d, {
      definirPrazo: async () => ({ deadlineId: 1 }), registrarExame: nada, marcarAndamentoTratado: nada,
      marcarCumprido: nada, registrarVerificacao: nada,
      avisar: async (t: string) => { opts.simular!(t); return true; },
    });
  }
  return rodarAgentePrazos(d);
}
