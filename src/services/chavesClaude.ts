/**
 * Chaves de acesso do Claude (extensão do Claude Desktop, 28/11/2026).
 *
 * Cada pessoa da equipe gera a sua chave no CRM e cola na extensão. O Claude
 * passa a consultar o CRM em nome dela, com as mesmas permissões. A chave
 * aparece UMA vez; o CRM guarda só o hash (sha256). Revogar desliga na hora.
 * Cliente do portal e parceiro não geram chave.
 */
import { createHash, randomBytes } from 'crypto';

export interface ChaveClaude {
  id: number; userId: number; nome: string; prefixo: string; segredoHash: string;
  criadaEm?: Date; ultimoUso?: Date | null; usos: number; revogadaEm: Date | null;
}
export interface UsuarioChave { id: number; email: string; name: string; role: string }

export interface RepoChaves {
  criar(c: { userId: number; nome: string; prefixo: string; segredoHash: string }): Promise<number>;
  porHash(hash: string): Promise<ChaveClaude | null>;
  listarDoUsuario(userId: number): Promise<ChaveClaude[]>;
  /** false = não existe, é de outra pessoa ou já estava revogada. */
  revogar(id: number, userId: number): Promise<boolean>;
  marcarUso(id: number): Promise<void>;
  /** A pessoa, se estiver ativa e for da equipe (não cliente nem parceiro). */
  usuarioDaEquipe(userId: number): Promise<UsuarioChave | null>;
}

export const MAX_CHAVES_ATIVAS = 5;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export function criarServicoChaves(repo: RepoChaves) {
  return {
    async criar(userId: number, nome: string): Promise<{ id: number; chave: string; prefixo: string }> {
      const n = String(nome || '').trim().slice(0, 80);
      if (!n) throw new Error('Dê um nome para a chave (ex.: "Claude do notebook").');
      if (!(await repo.usuarioDaEquipe(userId))) throw new Error('Só a equipe do escritório pode ligar o Claude ao CRM.');
      if ((await repo.listarDoUsuario(userId)).length >= MAX_CHAVES_ATIVAS) {
        throw new Error(`Você já tem ${MAX_CHAVES_ATIVAS} chaves ativas. Revogue uma que não usa mais.`);
      }
      const chave = `crm_${randomBytes(32).toString('base64url')}`;
      const prefixo = chave.slice(0, 12);
      const id = await repo.criar({ userId, nome: n, prefixo, segredoHash: hash(chave) });
      return { id, chave, prefixo };
    },

    async autenticar(chave: string | undefined | null): Promise<UsuarioChave | null> {
      const c = String(chave || '').trim();
      if (!c.startsWith('crm_') || c.length < 20) return null;
      const linha = await repo.porHash(hash(c));
      if (!linha || linha.revogadaEm) return null;
      const u = await repo.usuarioDaEquipe(linha.userId);
      if (!u) return null;
      await repo.marcarUso(linha.id);
      return u;
    },

    listar: (userId: number) => repo.listarDoUsuario(userId),
    revogar: (id: number, userId: number) => repo.revogar(id, userId),
  };
}
