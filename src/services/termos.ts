/**
 * Termos de Uso e Política de Privacidade (23/11/2026).
 *
 * Todo usuário (equipe, cliente do portal, parceiro) precisa aceitar a versão
 * vigente antes de usar o sistema. Mudou o texto de forma relevante? Suba
 * TERMOS_VERSAO: todos aceitam de novo no próximo acesso. Cada aceite fica
 * gravado em `termos_aceites` (prova para a LGPD).
 * Textos: public/termos.html e public/privacidade.html.
 */
export const TERMOS_VERSAO = '2026-11-23';

/** Rotas que funcionam antes do aceite: login/sessão/aceite e o envio de erro da tela. */
export function rotaLiberadaSemAceite(url: string): boolean {
  const p = String(url || '').split('?')[0];
  return p.startsWith('/api/auth/') || p === '/api/auth' || p.startsWith('/api/erros');
}

export function precisaAceitar(versaoAceita: string | null | undefined): boolean {
  return versaoAceita !== TERMOS_VERSAO;
}
