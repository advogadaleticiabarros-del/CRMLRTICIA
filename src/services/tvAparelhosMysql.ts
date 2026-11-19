import { db } from '../config/database';
import { WHATSAPP_ROLES } from '../middleware/auth';
import { criarServicoTv, type AparelhoTv, type RepoTv } from './tvAparelhos';

/** Repositório MySQL das TVs liberadas (tabela tv_aparelhos, migration 187). Datas em UTC. */
const utc = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const deLinha = (r: any): AparelhoTv => ({
  id: Number(r.id), codigo: r.codigo, segredoHash: r.segredo_hash, status: r.status, nome: r.nome,
  liberadaPor: r.liberada_por == null ? null : Number(r.liberada_por), liberadaEm: r.liberada_em, ultimoUso: r.ultimo_uso, criadoEm: r.created_at,
});
const uma = async (sql: string, p: any[]) => { const [r] = await db.query(sql, p) as any; return r[0] ? deLinha(r[0]) : null; };

export const repoTvMysql: RepoTv = {
  async criar(a) {
    // Códigos que ninguém usou somem depois de 1 dia (a TV gera um novo a cada 10 min).
    await db.query("DELETE FROM tv_aparelhos WHERE status = 'aguardando' AND created_at < ? - INTERVAL 1 DAY", [utc(a.criadoEm)]);
    const [r] = await db.query('INSERT INTO tv_aparelhos (codigo, segredo_hash, created_at) VALUES (?, ?, ?)', [a.codigo, a.segredoHash, utc(a.criadoEm)]) as any;
    return Number(r.insertId);
  },
  porHash: (h) => uma('SELECT * FROM tv_aparelhos WHERE segredo_hash = ? LIMIT 1', [h]),
  aguardandoPorCodigo: (codigo, desde) => uma("SELECT * FROM tv_aparelhos WHERE codigo = ? AND status = 'aguardando' AND created_at > ? ORDER BY id DESC LIMIT 1", [codigo, utc(desde)]),
  async contarCriadosDesde(desde) {
    const [[r]] = await db.query('SELECT COUNT(*) AS n FROM tv_aparelhos WHERE created_at > ?', [utc(desde)]) as any;
    return Number(r?.n) || 0;
  },
  async liberar(id, usuarioId, nome, em) {
    await db.query("UPDATE tv_aparelhos SET status = 'liberada', codigo = NULL, liberada_por = ?, nome = ?, liberada_em = ? WHERE id = ? AND status = 'aguardando'", [usuarioId, nome, utc(em), id]);
  },
  async revogar(id) { await db.query("UPDATE tv_aparelhos SET status = 'revogada', codigo = NULL WHERE id = ?", [id]); },
  async listarLiberadas() {
    const [r] = await db.query("SELECT * FROM tv_aparelhos WHERE status = 'liberada' ORDER BY liberada_em DESC") as any;
    return (r as any[]).map(deLinha);
  },
  async marcarUso(id, em) { await db.query('UPDATE tv_aparelhos SET ultimo_uso = ? WHERE id = ?', [utc(em), id]); },
  async usuarioPodeVer(id) {
    const [r] = await db.query(`SELECT id, email, name, role FROM users WHERE id = ? AND active = 1 AND role IN (${WHATSAPP_ROLES.map(() => '?').join(',')})`, [id, ...WHATSAPP_ROLES]) as any;
    return r[0] ? { id: Number(r[0].id), email: r[0].email, name: r[0].name, role: r[0].role } : null;
  },
};

export const servicoTv = criarServicoTv(repoTvMysql);
