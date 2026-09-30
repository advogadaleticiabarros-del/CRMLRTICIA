/**
 * Regras puras do portal do cliente como hub: upload de documento pelo
 * checklist (só PDF/foto, até 10MB — nada executável ou HTML) e mensagens.
 */

const TIPOS_ACEITOS = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
]);
export const MAX_UPLOAD_PORTAL = 10 * 1024 * 1024;

/** null = ok; string = motivo da recusa (mostrado ao cliente). */
export function validarArquivoPortal(mime: string, bytes: number): string | null {
  if (!bytes) return 'Arquivo vazio.';
  if (!TIPOS_ACEITOS.has(String(mime || '').toLowerCase())) return 'Envie um PDF ou foto (JPG, PNG, HEIC).';
  if (bytes > MAX_UPLOAD_PORTAL) return 'Arquivo maior que 10MB — tente uma foto com menos resolução.';
  return null;
}

export function nomeDocumentoPortal(item: string, arquivo: string): string {
  const base = `${item} — enviado pelo portal`;
  const nome = String(arquivo || '').trim().slice(0, 80);
  return nome ? `${base} (${nome})` : base;
}

/** Texto limpo da mensagem, ou null se vazio. */
export function validarMensagem(texto: unknown): string | null {
  const t = String(texto ?? '').trim();
  return t ? t.slice(0, 2000) : null;
}
