import { Router, Request, Response } from 'express';
import mammoth from 'mammoth';
import { db } from '../config/database';
import { aiEmbed } from '../services/aiAssistant';
import { stripDataUrlPrefix } from '../utils/dataUrl';

const router = Router();

// Mesmo mapeamento de scripts/import-pecas-obsidian.mjs — mantido igual (não
// compartilhado em módulo porque um é script CLI e o outro é rota HTTP, mas
// PRECISA ficar sincronizado se uma área nova for adicionada em algum dos dois).
const AREA_MAP: Record<string, string> = {
  'previdenciário': 'previdenciario', 'previdenciario': 'previdenciario',
  'trabalhista': 'trabalhista', 'consumidor': 'consumidor', 'bancário': 'consumidor',
  'família': 'familia', 'familia': 'familia', 'cível': 'civel', 'civel': 'civel',
  'execução': 'execucao', 'execucao': 'execucao',
  'extrajudicial': 'extrajudicial',
};

/**
 * Biblioteca de modelos de peças — destino da importação (do cofre Obsidian,
 * via script local ou via pasta do Drive). No futuro, alimenta a IA que gera
 * as petições, para escrever no estilo/tese da advogada.
 */

// ── GET /api/peca-modelos — lista os modelos (filtros opcionais por área/assunto)
router.get('/', async (req: Request, res: Response) => {
  try {
    const { area, assunto, q } = req.query as any;
    const where: string[] = []; const params: any[] = [];
    if (area)    { where.push('area = ?'); params.push(area); }
    if (assunto) { where.push('assunto LIKE ?'); params.push(`%${assunto}%`); }
    if (q)       { where.push('(titulo LIKE ? OR conteudo LIKE ? OR teses LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const sql = `SELECT id, external_key, titulo, area, assunto, tipo, rito, tribunal, teses, fundamentos,
                        CHAR_LENGTH(conteudo) AS tamanho, fonte, updated_at
                   FROM peca_modelos ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                  ORDER BY area, assunto, titulo`;
    const [rows] = await db.query(sql, params) as any;
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e?.message || 'Erro ao listar modelos' }); }
});

// ── GET /api/peca-modelos/resumo — total, por área, última atualização ──────
// Precisa vir ANTES de "/:id" — senão o Express casa "resumo" como se fosse
// um id (bug clássico de ordem de rota; ver docs/manual/14-runbook.md se
// acontecer de novo em outro arquivo de rotas).
router.get('/resumo', async (_req: Request, res: Response) => {
  const [[tot]] = await db.query('SELECT COUNT(*) AS total, MAX(updated_at) AS ultima_atualizacao FROM peca_modelos') as any;
  const [porArea] = await db.query('SELECT area, COUNT(*) AS n FROM peca_modelos GROUP BY area ORDER BY n DESC') as any;
  res.json({ total: Number(tot.total), ultima_atualizacao: tot.ultima_atualizacao, por_area: porArea });
});

// ── GET /api/peca-modelos/:id — um modelo completo (com o texto)
router.get('/:id', async (req: Request, res: Response) => {
  const [[m]] = await db.query('SELECT * FROM peca_modelos WHERE id = ?', [req.params.id]) as any;
  if (!m) { res.status(404).json({ error: 'Modelo não encontrado' }); return; }
  res.json(m);
});

// ── POST /api/peca-modelos/import — upsert em lote (idempotente por external_key)
router.post('/import', async (req: Request, res: Response) => {
  try {
    const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
    if (!itens.length) { res.status(400).json({ error: 'Envie { itens: [...] }' }); return; }
    let inseridos = 0, atualizados = 0;
    for (const it of itens) {
      const key = String(it.external_key || it.arquivo || it.titulo || '').trim();
      if (!key) continue;
      const teses = Array.isArray(it.teses) ? it.teses.join('; ') : (it.teses || null);
      const fund  = Array.isArray(it.fundamentos) ? it.fundamentos.join('; ') : (it.fundamentos || null);
      const [r] = await db.query(
        `INSERT INTO peca_modelos (external_key, titulo, area, assunto, tipo, rito, tribunal, teses, fundamentos, conteudo, fonte)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE titulo=VALUES(titulo), area=VALUES(area), assunto=VALUES(assunto),
           tipo=VALUES(tipo), rito=VALUES(rito), tribunal=VALUES(tribunal), teses=VALUES(teses),
           fundamentos=VALUES(fundamentos), conteudo=VALUES(conteudo), fonte=VALUES(fonte)`,
        [key, String(it.titulo || key), it.area || null, it.assunto || null, it.tipo || null,
         it.rito || null, it.tribunal || null, teses, fund, it.conteudo || null, it.fonte || 'obsidian']
      ) as any;
      // affectedRows: 1 = inserido, 2 = atualizado (MySQL)
      if (r.affectedRows === 1) inseridos++; else atualizados++;
    }
    res.json({ success: true, inseridos, atualizados, total: itens.length });
  } catch (e: any) { res.status(500).json({ error: e?.message || 'Erro ao importar modelos' }); }
});

// ── POST /api/peca-modelos/import-ficha — reimportação direto do Obsidian ───
// Achado na pesquisa de módulos (22/09/2026): a única forma de atualizar a
// biblioteca de peças era rodar scripts/import-pecas-obsidian.mjs manualmente
// no terminal — mudança feita no cofre Obsidian nunca chegava na IA sozinha.
// Esta rota faz o MESMO trabalho (extrai o .docx, calcula embedding, upsert
// idempotente por external_key) mas recebe uma ficha por vez, vinda do
// seletor de pasta no navegador (Configurações → Biblioteca de peças), pra
// ela poder reimportar sem terminal nem SSH.
router.post('/import-ficha', async (req: Request, res: Response) => {
  try {
    const { external_key, titulo, area, assunto, tipo, rito, teses, fundamentos, docx_base64 } = req.body || {};
    const key = String(external_key || titulo || '').trim();
    if (!key) { res.status(400).json({ error: 'Informe external_key ou titulo' }); return; }

    let conteudo: string | null = null;
    if (docx_base64) {
      try {
        const buffer = Buffer.from(stripDataUrlPrefix(docx_base64), 'base64');
        const r = await mammoth.extractRawText({ buffer });
        conteudo = r.value.replace(/\n{3,}/g, '\n\n').trim().slice(0, 120000);
      } catch { /* docx corrompido/ilegível — segue sem conteúdo, ficha ainda entra */ }
    }

    const areaNormalizada = AREA_MAP[String(area || '').toLowerCase()] || null;
    const embTexto = [titulo, assunto, teses, fundamentos].filter(Boolean).join('\n');
    const embedding = await aiEmbed(embTexto);

    const [r] = await db.query(
      `INSERT INTO peca_modelos (external_key, titulo, area, assunto, tipo, rito, tribunal, teses, fundamentos, conteudo, embedding, embedded_at, fonte)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'obsidian')
       ON DUPLICATE KEY UPDATE titulo=VALUES(titulo), area=VALUES(area), assunto=VALUES(assunto),
         tipo=VALUES(tipo), rito=VALUES(rito), teses=VALUES(teses), fundamentos=VALUES(fundamentos),
         conteudo=COALESCE(VALUES(conteudo), conteudo),
         embedding=COALESCE(VALUES(embedding), embedding), embedded_at=COALESCE(VALUES(embedded_at), embedded_at)`,
      [key, String(titulo || key), areaNormalizada, assunto || null, tipo || null, rito || null, null,
       Array.isArray(teses) ? teses.join('; ') : (teses || null),
       Array.isArray(fundamentos) ? fundamentos.join('; ') : (fundamentos || null),
       conteudo, embedding ? JSON.stringify(embedding) : null, embedding ? new Date() : null]
    ) as any;

    res.json({ success: true, criado: r.affectedRows === 1, teve_docx: !!conteudo, teve_embedding: !!embedding });
  } catch (e: any) { res.status(500).json({ error: e?.message || 'Erro ao importar ficha' }); }
});

export default router;
