import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { AGENTES, montarEscritorio, textoDaRotina, type AcaoAgente, type MetricaAgente, type RunJob } from '../services/escritorioVirtual';
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

// "Hoje" no horário de Brasília (o banco grava em UTC), como em routes/hoje.ts.
const local = (col: string) => `DATE(CONVERT_TZ(${col},'+00:00','-03:00'))`;
const HOJE = "DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))";

/** Números de cada agente para o cartão abaixo da sala. Cada consulta é isolada. */
async function metricasDosAgentes(): Promise<Record<string, MetricaAgente[]>> {
  const n = (sql: string, params: any[] = []) => safe(async () => {
    const [[r]] = await db.query(sql, params) as any;
    return Number(r?.n || 0);
  }, 0);
  const execHoje = (jobs: string[]) => n(
    `SELECT COUNT(*) AS n FROM job_runs WHERE status = 'ok' AND job IN (${jobs.map(() => '?').join(',')}) AND ${local('ran_at')} = ${HOJE}`, jobs);
  const acoesHoje = (agente: string) => n(`SELECT COUNT(*) AS n FROM agente_acoes WHERE agente = ? AND ${local('created_at')} = ${HOJE}`, [agente]);
  const { getBriefingExtras } = await import('../services/briefingExtras');
  const extras: any = await safe(() => getBriefingExtras(), null);
  const jobsDe = (id: string) => AGENTES.find((a) => a.id === id)?.jobs || [];
  const m = (...pares: Array<[number, string]>) => pares.map(([valor, rotulo]) => ({ n: valor, rotulo }));

  return {
    laya: m(
      [await n(`SELECT COALESCE(SUM(chamadas),0) AS n FROM ia_uso_diario WHERE provedor = 'laya' AND dia = ${HOJE}`), 'consultas hoje'],
      [await acoesHoje('laya'), 'decidiu sozinha hoje'],
      [await n(`SELECT COALESCE(SUM(chamadas),0) AS n FROM ia_uso_diario WHERE provedor = 'laya'`), 'consultas no total']),
    secretaria: m(
      [await acoesHoje('secretaria'), 'leituras entregues hoje'],
      [await execHoje(jobsDe('secretaria')), 'resumos enviados hoje']),
    leitor: m(
      [await n(`SELECT COUNT(*) AS n FROM decisao_leituras WHERE ${local('created_at')} = ${HOJE}`), 'decisões lidas hoje'],
      [await n('SELECT COUNT(*) AS n FROM decisao_leituras'), 'lidas no total']),
    djen: m(
      [await n(`SELECT COUNT(*) AS n FROM process_movements WHERE source = 'djen_oab' AND ${local('created_at')} = ${HOJE}`), 'publicações novas hoje'],
      [await execHoje(jobsDe('djen')), 'varreduras hoje']),
    tribunais: m(
      [await n(`SELECT COUNT(*) AS n FROM process_movements WHERE source <> 'djen_oab' AND ${local('created_at')} = ${HOJE}`), 'movimentações novas hoje'],
      [await n("SELECT COUNT(*) AS n FROM legal_processes WHERE status = 'ativo' AND monitoring_enabled = 1"), 'processos vigiados']),
    email: m([await execHoje(jobsDe('email')), 'leituras do e-mail hoje']),
    carteira: m(
      [await n(`SELECT COUNT(*) AS n FROM vigia_alertas WHERE ${local('created_at')} = ${HOJE}`), 'avisos hoje'],
      [await n('SELECT COUNT(*) AS n FROM vigia_alertas WHERE created_at >= NOW() - INTERVAL 30 DAY'), 'avisos em 30 dias']),
    prazos: m(
      [await n("SELECT COUNT(*) AS n FROM detected_deadlines WHERE status = 'a_confirmar'"), 'prazos a confirmar'],
      [await n("SELECT COUNT(*) AS n FROM deadlines WHERE status = 'pendente' AND deadline_date BETWEEN NOW() AND NOW() + INTERVAL 7 DAY"), 'vencem em 7 dias']),
    estagiario: m(
      [await n(`SELECT COUNT(*) AS n FROM automation_runs WHERE rule_key = 'estagiario_intimacao' AND status = 'ok' AND ${local('created_at')} = ${HOJE}`), 'minutas hoje'],
      [await n("SELECT COUNT(*) AS n FROM automation_runs WHERE rule_key = 'estagiario_intimacao' AND status = 'ok' AND created_at >= NOW() - INTERVAL 30 DAY"), 'minutas em 30 dias']),
    agenda: m(
      [await n(`SELECT COUNT(*) AS n FROM calendar_events WHERE sync_status <> 'cancelado' AND ${local('start_datetime')} = ${HOJE}`), 'compromissos hoje'],
      [await n("SELECT COUNT(*) AS n FROM calendar_events WHERE event_type = 'audiencia' AND sync_status <> 'cancelado' AND start_datetime BETWEEN NOW() AND NOW() + INTERVAL 7 DAY"), 'audiências em 7 dias']),
    financeiro: m(
      [Number(extras?.parcelasAtrasadas?.qtd || 0), 'parcelas atrasadas'],
      [Number(extras?.repassesCliente?.qtd || 0), 'repasses a fazer']),
    comercial: m(
      [await n("SELECT COUNT(*) AS n FROM propostas WHERE status IN ('enviada','em_negociacao')"), 'propostas em aberto'],
      [await n("SELECT COUNT(*) AS n FROM propostas WHERE status = 'aceita' AND updated_at >= NOW() - INTERVAL 30 DAY"), 'aceitas em 30 dias']),
    whatsapp: m(
      [await n(`SELECT COUNT(*) AS n FROM whatsapp_messages WHERE ${local('created_at')} = ${HOJE}`), 'mensagens hoje'],
      [Array.isArray(extras?.whatsappAguardando) ? extras.whatsappAguardando.length : 0, 'esperando resposta']),
    assistente: m([await execHoje(jobsDe('assistente')), 'lembretes hoje']),
    parcerias: m([await execHoje(jobsDe('parcerias')), 'avisos hoje']),
    relatorios: m([await execHoje(jobsDe('relatorios')), 'rotinas hoje']),
    cerebro: m(
      [await n('SELECT COUNT(*) AS n FROM cerebro_notas'), 'notas na biblioteca'],
      [await n(`SELECT COUNT(*) AS n FROM agente_acoes WHERE agente = 'cerebro' AND texto LIKE 'respondeu%' AND ${local('created_at')} = ${HOJE}`), 'perguntas hoje'],
      [await n(`SELECT COUNT(*) AS n FROM agente_acoes WHERE agente = 'cerebro' AND texto LIKE 'repassou%' AND ${local('created_at')} = ${HOJE}`), 'repasses hoje']),
    produtor: m(
      [await n(`SELECT COUNT(*) AS n FROM agente_acoes WHERE agente = 'produtor' AND texto LIKE 'montou%' AND ${local('created_at')} = ${HOJE}`), 'propostas montadas hoje'],
      [await n("SELECT COUNT(*) AS n FROM propostas WHERE status = 'rascunho' AND observacoes LIKE 'Produzida pelo agente%'"), 'esperando aprovação']),
    fechador: m(
      [await n("SELECT COUNT(*) AS n FROM contracts WHERE status = 'em_producao'"), 'contratos para revisar'],
      [await n("SELECT COUNT(*) AS n FROM contracts WHERE status IN ('enviado_assinatura','finalizado')"), 'esperando assinatura']),
    coletor: m(
      [await n(`SELECT COUNT(*) AS n FROM agente_acoes WHERE agente = 'coletor' AND texto LIKE 'completou a ficha%' AND ${local('created_at')} = ${HOJE}`), 'fichas completadas hoje'],
      [await n("SELECT COUNT(*) AS n FROM ficha_pendencias WHERE status = 'pendente'"), 'dados para conferir'],
      [await n('SELECT COUNT(*) AS n FROM coletas_documentos WHERE concluido_em IS NULL'), 'coletas em andamento'],
      [await n('SELECT COUNT(*) AS n FROM coletas_documentos WHERE concluido_em >= NOW() - INTERVAL 30 DAY'), 'completas em 30 dias']),
    atendente: m(
      [await n("SELECT COUNT(*) AS n FROM atendente_rascunhos WHERE status = 'pendente'"), 'respostas para aprovar'],
      [await n(`SELECT COUNT(*) AS n FROM atendente_rascunhos WHERE status IN ('enviada','editada') AND ${local('decidido_em')} = ${HOJE}`), 'enviadas hoje'],
      [await n("SELECT COUNT(*) AS n FROM agente_memorias WHERE agente = 'atendente'"), 'aprendizados']),
    negociador: m(
      [await n("SELECT COUNT(*) AS n FROM atendente_rascunhos WHERE agente = 'negociador' AND status = 'pendente'"), 'respostas para aprovar'],
      [await n("SELECT COUNT(*) AS n FROM propostas WHERE status = 'em_negociacao'"), 'em negociação'],
      [await n("SELECT COUNT(*) AS n FROM propostas WHERE status = 'aceita' AND id IN (SELECT proposta_id FROM atendente_rascunhos WHERE agente = 'negociador') AND updated_at >= NOW() - INTERVAL 30 DAY"), 'fechadas após objeção (30 dias)']),
    copiloto: m(
      [await n(`SELECT COUNT(*) AS n FROM leads WHERE ${local('capacidade_em')} = ${HOJE}`), 'qualificados hoje'],
      [await n(`SELECT COUNT(*) AS n FROM agente_acoes WHERE agente = 'copiloto' AND texto LIKE 'sugeriu%' AND ${local('created_at')} = ${HOJE}`), 'sugestões à Dra. hoje'],
      [await n("SELECT COUNT(*) AS n FROM leads WHERE fechamento_pct >= 70 AND status NOT IN ('perdida','convertido','fechada','contrato_assinado','newsletter')"), 'com chance alta (70%+)']),
    analista: m(
      [await n(`SELECT COUNT(*) AS n FROM analises_documentos WHERE ${local('created_at')} = ${HOJE}`), 'análises hoje'],
      [await n('SELECT COALESCE(SUM(graves),0) AS n FROM analises_documentos WHERE created_at >= NOW() - INTERVAL 30 DAY'), 'pontos graves em 30 dias'],
      [await n('SELECT COUNT(*) AS n FROM documento_leituras'), 'documentos lidos']),
    guardiao: m(
      [await n(`SELECT COUNT(*) AS n FROM job_runs WHERE job = 'backup:diario' AND status = 'ok' AND ${local('ran_at')} = ${HOJE}`), 'cópias hoje'],
      [await n("SELECT COUNT(*) AS n FROM job_runs WHERE job = 'backup:prova-de-restauracao' AND status = 'ok' AND ran_at >= NOW() - INTERVAL 30 DAY"), 'provas de restauração em 30 dias'],
      [await n('SELECT COUNT(*) AS n FROM erros_sistema WHERE resolvido = 0'), 'erros do sistema em aberto']),
  };
}

