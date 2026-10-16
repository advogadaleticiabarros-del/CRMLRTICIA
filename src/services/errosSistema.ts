/**
 * Rastreador de erros do próprio CRM (16/10/2026), no lugar de um serviço de
 * fora como o Sentry: os dados de clientes não saem do servidor (LGPD) e não
 * precisa de conta. Pega erro do servidor (rota que quebrou, promessa sem
 * tratamento) e da tela (erro de JavaScript no navegador, resposta 5xx).
 *  - O mesmo erro repetido vira UM registro com contador (assinatura).
 *  - CPF, telefone, e-mail e nº de processo são mascarados antes de gravar.
 *  - Avisa a equipe na 1ª vez e, se continuar acontecendo, no máximo a cada 6 h.
 * Regras puras — tests/errosSistema.test.mjs.
 */
import crypto from 'crypto';

export type OrigemErro = 'servidor' | 'tela';

const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const PROCESSO = /\b\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}\b/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const FONE = /\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/g;
const TOKEN = /\b(Bearer\s+)?eyJ[\w-]+\.[\w-]+\.[\w-]+/g;

/** Tira dados pessoais e tokens do texto do erro. */
export function mascarar(texto: string): string {
  return String(texto || '')
    .replace(TOKEN, '[token]').replace(PROCESSO, '[processo]').replace(CNPJ, '[cnpj]').replace(CPF, '[cpf]')
    .replace(EMAIL, '[e-mail]').replace(FONE, '[telefone]');
}

/** Mesma falha = mesma assinatura, mesmo com ids, números e datas diferentes. */
export function assinaturaErro(origem: OrigemErro, mensagem: string, local: string): string {
  const norm = (s: string) => mascarar(s).toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}t?[\d:.z+-]*/g, '[data]').replace(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/g, '[uuid]').replace(/\d+/g, '0')
    .replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha1').update(`${origem}|${norm(mensagem)}|${norm(local)}`).digest('hex');
}

/** Local da falha: rota sem ids ("/api/clients/0") ou a 1ª linha útil da pilha. */
export function localDoErro(rota: string | null | undefined, pilha: string | null | undefined): string {
  if (rota) return String(rota).split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id').slice(0, 200);
  const linha = String(pilha || '').split('\n').map((l) => l.trim()).find((l) => /^at\s/.test(l) && !/node_modules|node:internal/.test(l));
  return (linha || '').replace(/\\/g, '/').replace(/\(.*\/(src|dist|public)\//, '($1/').slice(0, 200);
}

export const HORAS_ENTRE_AVISOS = 6;

export function deveAvisar(e: { vezes: number; avisadoEm: Date | string | null }, agora: Date): boolean {
  if (!e.avisadoEm) return true;
  return agora.getTime() - new Date(e.avisadoEm).getTime() >= HORAS_ENTRE_AVISOS * 3600000;
}

/** Erro que não vale aviso: rede do usuário caiu, extensão do navegador, aba fechada no meio. */
export function ehRuido(origem: OrigemErro, mensagem: string): boolean {
  const t = String(mensagem || '').toLowerCase();
  if (origem === 'tela' && /failed to fetch|networkerror|load failed|aborterror|the user aborted|resizeobserver loop|script error\.?$|chrome-extension|moz-extension|sessão expirada/.test(t)) return true;
  return false;
}

export function mensagemAvisoErro(d: { origem: OrigemErro; mensagem: string; local: string; vezes: number; usuario: string | null }): { titulo: string; texto: string } {
  const onde = d.origem === 'tela' ? 'na tela do CRM' : 'no servidor do CRM';
  return {
    titulo: `🐞 Erro ${onde}${d.vezes > 1 ? ` (${d.vezes}x)` : ''}`,
    texto: [
      `🐞 *Erro ${onde}*${d.vezes > 1 ? ` — já aconteceu ${d.vezes} vezes` : ''}`,
      `O quê: ${mascarar(d.mensagem).slice(0, 300)}`,
      d.local ? `Onde: ${d.local}` : null,
      d.usuario ? `Com quem: ${d.usuario}` : null,
      '',
      'Detalhes e histórico: Escritório virtual → Dr. Bento → Erros do sistema.',
    ].filter((l) => l !== null).join('\n'),
  };
}
