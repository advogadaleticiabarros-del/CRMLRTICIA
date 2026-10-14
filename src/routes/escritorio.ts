import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { AGENTES, montarEscritorio, textoDaRotina, type AcaoAgente, type RunJob } from '../services/escritorioVirtual';
import { serieDiaria, resumoUsoIa } from '../services/painelIaRegras';

/**
 * Escritório virtual e Métricas da IA.
 *   GET /api/escritorio              → agentes com status e última ação (sala)
 *   GET /api/escritorio/agente/:id   → trabalho recente de um agente
 *   GET /api/escritorio/painel-ia    → métricas (?dias=7|30|90)
 * Cada consulta é isolada: se uma falhar, o resto aparece.
 */
const router = Router();

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// A Laya responde em LAYA_URL (127.0.0.1). Qualquer resposta HTTP conta como
// "no ar"; a checagem fica em cache por 1 minuto para a sala não martelar.
let cacheLaya: { em: number; online: boolean } | null = null;
async function layaOnline(): Promise<boolean> {
  const url = process.env.LAYA_URL;
  if (!url) return false;
  if (cacheLaya && Date.now() - cacheLaya.em < 60_000) return cacheLaya.online;
  const online = await fetch(url, { signal: AbortSignal.timeout(1500) }).then(() => true).catch(() => false);
  cacheLaya = { em: Date.now(), online };
  return online;
}

/** Ações dos agentes no período, incluindo as minutas do Estagiário (automation_runs). */
async function acoesDesde(horas: number): Promise<AcaoAgente[]> {
  const proprias = await safe(async () => {
    const [r] = await db.query('SELECT agente, texto, created_at FROM agente_acoes WHERE created_at >= NOW() - INTERVAL ? HOUR ORDER BY created_at DESC LIMIT 2000', [horas]) as any;
    return r as AcaoAgente[];
  }, []);
  const estagiario = await safe(async () => {
    const [r] = await db.query(
      `SELECT 'estagiario' AS agente, CONCAT(IF(status = 'ok', 'analisou a intimação e deixou a minuta', 'não conseguiu minutar'), IFNULL(CONCAT(' (', trigger_ref, ')'), '')) AS texto, created_at
         FROM automation_runs WHERE rule_key = 'estagiario_intimacao' AND created_at >= NOW() - INTERVAL ? HOUR ORDER BY created_at DESC LIMIT 500`, [horas]) as any;
    return r as AcaoAgente[];
  }, []);
  return [...proprias, ...estagiario];
}

router.get('/', async (_req: Request, res: Response) => {
  const runs = await safe(async () => {
    const [r] = await db.query('SELECT job, status, message, ran_at FROM job_runs WHERE ran_at >= NOW() - INTERVAL 26 HOUR ORDER BY ran_at DESC LIMIT 5000') as any;
    return r as RunJob[];
  }, []);
  const acoes = await acoesDesde(26);
  const agentes = montarEscritorio(runs, acoes, new Date(), { layaOnline: await layaOnline() });
  res.json({ agentes, atualizadoEm: new Date().toISOString() });
});

router.get('/agente/:id', async (req: Request, res: Response) => {
  const a = AGENTES.find((x) => x.id === req.params.id);
  if (!a) { res.status(404).json({ error: 'Agente não encontrado' }); return; }
  const runs = a.jobs.length ? await safe(async () => {
    const [r] = await db.query(
      `SELECT job, status, message, ran_at FROM job_runs WHERE job IN (${a.jobs.map(() => '?').join(',')}) ORDER BY ran_at DESC LIMIT 40`, a.jobs) as any;
    return r as RunJob[];
  }, []) : [];
  const acoes = (await acoesDesde(24 * 7)).filter((x) => x.agente === a.id).slice(0, 40);
  const historico = [
    ...runs.map((r) => ({ em: new Date(r.ran_at).toISOString(), texto: textoDaRotina(r.job, r.message), rotina: r.job, erro: r.status === 'erro' })),
    ...acoes.map((x) => ({ em: new Date(x.created_at).toISOString(), texto: x.texto, rotina: null, erro: false })),
  ].sort((x, y) => y.em.localeCompare(x.em)).slice(0, 40);
  const [agente] = montarEscritorio(runs, acoes, new Date(), { layaOnline: await layaOnline() }).filter((x) => x.id === a.id);
  res.json({ agente, rotinas: a.jobs, historico });
});

/** Dono de cada rotina, para contar o trabalho por agente. */
const DONO_DA_ROTINA = new Map(AGENTES.flatMap((a) => a.jobs.map((j) => [j, a] as const)));

