/**
 * Consultas do Claude ao CRM (extensão do Claude Desktop, 28/11/2026). Só
 * leitura. Devolve o mínimo para o trabalho: nomes, números, datas e situação.
 * Nunca CPF, endereço, telefone ou senha.
 */
import { db } from '../config/database';
import { extrairPistas, grauDeCerteza, type Certeza } from './claudeConsultas';

const local = (col: string) => `DATE(CONVERT_TZ(${col},'+00:00','-03:00'))`;
const HOJE = "DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))";
const dia = (v: unknown) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
};

/** Prazos e tarefas da pessoa até daqui a 7 dias (e os atrasados). Admin vê os prazos do escritório todo. */
export async function minhaSemana(user: { id: number; role: string }) {
  const todos = user.role === 'admin';
  const [prazos] = await db.query(
    `SELECT d.id, d.description, d.deadline_date, d.priority, c.id AS case_id, c.title AS caso, cl.name AS cliente,
            (SELECT lp.process_number FROM legal_processes lp WHERE lp.case_id = c.id ORDER BY lp.id LIMIT 1) AS processo
       FROM deadlines d
       LEFT JOIN cases c ON c.id = d.case_id
       LEFT JOIN clients cl ON cl.id = COALESCE(d.client_id, c.client_id)
      WHERE d.status = 'pendente' AND ${local('d.deadline_date')} <= ${HOJE} + INTERVAL 7 DAY
        ${todos ? '' : 'AND d.user_id = ?'}
      ORDER BY d.deadline_date LIMIT 60`, todos ? [] : [user.id]
  ) as any;
  const [tarefas] = await db.query(
    `SELECT t.id, t.title, t.due_date, t.priority, c.id AS case_id, cl.name AS cliente
       FROM tasks t LEFT JOIN cases c ON c.id = t.case_id LEFT JOIN clients cl ON cl.id = COALESCE(t.client_id, c.client_id)
      WHERE t.status = 'pendente' AND t.user_id = ? AND (t.due_date IS NULL OR ${local('t.due_date')} <= ${HOJE} + INTERVAL 7 DAY)
      ORDER BY t.due_date IS NULL, t.due_date LIMIT 60`, [user.id]
  ) as any;
  const [[aConfirmar]] = await db.query("SELECT COUNT(*) AS n FROM detected_deadlines WHERE status = 'a_confirmar'") as any;
  const hoje = dia(new Date());
  return {
    hoje,
    prazos: prazos.map((p: any) => ({
      id: p.id, descricao: p.description, vence_em: dia(p.deadline_date), atrasado: (dia(p.deadline_date) || '') < (hoje || ''),
      prioridade: p.priority, caso_id: p.case_id, caso: p.caso, cliente: p.cliente, processo: p.processo,
    })),
    tarefas: tarefas.map((t: any) => ({ id: t.id, titulo: t.title, vence_em: dia(t.due_date), prioridade: t.priority, caso_id: t.case_id, cliente: t.cliente })),
    intimacoes_a_confirmar: Number(aConfirmar?.n) || 0,
  };
}

async function casosDosClientes(clientIds: number[]) {
  if (!clientIds.length) return [];
  const [rows] = await db.query(
    `SELECT c.id, c.title, c.status, c.production_stage, c.legal_area, cl.id AS client_id, cl.name AS cliente,
            (SELECT GROUP_CONCAT(lp.process_number SEPARATOR ', ') FROM legal_processes lp WHERE lp.case_id = c.id) AS processos,
            (SELECT COUNT(*) FROM deadlines d WHERE d.case_id = c.id AND d.status = 'pendente') AS prazos_abertos
       FROM cases c JOIN clients cl ON cl.id = c.client_id
      WHERE c.client_id IN (?) AND COALESCE(c.status, '') NOT IN ('encerrado', 'arquivado') AND c.unido_ao_caso IS NULL
      ORDER BY c.id DESC LIMIT 30`, [clientIds]
  ) as any;
  return rows.map((r: any) => ({
    caso_id: r.id, titulo: r.title, cliente: r.cliente, area: r.legal_area, etapa: r.production_stage, situacao: r.status,
    processos: r.processos ? String(r.processos).split(', ') : [], prazos_abertos: Number(r.prazos_abertos) || 0,
  }));
}

