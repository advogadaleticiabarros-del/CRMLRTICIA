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