router.get('/painel-ia', async (req: Request, res: Response) => {
  const dias = [7, 30, 90].includes(Number(req.query.dias)) ? Number(req.query.dias) : 30;
  const desde = `NOW() - INTERVAL ${dias} DAY`;
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const n = async (sql: string, params: any[] = []) => safe(async () => {
    const [[r]] = await db.query(sql, params) as any;
    return Number(r?.n || 0);
  }, 0);
  const grupos = async (sql: string, params: any[] = []) => safe(async () => {
    const [r] = await db.query(sql, params) as any;
    return (r as any[]).map((x) => ({ rotulo: String(x.rotulo ?? '—'), n: Number(x.n || 0) }));
  }, [] as { rotulo: string; n: number }[]);

  const usoPorProvedor = await safe(async () => {
    const [r] = await db.query(`SELECT provedor, SUM(chamadas) AS chamadas FROM ia_uso_diario WHERE dia >= DATE(${desde}) GROUP BY provedor`) as any;
    return r as { provedor: string; chamadas: number }[];
  }, []);
  const usoDiario = async (provedores: string[]) => serieDiaria(await safe(async () => {
    const [r] = await db.query(
      `SELECT dia, SUM(chamadas) AS chamadas FROM ia_uso_diario WHERE dia >= DATE(${desde}) AND provedor IN (${provedores.map(() => '?').join(',')}) GROUP BY dia`, provedores) as any;
    return r;
  }, []), dias, hoje);

  const trabalhoRotinas = await safe(async () => {
    const [r] = await db.query(`SELECT job, COUNT(*) AS n FROM job_runs WHERE ran_at >= ${desde} AND status = 'ok' GROUP BY job`) as any;
    return r as { job: string; n: number }[];
  }, []);
  const trabalhoAcoes = await safe(async () => {
    const [r] = await db.query(`SELECT agente, COUNT(*) AS n FROM agente_acoes WHERE created_at >= ${desde} GROUP BY agente`) as any;
    return r as { agente: string; n: number }[];
  }, []);
  const porAgente = new Map<string, number>();
  for (const r of trabalhoRotinas) { const a = DONO_DA_ROTINA.get(r.job); if (a) porAgente.set(a.id, (porAgente.get(a.id) || 0) + Number(r.n)); }
  for (const r of trabalhoAcoes) porAgente.set(r.agente, (porAgente.get(r.agente) || 0) + Number(r.n));
  const minutas = await n(`SELECT COUNT(*) AS n FROM automation_runs WHERE rule_key = 'estagiario_intimacao' AND status = 'ok' AND created_at >= ${desde}`);
  if (minutas) porAgente.set('estagiario', (porAgente.get('estagiario') || 0) + minutas);

  const uso = resumoUsoIa(usoPorProvedor);
  const prazos = await grupos(`SELECT status AS rotulo, COUNT(*) AS n FROM detected_deadlines WHERE created_at >= ${desde} GROUP BY status`);
  const intervencoes = prazos.filter((p) => p.rotulo !== 'a_confirmar').reduce((a, p) => a + p.n, 0);

  res.json({
    dias,
    kpis: {
      leads: await n(`SELECT COUNT(*) AS n FROM leads WHERE created_at >= ${desde}`),
      leadsQualificados: await n(`SELECT COUNT(*) AS n FROM leads WHERE created_at >= ${desde} AND ai_urgency IS NOT NULL`),
      leadsConvertidos: await n(`SELECT COUNT(*) AS n FROM leads WHERE created_at >= ${desde} AND status = 'convertido'`),
      decisoesLidas: await n(`SELECT COUNT(*) AS n FROM decisao_leituras WHERE created_at >= ${desde}`),
      movimentacoesAnalisadas: await n(`SELECT COUNT(*) AS n FROM process_movements WHERE created_at >= ${desde} AND ai_summary IS NOT NULL`),
      movimentacoesRecebidas: await n(`SELECT COUNT(*) AS n FROM process_movements WHERE created_at >= ${desde}`),
      minutasEstagiario: minutas,
      intervencoes,
      prazosConfirmados: prazos.find((p) => p.rotulo === 'confirmado')?.n || 0,
      prazosDescartados: prazos.find((p) => p.rotulo === 'descartado')?.n || 0,
      layaAcionada: uso.porProvedor.laya || 0,
      layaDecidiuSozinha: await n(`SELECT COUNT(*) AS n FROM agente_acoes WHERE agente = 'laya' AND created_at >= ${desde}`),
      iaPaga: uso.pagas,
      iaTotal: uso.total,
      percentualSemCusto: uso.percentualSemCusto,
    },
    uso,
    trabalhoPorAgente: AGENTES.filter((a) => !a.emConstrucao)
      .map((a) => ({ id: a.id, nome: a.nome, cargo: a.cargo, cor: a.cor, n: porAgente.get(a.id) || 0 }))
      .sort((x, y) => y.n - x.n),
    prazos,
    decisoes: await grupos(`SELECT favoravel AS rotulo, COUNT(*) AS n FROM decisao_leituras WHERE created_at >= ${desde} GROUP BY favoravel`),
    propostas: await grupos(`SELECT status AS rotulo, COUNT(*) AS n FROM propostas WHERE updated_at >= ${desde} GROUP BY status ORDER BY n DESC`),
    automacoes: await grupos(
      `SELECT CONCAT(COALESCE(MAX(r.name), ar.rule_key), IF(ar.status = 'ok', '', ' (falhou)')) AS rotulo, COUNT(*) AS n
         FROM automation_runs ar LEFT JOIN automation_rules r ON r.rule_key = ar.rule_key
        WHERE ar.created_at >= ${desde} GROUP BY ar.rule_key, ar.status ORDER BY n DESC LIMIT 8`),
    seriePaga: await usoDiario(['openai', 'openai_smart']),
    serieLaya: await usoDiario(['laya']),
    serieGratis: await usoDiario(['groq', 'gemini']),
  });
});

export default router;
