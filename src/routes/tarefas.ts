// Tarefas demoradas da pessoa logada: barra de acompanhamento e confirmação de conclusão
// (pedido da Jessica, 30/10/2026). O registro fica em services/tarefasEmAndamento.ts.
//   GET  /api/tarefas          → as que rodam e as terminadas ainda sem OK
//   POST /api/tarefas/:id/ok   → "OK" na confirmação de conclusão
//   POST /api/tarefas/ok       → OK em todas as terminadas
import { Router, Request, Response } from 'express';
import { tarefasEmAndamento } from '../services/tarefasEmAndamento';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  res.json({ tarefas: tarefasEmAndamento.listar(req.user!.id) });
});

router.post('/ok', (req: Request, res: Response) => {
  res.json({ dispensadas: tarefasEmAndamento.dispensarTerminadas(req.user!.id) });
});

router.post('/:id/ok', (req: Request, res: Response) => {
  res.json({ ok: tarefasEmAndamento.dispensar(req.user!.id, String(req.params.id)) });
});

export default router;
