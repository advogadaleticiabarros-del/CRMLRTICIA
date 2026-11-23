/**
 * Sessão do usuário (23/11/2026, padrão de segurança SaaS).
 *
 * O login é um JWT de 24h que se renova sozinho com o uso. Antes, nada no
 * servidor conferia o usuário depois do login: quem era DESATIVADO, trocava a
 * senha ou tinha a senha redefinida continuava entrando com o token antigo —
 * e, com a renovação, para sempre. Agora cada token leva a "versão da sessão"
 * (`users.token_version`); a cada pedido o servidor confere se o usuário está
 * ativo e se a versão bate. Subir a versão derruba todos os aparelhos.
 *
 * Também diz se o usuário já aceitou a versão atual dos Termos de Uso e da
 * Política de Privacidade (ver termos.ts).
 *
 * A busca no banco é injetada (criarVerificadorSessao) para testar sem MySQL;
 * o resultado fica 30 s em memória para não pesar a cada pedido.
 */
import { db } from '../config/database';

export interface EstadoSessao { ativo: boolean; versao: number; termosVersao: string | null }
export type BuscarEstado = (userId: number) => Promise<EstadoSessao | null>;
export type ResultadoSessao = { ok: true; estado: EstadoSessao } | { ok: false; motivo: 'inexistente' | 'inativo' | 'encerrada' };

export function criarVerificadorSessao(buscar: BuscarEstado, ttlMs = 30_000, agora: () => number = Date.now) {
  const cache = new Map<number, { em: number; estado: EstadoSessao | null }>();

  async function estado(userId: number): Promise<EstadoSessao | null> {
    const c = cache.get(userId);
    if (c && agora() - c.em < ttlMs) return c.estado;
    const e = await buscar(userId);               // erro do banco sobe: quem chama responde 503
    if (cache.size > 2000) cache.clear();
    cache.set(userId, { em: agora(), estado: e });
    return e;
  }

  return {
    estado,
    /** Confere o token: usuário existe, está ativo e a versão da sessão é a atual. */
    async verificar(userId: number, versaoDoToken: number | undefined): Promise<ResultadoSessao> {
      const e = await estado(userId);
      if (!e) return { ok: false, motivo: 'inexistente' };
      if (!e.ativo) return { ok: false, motivo: 'inativo' };
      if ((versaoDoToken ?? 0) !== e.versao) return { ok: false, motivo: 'encerrada' };
      return { ok: true, estado: e };
    },
    esquecer(userId: number) { cache.delete(userId); },
  };
}

export const sessoes = criarVerificadorSessao(async (userId) => {
  const [rows] = await db.query('SELECT active, token_version, termos_versao FROM users WHERE id = ?', [userId]) as any;
  const u = rows[0];
  return u ? { ativo: !!u.active, versao: Number(u.token_version) || 0, termosVersao: u.termos_versao || null } : null;
});

/**
 * Derruba todas as sessões do usuário (troca/redefinição de senha, desativação,
 * mudança de papel, "sair de todos os aparelhos"). Devolve a versão nova, para
 * quem trocou a própria senha receber um token novo e continuar logado só ali.
 */
export async function encerrarSessoes(userId: number): Promise<number> {
  await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [userId]);
  sessoes.esquecer(userId);
  const e = await sessoes.estado(userId);
  return e?.versao ?? 0;
}
