/**
 * Senha do Meu INSS do cliente — regras puras.
 *
 * A senha fica numa tabela própria (`client_credentials`), fora de `clients`,
 * para nunca vazar por `SELECT * FROM clients` (listas, exportações, IA,
 * Obsidian). Só é lida pelo endpoint dedicado, e só por quem trabalha no
 * processo: admin, advogado e equipe interna — comercial, estagiário,
 * parceiro e cliente não veem.
 */
const PODE_VER = ['admin', 'advogado', 'staff'];

export const podeVerSenhaInss = (role: string | null | undefined) => PODE_VER.includes(String(role));

export function normalizarSenhaInss(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (s.length > 100) throw new Error('Senha longa demais');
  return s;
}

const MARCADOR = '[guardada na ficha do cliente]';
const SENHA_NO_TEXTO = /(senha\s+(?:do\s+)?(?:meu\s+)?inss)(\s*[:\-–]\s*)(\S+)/i;

/**
 * Senha do Meu INSS colada num texto (observação do card, relato do parceiro...).
 * Devolve o texto sem a senha (fica o marcador) e a senha, para ir ao cofre
 * (`client_credentials`). Caso real (30/10/2026): o e-mail do parceiro colado na
 * observação do card levava a senha em claro, e a observação vai para a IA.
 */
export function retirarSenhaInss(texto: string): { texto: string; senha: string | null } {
  const m = String(texto ?? '').match(SENHA_NO_TEXTO);
  if (!m || m[3] === '[guardada' || m[3].startsWith('[')) return { texto, senha: null };
  return { texto: texto.replace(SENHA_NO_TEXTO, `$1: ${MARCADOR}`), senha: m[3] };
}
