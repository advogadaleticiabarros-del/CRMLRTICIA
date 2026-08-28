import type { Server } from 'socket.io';

/**
 * Ponte pro Socket.IO usada pelas rotas/serviços de WhatsApp (webhook,
 * envio) sem precisar importar `src/index.ts` (que criaria import
 * circular — index.ts é quem sobe o servidor e importa as rotas).
 * `setIo` é chamado uma vez no boot; até lá (ou se o socket cair),
 * `emitWaUpdate` é um no-op — a tela cai de volta pro polling de
 * fallback, sem quebrar nada.
 */
let io: Server | null = null;

export function setIo(instance: Server): void {
  io = instance;
}

/** Avisa quem estiver com a tela de WhatsApp aberta que algo mudou nesse número
 *  (mensagem nova, status ✓✓, ou presença/"digitando…" via `extra`). */
export function emitWaUpdate(phone: string, extra?: Record<string, unknown>): void {
  if (!io) return;
  io.emit('whatsapp:update', { phone, ...extra });
}
