// Banco do fechamento de caso de parceria com RPV (regra em fechamentoRpvParceria.ts).
import { db } from '../config/database';
import { logTimeline } from './TimelineService';
import type { RepoFechamento } from './fechamentoRpvParceria';

export const repoFechamentoMysql: RepoFechamento = {
  async buscarCaso(caseId) {
    const [[c]] = await db.query(`
      SELECT c.id, c.client_id, cl.name AS client_name, c.case_number, c.partner_id,
             p.name AS partner_name, p.success_fee_percent, p.partner_split_percent
        FROM cases c
        LEFT JOIN clients cl ON cl.id = c.client_id
        LEFT JOIN partners p ON p.id = c.partner_id
       WHERE c.id = ?`, [caseId]) as any;
    return c || null;
  },

  async buscarFechamento(caseId) {
    const [[f]] = await db.query('SELECT id, receita_id, repasse_id FROM parceria_fechamentos WHERE case_id = ?', [caseId]) as any;
    return f || null;
  },

  async buscarPendentesDoResultado(caseId) {
    // Lançados pelo botão "Êxito / Sucumb." (receita e repasse pendentes, sem data).
    const [[r]] = await db.query(
      `SELECT id FROM financial_records WHERE case_id = ? AND tipo = 'receita' AND status = 'pendente'
          AND due_date IS NULL AND description LIKE 'Êxito%' ORDER BY id LIMIT 1`, [caseId]) as any;
    const [[p]] = await db.query(
      `SELECT id FROM repasses WHERE case_id = ? AND status = 'pendente' AND data_vencimento IS NULL
          AND descricao LIKE 'Repasse êxito%' ORDER BY id LIMIT 1`, [caseId]) as any;
    return { receitaId: r?.id ?? null, repasseId: p?.id ?? null };
  },

  async salvarReceita(r) {
    if (r.id) {
      await db.query(
        `UPDATE financial_records SET description = ?, valor = ?, status = 'pago', due_date = ?, paid_at = ? WHERE id = ?`,
        [r.descricao, r.valor, r.data, `${r.data} 12:00:00`, r.id]);
      return r.id;
    }
    const [ins] = await db.query(
      `INSERT INTO financial_records (user_id, client_id, case_id, tipo, description, valor, status, due_date, paid_at)
       VALUES (?, ?, ?, 'receita', ?, ?, 'pago', ?, ?)`,
      [r.userId, r.clientId, r.caseId, r.descricao, r.valor, r.data, `${r.data} 12:00:00`]) as any;
    return ins.insertId;
  },

  async salvarRepasse(r) {
    const status = r.valor > 0 ? 'repassado' : 'cancelado';
    if (r.id) {
      await db.query(
        `UPDATE repasses SET parceiro = ?, valor = ?, percentual = ?, descricao = ?, status = ?,
                data_vencimento = ?, data_repasse = ? WHERE id = ?`,
        [r.parceiro, r.valor, r.percentual, r.descricao, status, r.data, `${r.data} 12:00:00`, r.id]);
      return r.id;
    }
    const [ins] = await db.query(
      `INSERT INTO repasses (case_id, parceiro, tipo, valor, percentual, descricao, status, data_vencimento, data_repasse)
       VALUES (?, ?, 'indicacao', ?, ?, ?, ?, ?, ?)`,
      [r.caseId, r.parceiro, r.valor, r.percentual, r.descricao, status, r.data, `${r.data} 12:00:00`]) as any;
    return ins.insertId;
  },

  async salvarFechamento(f) {
    const vals = [f.valorSacado, f.honorariosPercentual, f.parceiraPercentual, f.honorarios, f.valorCliente,
      f.valorParceira, f.valorRepasse, f.valorEscritorio, f.dataSaque, f.dataRepasse, f.dataPagamentoCliente,
      f.receitaId, f.repasseId, f.observacoes];
    if (f.id) {
      await db.query(
        `UPDATE parceria_fechamentos SET valor_sacado = ?, honorarios_percentual = ?, parceira_percentual = ?, honorarios = ?,
                valor_cliente = ?, valor_parceira = ?, valor_repasse = ?, valor_escritorio = ?, data_saque = ?, data_repasse = ?,
                data_pagamento_cliente = ?, receita_id = ?, repasse_id = ?, observacoes = ? WHERE id = ?`, [...vals, f.id]);
      return f.id;
    }
    const [ins] = await db.query(
      `INSERT INTO parceria_fechamentos (valor_sacado, honorarios_percentual, parceira_percentual, honorarios, valor_cliente,
              valor_parceira, valor_repasse, valor_escritorio, data_saque, data_repasse, data_pagamento_cliente,
              receita_id, repasse_id, observacoes, case_id, partner_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...vals, f.caseId, f.partnerId, f.userId]) as any;
    return ins.insertId;
  },

  async encerrarCaso(e) {
    // "Concluído" da esteira é só a peça protocolada; o caso terminou de fato → status encerrado.
    // Não manda nada à cliente (regra de 19/10: nenhuma mensagem sem consentimento).
    await db.query(
      `UPDATE cases SET status = 'encerrado', resultado = COALESCE(resultado, 'procedente'),
              valor_obtido = ?, resultado_em = ? WHERE id = ?`, [e.valorObtido, e.data, e.caseId]);
  },

  async registrarLinhaDoTempo(l) {
    await logTimeline({ clientId: l.clientId, caseId: l.caseId, eventType: 'parceria_fechamento_rpv', description: l.descricao, userId: l.userId });
  },
};

/** Fechamento completo de um caso, com os comprovantes (para a tela). */
export async function lerFechamento(caseId: number) {
  const [[f]] = await db.query(`
    SELECT f.*, dr.name AS recibo_nome, dr.file_url AS recibo_url, (dr.data IS NOT NULL) AS recibo_no_crm,
           dv.name AS video_nome, dv.file_url AS video_url
      FROM parceria_fechamentos f
      LEFT JOIN documents dr ON dr.id = f.recibo_document_id
      LEFT JOIN documents dv ON dv.id = f.video_document_id
     WHERE f.case_id = ?`, [caseId]) as any;
  return f || null;
}

/** Liga um documento (recibo ou vídeo) ao fechamento do caso. */
export async function ligarComprovante(caseId: number, tipo: 'recibo' | 'video', documentId: number) {
  const col = tipo === 'recibo' ? 'recibo_document_id' : 'video_document_id';
  const [r] = await db.query(`UPDATE parceria_fechamentos SET ${col} = ? WHERE case_id = ?`, [documentId, caseId]) as any;
  return r.affectedRows > 0;
}