router.get('/', async (_req: Request, res: Response) => {
  const runs = await safe(async () => {
    const [r] = await db.query('SELECT job, status, message, ran_at FROM job_runs WHERE ran_at >= NOW() - INTERVAL 26 HOUR ORDER BY ran_at DESC LIMIT 5000') as any;
    return r as RunJob[];
  }, []);
  const acoes = await acoesDesde(26);
  const agentes = montarEscritorio(runs, acoes, new Date(), { layaOnline: await layaOnline(), metricas: await metricasDosAgentes() });
  res.json({ agentes, atualizadoEm: new Date().toISOString() });
});

// ── Mural da equipe: conversas entre agentes, última reunião e memórias ─────
router.get('/mural', async (_req: Request, res: Response) => {
  try { res.json(await (await import('../services/sociedadeServico')).mural()); } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Reunião da equipe agora (botão "Reunir a equipe")
router.post('/reuniao', async (_req: Request, res: Response) => {
  try { res.json(await (await import('../services/sociedadeServico')).reuniaoDiaria(true)); } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Dra. Camila: ficha automática (o que não foi gravado sozinho) ───────────
router.get('/ficha-pendencias', async (_req: Request, res: Response) => {
  try { res.json(await (await import('../services/fichaServico')).listarPendencias()); } catch (e: any) { res.status(500).json({ error: e.message }); }
});
router.post('/ficha-pendencias/:id/:acao', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const acao = req.params.acao === 'aplicar' ? 'aplicar' : req.params.acao === 'ignorar' ? 'ignorar' : null;
  if (!Number.isInteger(id) || id <= 0 || !acao) { res.status(400).json({ error: 'Pedido inválido' }); return; }
  try {
    const r = await (await import('../services/fichaServico')).decidirPendencia(id, acao, req.user?.name || 'equipe');
    if (!r.ok) { res.status(400).json({ error: r.erro }); return; }
    res.json(r);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});
// Completar a ficha de um contato agora (botão), mesmo sem mensagem nova.
router.post('/ficha/:phone', async (req: Request, res: Response) => {
  try { res.json(await (await import('../services/fichaServico')).completarFicha(String(req.params.phone), { forcar: true })); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Dr. Otávio: possíveis clientes qualificados em % ────────────────────────
router.get('/copiloto', async (_req: Request, res: Response) => {
  try { res.json(await (await import('../services/copilotoServico')).qualificados()); } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Dra. Helena: análises dos documentos ────────────────────────────────────
router.get('/analista', async (_req: Request, res: Response) => {
  try { res.json(await (await import('../services/analistaServico')).analisesRecentes()); } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Analisar um caso agora (botão na tela). Não manda pedido de reenvio ao cliente.
router.post('/analista/:caseId', async (req: Request, res: Response) => {
  const id = Number(req.params.caseId);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'Caso inválido' }); return; }
  try {
    const r = await (await import('../services/analistaServico')).analisarCaso(id, { avisar: req.body?.avisar === true, pedirReenvio: false });
    if (!r.ok) { res.status(400).json({ error: r.erro }); return; }
    res.json(r);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
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
