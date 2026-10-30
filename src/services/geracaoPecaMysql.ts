// Ligação da geração da peça (geracaoPeca.ts) com o banco, a esteira, a revisão e o sino.
import { db } from '../config/database';
import { criarGeracaoPeca, type Pendente } from './geracaoPeca';
import { travaGeracaoPeca, ETAPAS_GERACAO, type Andamento } from './travaGeracaoPeca';
import { buildPeticaoInicial } from './peticaoBuilder';
import { revisarPeticaoDoCaso } from './peticaoReviewer';
import { notificationService } from './NotificationService';
import { tarefasEmAndamento } from './tarefasEmAndamento';

export const geracaoPeca = criarGeracaoPeca({
  trava: travaGeracaoPeca,
  gerar: (caseId, userId, force) => buildPeticaoInicial(caseId, userId, force),
  revisar: async (caseId, userId) => {
    const r = await revisarPeticaoDoCaso(caseId, userId);
    return r.ok && r.resumo ? r.resumo : null;
  },
  avisar: async ({ userId, caseId, ok, titulo, mensagem }) => {
    await notificationService.create({
      userId, caseId, title: titulo, message: mensagem,
      notificationType: ok ? 'peticao_gerada' : 'peticao_falhou', channel: 'sistema', scheduledAt: new Date(),
    });
  },
  // Painel de tarefas da tela: a barra segue as etapas da trava ("Etapa X de 9").
  tarefa: (p, retomada) => {
    const c = tarefasEmAndamento.iniciar({
      userId: p.userId, caseId: p.caseId, tipo: 'peca',
      titulo: `${retomada ? 'Retomando a peça' : 'Gerar a peça'}: ${p.titulo || 'Processo'}`,
    });
    c.acompanhar(() => {
      const a = travaGeracaoPeca.emAndamento(p.alvo);
      return a ? { rotulo: `Etapa ${a.passo} de ${a.total}: ${a.rotulo}`, feito: a.passo - 0.5, total: a.total } : null;
    });
    return c;
  },
  pendentes: {
    guardar: async (p) => {
      await db.query(
        `INSERT INTO geracoes_peca_pendentes (alvo_case_id, case_id, user_id, origem, titulo, tentativas)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE case_id = VALUES(case_id), user_id = VALUES(user_id), origem = VALUES(origem),
                                 titulo = VALUES(titulo), tentativas = VALUES(tentativas), iniciado_em = CURRENT_TIMESTAMP`,
        [p.alvo, p.caseId, p.userId, p.origem, p.titulo ? String(p.titulo).slice(0, 255) : null, p.tentativas]);
    },
    apagar: async (alvo) => { await db.query('DELETE FROM geracoes_peca_pendentes WHERE alvo_case_id = ?', [alvo]); },
    listar: async () => {
      const [rows] = await db.query(
        'SELECT alvo_case_id, case_id, user_id, origem, titulo, tentativas FROM geracoes_peca_pendentes ORDER BY iniciado_em') as any;
      return (rows as any[]).map((r): Pendente => ({
        alvo: Number(r.alvo_case_id), caseId: Number(r.case_id), userId: Number(r.user_id),
        origem: r.origem === 'etapa' ? 'etapa' : 'manual', titulo: r.titulo, tentativas: Number(r.tentativas) || 0,
      }));
    },
  },
});

/**
 * A peça está sendo gerada? Olha a trava e, logo depois de um reinício (antes da
 * retomada), o registro no banco: a tela não pode achar que a geração acabou.
 */
export async function andamentoDaPeca(alvo: number): Promise<Andamento | null> {
  const a = travaGeracaoPeca.emAndamento(alvo);
  if (a) return a;
  const [[r]] = await db.query('SELECT iniciado_em FROM geracoes_peca_pendentes WHERE alvo_case_id = ?', [alvo]).catch(() => [[null]]) as any;
  if (!r) return null;
  return { desde: new Date(r.iniciado_em), etapa: 'inicio', rotulo: 'Retomando depois de uma atualização do sistema', passo: 1, total: ETAPAS_GERACAO.length };
}
