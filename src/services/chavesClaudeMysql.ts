import { db } from '../config/database';
import { STAFF_ROLES } from '../middleware/auth';
import { criarServicoChaves, type ChaveClaude, type RepoChaves } from './chavesClaude';

/** Repositório MySQL das chaves do Claude (tabela claude_chaves, migration 195). */
/** Equipe do escritório, sem parceiro (parceiro tem o portal próprio). */
const PAPEIS_CHAVE = STAFF_ROLES.filter((r) => r !== 'parceiro');

const deLinha = (r: any): ChaveClaude => ({
  id: Number(r.id), userId: Number(r.user_id), nome: r.nome, prefixo: r.prefixo, segredoHash: r.segredo_hash,
  criadaEm: r.criada_em, ultimoUso: r.ultimo_uso, usos: Number(r.usos) || 0, revogadaEm: r.revogada_em,
});

export const repoChavesMysql: RepoChaves = {
  async criar(c) {
    const [r] = await db.query('INSERT INTO claude_chaves (user_id, nome, prefixo, segredo_hash) VALUES (?, ?, ?, ?)',
      [c.userId, c.nome, c.prefixo, c.segredoHash]) as any;
    return Number(r.insertId);
  },
  async porHash(h) {
    const [r] = await db.query('SELECT * FROM claude_chaves WHERE segredo_hash = ? LIMIT 1', [h]) as any;
    return r[0] ? deLinha(r[0]) : null;
  },
  async listarDoUsuario(userId) {
    const [r] = await db.query('SELECT * FROM claude_chaves WHERE user_id = ? AND revogada_em IS NULL ORDER BY id DESC', [userId]) as any;
    return (r as any[]).map(deLinha);
  },
  async revogar(id, userId) {
    const [r] = await db.query('UPDATE claude_chaves SET revogada_em = NOW() WHERE id = ? AND user_id = ? AND revogada_em IS NULL', [id, userId]) as any;
    return (r.affectedRows || 0) > 0;
  },
  async marcarUso(id) {
    await db.query('UPDATE claude_chaves SET ultimo_uso = NOW(), usos = usos + 1 WHERE id = ?', [id]);
  },
  async usuarioDaEquipe(userId) {
    const [r] = await db.query(
      `SELECT id, email, name, role FROM users WHERE id = ? AND active = 1 AND role IN (${PAPEIS_CHAVE.map(() => '?').join(',')})`,
      [userId, ...PAPEIS_CHAVE]
    ) as any;
    return r[0] ? { id: Number(r[0].id), email: r[0].email, name: r[0].name, role: r[0].role } : null;
  },
};

export const servicoChavesClaude = criarServicoChaves(repoChavesMysql);
