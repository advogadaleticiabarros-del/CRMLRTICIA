import { Router, Request, Response } from 'express';
import { ATALHOS, type Esfera } from '../services/leisTexto';

/**
 * Pesquisa de Leis (acervo público ctresb/leis).
 *   GET  /api/leis/estado                       → pronto? quantas normas, quando atualizou
 *   GET  /api/leis/buscar?q=&esferas=&vigentes=  → artigos e súmulas (citação digitada vai direto)
 *   GET  /api/leis/atalhos                      → CF, CLT, CPC... com o id de cada uma
 *   GET  /api/leis/norma/:id                    → cabeçalho + sumário dos artigos
 *   GET  /api/leis/dispositivo/:id              → texto integral + citação formatada
 *   POST /api/leis/conferir    { texto }         → Dra. Vera: cada citação da peça
 *   POST /api/leis/fundamentos { texto, area, tipo } → Dra. Júlia: dispositivos conferidos
 *   POST /api/leis/atualizar   { completo? }     → só admin; roda em segundo plano
 */
const router = Router();
const svc = () => import('../services/leisServico');
const ESFERAS: Esfera[] = ['constituicao', 'federal', 'estadual', 'jurisprudencia', 'regulador'];

// 409 (e não 503): acervo baixando é estado esperado, não falha — o rastreador de erros só pega 5xx.
async function acervoOu503(res: Response) {
  const a = (await svc()).acervoAberto();
  if (!a || !a.resumo().normas) { res.status(409).json({ error: 'O acervo de leis ainda está sendo baixado. Tente de novo em alguns minutos.' }); return null; }
  return a;
}

router.get('/estado', async (_req: Request, res: Response) => {
  res.json((await svc()).estadoAcervo());
});

router.get('/buscar', async (req: Request, res: Response) => {
  const q = String(req.query.q || '').trim().slice(0, 300);
  if (q.length < 2) { res.status(400).json({ error: 'Digite o que procura.' }); return; }
  const a = await acervoOu503(res);
  if (!a) return;
  const esferas = String(req.query.esferas || '').split(',').filter((e): e is Esfera => ESFERAS.includes(e as Esfera));
  const limite = Math.min(100, Math.max(1, Number(req.query.limite) || 40));
  res.json({ resultados: a.buscar(q, { esferas, vigentes: req.query.vigentes === '1' }, limite) });
});

router.get('/atalhos', async (_req: Request, res: Response) => {
  const a = await acervoOu503(res);
  if (!a) return;
  res.json(ATALHOS.map((x) => ({ apelido: x.apelido, normaId: a.localizarNorma(x.ref)?.id ?? null })).filter((x) => x.normaId));
});

router.get('/norma/:id', async (req: Request, res: Response) => {
  const a = await acervoOu503(res);
  if (!a) return;
  const n = a.norma(Number(req.params.id));
  if (!n) { res.status(404).json({ error: 'Norma não encontrada.' }); return; }
  res.json(n);
});

router.get('/dispositivo/:id', async (req: Request, res: Response) => {
  const a = await acervoOu503(res);
  if (!a) return;
  const d = a.dispositivo(Number(req.params.id));
  if (!d) { res.status(404).json({ error: 'Dispositivo não encontrado.' }); return; }
  res.json(d);
});

router.post('/conferir', async (req: Request, res: Response) => {
  const texto = String(req.body?.texto || '').slice(0, 60000);
  if (texto.trim().length < 5) { res.status(400).json({ error: 'Cole o texto da peça.' }); return; }
  if (!(await acervoOu503(res))) return;
  res.json(await (await svc()).conferirPeca(texto));
});

router.post('/fundamentos', async (req: Request, res: Response) => {
  const texto = String(req.body?.texto || '').slice(0, 8000);
  if (texto.trim().length < 15) { res.status(400).json({ error: 'Descreva o caso em algumas frases.' }); return; }
  if (!(await acervoOu503(res))) return;
  const itens = await (await svc()).pesquisarFundamentos(texto, { area: req.body?.area || null, tipo: req.body?.tipo || null });
  res.json({ itens });
});

router.post('/atualizar', async (req: Request, res: Response) => {
  if ((req as any).user?.role !== 'admin') { res.status(403).json({ error: 'Só a administração atualiza o acervo.' }); return; }
  const { runJob } = await import('../crons/runner');
  runJob('leis:atualizar', async () => (await svc()).dispararAtualizacao({ completo: !!req.body?.completo }));
  res.status(202).json({ ok: true, mensagem: 'Atualização iniciada em segundo plano.' });
});

export default router;
