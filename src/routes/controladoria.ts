import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { rentabilidadeClientes, rentabilidadeProcessos, centroCusto, provisionamentoResumo } from '../services/controladoriaService';

const router = Router();

const TYPES = ['ganho', 'perda'];
const LIKELIHOODS = ['provavel', 'possivel', 'remoto'];

// ── Produtividade da equipe (mês) ───────────────────────────────────────────
// Cruza o que já é registrado automaticamente: movimentos na esteira
// (production_notes), eventos da jornada (journey_log) e prazos cumpridos.
router.get('/produtividade', async (req: Request, res: Response) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : new Date().toISOString().slice(0, 7);

  const porUsuario: Record<string, any> = {};
  const u = (nome: string) => {
    const k = nome || '—';
    if (!porUsuario[k]) porUsuario[k] = { usuario: k, movimentos_esteira: 0, protocolos: 0, prazos_cumpridos: 0, eventos_jornada: 0, notas_producao: 0 };
    return porUsuario[k];
  };

  const [movs] = await db.query(`
    SELECT author_name, COUNT(*) AS n,
           SUM(CASE WHEN text LIKE '%→ Protocolado%' THEN 1 ELSE 0 END) AS protocolos
      FROM production_notes
     WHERE kind = 'atualizacao' AND text LIKE 'Movido na esteira%' AND DATE_FORMAT(created_at, '%Y-%m') = ?
     GROUP BY author_name`, [month]).catch(() => [[]]) as any;
  for (const r of movs) { const x = u(r.author_name); x.movimentos_esteira = Number(r.n); x.protocolos = Number(r.protocolos); }

  const [notas] = await db.query(`
    SELECT author_name, COUNT(*) AS n FROM production_notes
     WHERE kind IN ('observacao','pendencia') AND DATE_FORMAT(created_at, '%Y-%m') = ?
     GROUP BY author_name`, [month]).catch(() => [[]]) as any;
  for (const r of notas) u(r.author_name).notas_producao = Number(r.n);

  const [jl] = await db.query(`
    SELECT actor_name, COUNT(*) AS n FROM journey_log
     WHERE actor_name IS NOT NULL AND DATE_FORMAT(created_at, '%Y-%m') = ?
     GROUP BY actor_name`, [month]).catch(() => [[]]) as any;
  for (const r of jl) u(r.actor_name).eventos_jornada = Number(r.n);

  const [prazos] = await db.query(`
    SELECT us.name AS author_name, COUNT(*) AS n
      FROM deadlines d JOIN users us ON us.id = d.user_id
     WHERE d.status = 'cumprido' AND DATE_FORMAT(d.updated_at, '%Y-%m') = ?
     GROUP BY us.name`, [month]).catch(() => [[]]) as any;
  for (const r of prazos) u(r.author_name).prazos_cumpridos = Number(r.n);

  // Etapas com casos parados (contexto do gargalo, não por pessoa)
  const [gargalos] = await db.query(`
    SELECT production_stage AS etapa, COUNT(*) AS casos, MAX(DATEDIFF(NOW(), production_started_at)) AS mais_antigo_dias
      FROM cases
     WHERE production_stage IN ('em_analise','separacao_documentos','criacao_inicial','revisao_inicial','aguardando_protocolo')
     GROUP BY production_stage`).catch(() => [[]]) as any;

  // ── GAMIFICAÇÃO: pontos por atividade (estilo taskscore) ──────────────────
  // Protocolo vale mais (é a entrega final); prazo cumprido protege o
  // escritório; movimento na esteira e notas mantêm o fluxo vivo.
  const PONTOS = { protocolo: 25, prazo_cumprido: 15, movimento: 5, nota: 3, evento: 1 };
  const usuarios = Object.values(porUsuario).map((u: any) => ({
    ...u,
    pontos: u.protocolos * PONTOS.protocolo
          + u.prazos_cumpridos * PONTOS.prazo_cumprido
          + (u.movimentos_esteira - u.protocolos) * PONTOS.movimento
          + u.notas_producao * PONTOS.nota
          + Math.min(u.eventos_jornada, 200) * PONTOS.evento,
  })).sort((a: any, b: any) => b.pontos - a.pontos);

  res.json({
    month,
    usuarios,
    pontuacao: PONTOS,
    gargalos,
  });
});

