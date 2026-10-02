/**
 * Envio da proposta pela conversa do WhatsApp — regras puras.
 * Texto sem travessão (padrão das mensagens ao cliente desde 30/08/2026).
 */

const BASE = 'https://crm.advogadaleticiabarros.com.br';

export function linkProposta(token: string): string {
  return `${BASE}/proposta.html?t=${token}`;
}

export function emAnalise(status: string | null | undefined): boolean {
  return status === 'enviada' || status === 'em_negociacao';
}

export function textoEnvioProposta(nome: string, titulo: string, url: string): string {
  const primeiro = String(nome || '').trim().split(/\s+/)[0];
  return [
    primeiro ? `Olá, ${primeiro}!` : 'Olá!',
    `Conforme combinamos, segue a sua proposta${titulo ? `: *${titulo.trim()}*` : '.'}`,
    `É só abrir o link abaixo para ler com calma. Se estiver tudo certo, você mesmo pode dar o aceite por lá:`,
    url,
    'Qualquer dúvida, me chame por aqui.',
  ].join('\n\n');
}
