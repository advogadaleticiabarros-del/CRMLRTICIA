import { db } from '../config/database';
import { assinaturaErro, localDoErro, mascarar, deveAvisar, ehRuido, mensagemAvisoErro, type OrigemErro } from './errosSistema';

/**
 * Rastreador de erros com banco e aviso (regras em errosSistema.ts).
 * registrarErro nunca lança: rastrear um erro não pode causar outro.
 * Erro já marcado como resolvido que volta a acontecer reabre e avisa de novo.
 */

let gravando = 0;

export async function registrarErro(e: { origem: OrigemErro; mensagem: string; pilha?: string | null; rota?: string | null; local?: string | null; usuario?: string | null }): Promise<void> {
  if (process.env.NODE_ENV === 'test' && !process.env.ERROS_EM_TESTE) return;
  // Trava contra avalanche: se o banco caiu, não empilha milhares de gravações.
  if (gravando > 20) return;
  gravando++;
  try {
    const mensagem = mascarar(String(e.mensagem || 'Erro sem mensagem')).slice(0, 500);
    if (ehRuido(e.origem, mensagem)) return;
    const local = e.local ? String(e.local).slice(0, 200) : localDoErro(e.rota, e.pilha);
    const assinatura = assinaturaErro(e.origem, mensagem, local);
    const detalhe = e.pilha ? mascarar(String(e.pilha)).slice(0, 4000) : null;
    await db.query(
      `INSERT INTO erros_sistema (assinatura, origem, mensagem, local, detalhe, usuario) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE vezes = vezes + 1, ultimo_em = NOW(), detalhe = COALESCE(VALUES(detalhe), detalhe),
         usuario = COALESCE(VALUES(usuario), usuario),
         avisado_em = IF(resolvido = 1, NULL, avisado_em), resolvido = 0`,
      [assinatura, e.origem, mensagem, local || null, detalhe, e.usuario ? String(e.usuario).slice(0, 120) : null]);
    const [[row]] = await db.query('SELECT id, vezes, avisado_em FROM erros_sistema WHERE assinatura = ?', [assinatura]) as any;
    // "Erro 500 em …" vindo da tela costuma ser eco de um erro que o servidor já
    // registrou e avisou: esse só avisa a partir da 3ª vez, para não chegar dobrado.
    const ecoDe5xx = e.origem === 'tela' && /^Erro 5\d\d em /.test(mensagem);
    if (row && (!ecoDe5xx || row.vezes >= 3) && deveAvisar({ vezes: row.vezes, avisadoEm: row.avisado_em }, new Date())) {
      await db.query('UPDATE erros_sistema SET avisado_em = NOW() WHERE id = ?', [row.id]);
      const aviso = mensagemAvisoErro({ origem: e.origem, mensagem, local, vezes: row.vezes, usuario: e.usuario || null });
      await (await import('./backupRotina')).avisarBackup(aviso.titulo, aviso.texto).catch(() => {});
    }
  } catch (err: any) {
    console.error('[erros] não consegui registrar o erro:', err?.message || err);
  } finally {
    gravando--;
  }
}

export async function listarErros(incluirResolvidos = false) {
  const [rows] = await db.query(
    `SELECT id, origem, mensagem, local, detalhe, usuario, vezes, primeiro_em, ultimo_em, resolvido FROM erros_sistema
      ${incluirResolvidos ? '' : 'WHERE resolvido = 0'} ORDER BY ultimo_em DESC LIMIT 100`) as any;
  return rows;
}

export async function marcarResolvido(id: number) {
  await db.query('UPDATE erros_sistema SET resolvido = 1 WHERE id = ?', [id]);
}