/**
 * Acha o caso pelo que apareceu na conversa: número do processo (certo), CPF
 * ou nome do cliente. Devolve os candidatos e o grau de certeza.
 */
export async function identificarCaso(texto: string, nome?: string): Promise<{ certeza: Certeza; casos: any[]; pistas: { processos: number; cpfs: number } }> {
  const pistas = extrairPistas(`${texto || ''} ${nome || ''}`);
  // 1) Pelo número do processo
  if (pistas.processos.length) {
    const [procs] = await db.query(
      `SELECT DISTINCT lp.case_id FROM legal_processes lp
        WHERE REGEXP_REPLACE(lp.process_number, '[^0-9]', '') IN (?) AND lp.case_id IS NOT NULL`, [pistas.processos]
    ) as any;
    const ids = procs.map((p: any) => p.case_id);
    if (ids.length) {
      const [cl] = await db.query('SELECT DISTINCT client_id FROM cases WHERE id IN (?)', [ids]) as any;
      const casos = (await casosDosClientes(cl.map((c: any) => c.client_id))).filter((c: any) => ids.includes(c.caso_id));
      return { certeza: grauDeCerteza({ porProcesso: casos.length, porNome: 0 }), casos, pistas: { processos: pistas.processos.length, cpfs: pistas.cpfs.length } };
    }
  }
  // 2) Pelo CPF ou pelo nome do cliente
  let clientIds: number[] = [];
  if (pistas.cpfs.length) {
    const [r] = await db.query("SELECT id FROM clients WHERE REGEXP_REPLACE(COALESCE(cpf_cnpj,''), '[^0-9]', '') IN (?) LIMIT 5", [pistas.cpfs]) as any;
    clientIds = r.map((x: any) => x.id);
  }
  const n = String(nome || '').trim();
  if (!clientIds.length && n.length >= 3) {
    const [r] = await db.query('SELECT id FROM clients WHERE name LIKE ? ORDER BY id LIMIT 10', [`%${n}%`]) as any;
    clientIds = r.map((x: any) => x.id);
  }
  const casos = await casosDosClientes(clientIds);
  return { certeza: grauDeCerteza({ porProcesso: 0, porNome: casos.length }), casos, pistas: { processos: pistas.processos.length, cpfs: pistas.cpfs.length } };
}

/** Resumo de um caso para o Claude trabalhar: dados, processos, prazos abertos e últimas movimentações. */
export async function resumoDoCaso(caseId: number) {
  const [[c]] = await db.query(
    `SELECT c.id, c.title, c.legal_area, c.phase, c.status, c.production_stage, c.description, c.valor_causa, c.protocoled_at, cl.name AS cliente
       FROM cases c LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?`, [caseId]
  ) as any;
  if (!c) return null;
  const [procs] = await db.query('SELECT id, process_number, court, orgao_julgador, classe, phase, last_movement_at FROM legal_processes WHERE case_id = ?', [caseId]) as any;
  const [prazos] = await db.query("SELECT id, description, deadline_date, priority FROM deadlines WHERE case_id = ? AND status = 'pendente' ORDER BY deadline_date", [caseId]) as any;
  const procIds = procs.map((p: any) => p.id);
  const [movs] = procIds.length ? await db.query(
    `SELECT movement_date, title, LEFT(COALESCE(ai_summary, description, ''), 400) AS texto
       FROM process_movements WHERE process_id IN (?) ORDER BY movement_date DESC LIMIT 10`, [procIds]
  ) as any : [[]];
  return {
    caso_id: c.id, titulo: c.title, cliente: c.cliente, area: c.legal_area, fase: c.phase, situacao: c.status, etapa: c.production_stage,
    descricao: c.description ? String(c.description).slice(0, 1500) : null, valor_causa: c.valor_causa, protocolado_em: dia(c.protocoled_at),
    processos: procs.map((p: any) => ({ numero: p.process_number, juizo: p.orgao_julgador || p.court, classe: p.classe, fase: p.phase, ultima_movimentacao: dia(p.last_movement_at) })),
    prazos_abertos: prazos.map((p: any) => ({ id: p.id, descricao: p.description, vence_em: dia(p.deadline_date), prioridade: p.priority })),
    ultimas_movimentacoes: movs.map((m: any) => ({ data: dia(m.movement_date), titulo: m.title, texto: m.texto })),
  };
}
