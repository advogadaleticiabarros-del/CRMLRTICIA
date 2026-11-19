/**
 * TV do escritório liberada por código, sem login na TV (19/11/2026, Jessica:
 * "não quero precisar fazer o login"; escolheu o código em vez de link secreto).
 *
 * 1. A TV pede um código (rota pública) e guarda um segredo só dela.
 * 2. Alguém da equipe, logado no celular, digita o código em /tv/liberar.
 * 3. A partir daí a TV se identifica pelo segredo (cabeçalho X-TV-Chave) e vê
 *    o painel como o usuário que liberou, só nas rotas de leitura de /api/tv.
 *
 * O banco guarda só o hash do segredo. O código vale 10 minutos e é só para
 * parear: não dá acesso a nada sozinho. Dependências injetadas (repo, sorteio,
 * relógio) para testar pela mesma interface.
 */
import crypto from 'crypto';

export type SituacaoTv = 'aguardando' | 'liberada' | 'revogada' | 'expirado' | 'desconhecido';

export interface AparelhoTv {
  id: number;
  codigo: string | null;
  segredoHash: string;
  status: 'aguardando' | 'liberada' | 'revogada';
  nome: string | null;
  liberadaPor: number | null;
  liberadaEm: Date | null;
  ultimoUso: Date | null;
  criadoEm: Date;
}

export interface UsuarioTv { id: number; email: string; name: string; role: string }

export interface RepoTv {
  criar(a: { codigo: string; segredoHash: string; criadoEm: Date }): Promise<number>;
  porHash(hash: string): Promise<AparelhoTv | null>;
  aguardandoPorCodigo(codigo: string, desde: Date): Promise<AparelhoTv | null>;
  contarCriadosDesde(desde: Date): Promise<number>;
  liberar(id: number, usuarioId: number, nome: string, em: Date): Promise<void>;
  revogar(id: number): Promise<void>;
  listarLiberadas(): Promise<AparelhoTv[]>;
  marcarUso(id: number, em: Date): Promise<void>;
  /** Usuário ativo e com acesso ao WhatsApp; senão null (a TV para de funcionar). */
  usuarioPodeVer(usuarioId: number): Promise<UsuarioTv | null>;
}

export interface Sorteio { codigo(): string; segredo(): string }

export const VALIDADE_CODIGO_MIN = 10;
/** Pedidos de código aceitos por janela de 10 min (a rota é pública). */
export const MAX_PEDIDOS_JANELA = 30;
const USO_MIN = 5;

export const sorteioSeguro: Sorteio = {
  codigo: () => String(crypto.randomInt(0, 1000000)).padStart(6, '0'),
  segredo: () => crypto.randomBytes(32).toString('hex'),
};

export function hashSegredo(segredo: string): string {
  return crypto.createHash('sha256').update(String(segredo)).digest('hex');
}

export function criarServicoTv(repo: RepoTv, sorteio: Sorteio = sorteioSeguro, relogio: () => Date = () => new Date()) {
  const validoDesde = () => new Date(relogio().getTime() - VALIDADE_CODIGO_MIN * 60000);
  const buscar = async (segredo: string) => (segredo ? repo.porHash(hashSegredo(segredo)) : null);

  return {
    async iniciar(): Promise<{ ok: true; codigo: string; segredo: string; expiraEm: string } | { ok: false; erro: string }> {
      const agora = relogio();
      if (await repo.contarCriadosDesde(validoDesde()) >= MAX_PEDIDOS_JANELA) {
        return { ok: false, erro: 'Muitos pedidos de código agora. Tente de novo em alguns minutos.' };
      }
      let codigo = sorteio.codigo();
      for (let i = 0; i < 5 && await repo.aguardandoPorCodigo(codigo, validoDesde()); i++) codigo = sorteio.codigo();
      if (await repo.aguardandoPorCodigo(codigo, validoDesde())) return { ok: false, erro: 'Não deu para gerar o código. Tente de novo.' };
      const segredo = sorteio.segredo();
      await repo.criar({ codigo, segredoHash: hashSegredo(segredo), criadoEm: agora });
      return { ok: true, codigo, segredo, expiraEm: new Date(agora.getTime() + VALIDADE_CODIGO_MIN * 60000).toISOString() };
    },

    async situacao(segredo: string): Promise<SituacaoTv> {
      const a = await buscar(segredo);
      if (!a) return 'desconhecido';
      if (a.status === 'aguardando' && new Date(a.criadoEm) <= validoDesde()) return 'expirado';
      return a.status;
    },

    async liberar(codigoDigitado: string, usuario: { id: number }, nome: string): Promise<{ ok: true } | { ok: false; erro: string }> {
      const codigo = String(codigoDigitado || '').replace(/\D/g, '');
      if (codigo.length !== 6) return { ok: false, erro: 'Digite os 6 números que aparecem na TV.' };
      const a = await repo.aguardandoPorCodigo(codigo, validoDesde());
      if (!a) return { ok: false, erro: 'Código não encontrado ou vencido. Confira na TV (ele muda a cada 10 minutos).' };
      await repo.liberar(a.id, usuario.id, String(nome || '').trim().slice(0, 80) || 'TV do escritório', relogio());
      return { ok: true };
    },

    async autenticar(segredo: string): Promise<UsuarioTv | null> {
      const a = await buscar(segredo);
      if (!a || a.status !== 'liberada' || !a.liberadaPor) return null;
      const usuario = await repo.usuarioPodeVer(a.liberadaPor);
      if (!usuario) return null;
      const agora = relogio();
      if (!a.ultimoUso || agora.getTime() - new Date(a.ultimoUso).getTime() > USO_MIN * 60000) await repo.marcarUso(a.id, agora);
      return usuario;
    },

    async listar() {
      return (await repo.listarLiberadas()).map((a) => ({ id: a.id, nome: a.nome, liberadaEm: a.liberadaEm, ultimoUso: a.ultimoUso }));
    },

    revogar: (id: number) => repo.revogar(id),
  };
}

export type ServicoTv = ReturnType<typeof criarServicoTv>;