// ── Rentabilidade ───────────────────────────────────────────────────────────
router.get('/rentabilidade/clientes', async (_req: Request, res: Response) => {
  res.json(await rentabilidadeClientes());
});
router.get('/rentabilidade/processos', async (_req: Request, res: Response) => {
  res.json(await rentabilidadeProcessos());
});

// ── Centro de custo ─────────────────────────────────────────────────────────
router.get('/centro-custo', async (_req: Request, res: Response) => {
  res.json(await centroCusto());
});

// ── Provisionamento ─────────────────────────────────────────────────────────
router.get('/provisoes/resumo', async (_req: Request, res: Response) => {
  res.json(await provisionamentoResumo());
});

router.get('/provisoes', async (req: Request, res: Response) => {
  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (req.query.case_id) { where.push('p.case_id = ?'); params.push(req.query.case_id); }
  if (req.query.type && TYPES.includes(req.query.type as string)) { where.push('p.type = ?'); params.push(req.query.type); }
  const [rows] = await db.query(
    `SELECT p.*, c.title AS case_title, cl.name AS client_name
       FROM case_provisions p
       LEFT JOIN cases c ON c.id = p.case_id
       LEFT JOIN clients cl ON cl.id = p.client_id
      WHERE ${where.join(' AND ')} ORDER BY p.value DESC LIMIT 300`, params
  ) as any;
  res.json(rows);
});

router.post('/provisoes', async (req: Request, res: Response) => {
  const { case_id, client_id, type, likelihood, value, description } = req.body;
  if (!TYPES.includes(type)) { res.status(400).json({ error: "type deve ser 'ganho' ou 'perda'" }); return; }
  if (!LIKELIHOODS.includes(likelihood)) { res.status(400).json({ error: 'likelihood inválido' }); return; }

  // Se veio case_id e não client_id, herda o cliente do caso
  let clientId = client_id ?? null;
  if (case_id && !clientId) {
    const [[c]] = await db.query('SELECT client_id FROM cases WHERE id = ?', [case_id]) as any;
    clientId = c?.client_id ?? null;
  }

  const [result] = await db.query(
    `INSERT INTO case_provisions (case_id, client_id, type, likelihood, value, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [case_id ?? null, clientId, type, likelihood, Number(value) || 0, description ?? null, req.user!.id]
  ) as any;
  const [rows] = await db.query('SELECT * FROM case_provisions WHERE id = ?', [result.insertId]) as any;
  res.status(201).json(rows[0]);
});

router.put('/provisoes/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const [existing] = await db.query('SELECT id FROM case_provisions WHERE id = ?', [id]) as any;
  if (!existing.length) { res.status(404).json({ error: 'Provisão não encontrada' }); return; }
  const fields: string[] = []; const params: any[] = [];
  const setIf = (col: string, val: any, valid = true) => { if (val !== undefined && valid) { fields.push(`${col} = ?`); params.push(val); } };
  setIf('type', req.body.type, TYPES.includes(req.body.type));
  setIf('likelihood', req.body.likelihood, LIKELIHOODS.includes(req.body.likelihood));
  setIf('value', req.body.value !== undefined ? Number(req.body.value) : undefined);
  setIf('description', req.body.description);
  if (!fields.length) { res.status(400).json({ error: 'Nenhum campo válido' }); return; }
  params.push(id);
  await db.query(`UPDATE case_provisions SET ${fields.join(', ')} WHERE id = ?`, params);
  const [rows] = await db.query('SELECT * FROM case_provisions WHERE id = ?', [id]) as any;
  res.json(rows[0]);
});

router.delete('/provisoes/:id', async (req: Request, res: Response) => {
  const [r] = await db.query('DELETE FROM case_provisions WHERE id = ?', [req.params.id]) as any;
  if (!r.affectedRows) { res.status(404).json({ error: 'Provisão não encontrada' }); return; }
  res.json({ success: true, id: Number(req.params.id) });
});

export default router;
