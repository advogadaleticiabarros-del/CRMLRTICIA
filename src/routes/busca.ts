import { Router, Request, Response } from 'express';
import { db } from '../config/database';

const router = Router();

/**
 * Busca global — o "assistente de bolso" pedido pela Dra. Letícia (29/09/2026):
 * de qualquer tela, um toque abre a busca e ela já vê cliente OU processo,
 * com a ÚLTIMA MOVIMENTAÇÃO em destaque, sem precisar navegar até a ficha.
 *
 * Corrigido em 29/09/2026 (achado real: busca lenta) — o `LIKE '%termo%'`
 * (contém, em qualquer posição) nunca usa índice, é sempre varredura completa
 * da tabela. Como quase sempre a advogada digita o COMEÇO do nome, prioriza
 * `LIKE 'termo%'` (prefixo — usa o índice normalmente) e só cai pro "contém"
 * quando o prefixo não traz resultado suficiente. Também trocou 4 subconsultas
 * correlacionadas (1 fase de banco por linha) por 2 buscas em lote (1 fase só,
 * pros até 8 processos already escolhidos) — menos idas e vindas ao banco.
 */
router.get('/', async (req: Request, res: Response) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) { res.json({ clients: [], cases: [] }); return; }
  const prefixo = `${q}%`;
  const contem = `%${q}%`;
  const soNumeros = q.replace(/\D/g, '');

  const clients = await buscarClientes(prefixo, contem, soNumeros);
  const cases = await buscarCasos(prefixo, contem);
  await anexarUltimaMovimentacao(cases);

  res.json({ clients, cases });
});

async function buscarClientes(prefixo: string, contem: string, soNumeros: string): Promise<any[]> {
  // Prefixo primeiro (usa índice — rápido mesmo com muitos cadastros).
  const [porPrefixo] = await db.query(
    `SELECT id, name, tipo, cpf_cnpj, phone, status FROM clients
      WHERE name LIKE ? ORDER BY name ASC LIMIT 8`, [prefixo]
  ) as any;
  if (porPrefixo.length >= 5) return porPrefixo;

  const where = ['name LIKE ?', 'phone LIKE ?'];
  const params: any[] = [contem, `%${soNumeros}%`];
  if (soNumeros.length >= 3) { where.push('cpf_cnpj LIKE ?'); params.push(`%${soNumeros}%`); }
  const [porConteudo] = await db.query(
    `SELECT id, name, tipo, cpf_cnpj, phone, status FROM clients
      WHERE (${where.join(' OR ')}) ORDER BY name ASC LIMIT ${8 - porPrefixo.length}`, params
  ) as any;
  const vistos = new Set(porPrefixo.map((c: any) => c.id));
  return [...porPrefixo, ...porConteudo.filter((c: any) => !vistos.has(c.id))];
}

async function buscarCasos(prefixo: string, contem: string): Promise<any[]> {
  const base = `SELECT c.id, c.title, c.case_number, c.legal_area, c.phase, c.status, c.client_id, cl.name AS client_name
       FROM cases c JOIN clients cl ON cl.id = c.client_id`;
  const [porPrefixo] = await db.query(
    `${base} WHERE c.title LIKE ? OR c.case_number LIKE ? OR cl.name LIKE ?
      ORDER BY c.updated_at DESC LIMIT 8`, [prefixo, prefixo, prefixo]
  ) as any;
  if (porPrefixo.length >= 5) return porPrefixo;

  const [porConteudo] = await db.query(
    `${base} WHERE c.title LIKE ? OR c.case_number LIKE ? OR cl.name LIKE ?
      ORDER BY c.updated_at DESC LIMIT ${8 - porPrefixo.length}`, [contem, contem, contem]
  ) as any;
  const vistos = new Set(porPrefixo.map((c: any) => c.id));
  return [...porPrefixo, ...porConteudo.filter((c: any) => !vistos.has(c.id))];
}

/**
 * Preenche `ultima_movimentacao` em lote (2 consultas no total, não 1 por
 * processo): a interna (case_movements, lançada manualmente) e a do
 * monitoramento automático (process_movements, via legal_processes
 * vinculado) — usa a mais recente das duas, seja qual for.
 */
async function anexarUltimaMovimentacao(cases: any[]): Promise<void> {
  if (!cases.length) return;
  const ids = cases.map((c) => c.id);
  const placeholders = ids.map(() => '?').join(',');

  const [internas] = await db.query(
    `SELECT cm.case_id, cm.description, COALESCE(cm.movement_date, cm.created_at) AS data
       FROM case_movements cm
       JOIN (SELECT case_id, MAX(COALESCE(movement_date, created_at)) AS maxd
               FROM case_movements WHERE case_id IN (${placeholders}) GROUP BY case_id) u
         ON u.case_id = cm.case_id AND COALESCE(cm.movement_date, cm.created_at) = u.maxd`,
    ids
  ) as any;

  const [monitor] = await db.query(
    `SELECT lp.case_id, pm.description, COALESCE(pm.movement_date, pm.created_at) AS data
       FROM legal_processes lp
       JOIN process_movements pm ON pm.process_id = lp.id
       JOIN (SELECT lp2.case_id AS cid, MAX(COALESCE(pm2.movement_date, pm2.created_at)) AS maxd
               FROM legal_processes lp2 JOIN process_movements pm2 ON pm2.process_id = lp2.id
              WHERE lp2.case_id IN (${placeholders}) GROUP BY lp2.case_id) u
         ON u.cid = lp.case_id AND COALESCE(pm.movement_date, pm.created_at) = u.maxd`,
    ids
  ) as any;

  const porCaso = new Map<number, { description: string; data: any }>();
  for (const r of internas) porCaso.set(r.case_id, { description: r.description, data: r.data });
  for (const r of monitor) {
    const atual = porCaso.get(r.case_id);
    if (!atual || new Date(r.data).getTime() > new Date(atual.data).getTime()) {
      porCaso.set(r.case_id, { description: r.description, data: r.data });
    }
  }
  for (const c of cases) {
    const m = porCaso.get(c.id);
    c.ultima_movimentacao = m?.description || null;
    c.ultima_movimentacao_data = m?.data || null;
  }
}

export default router;
