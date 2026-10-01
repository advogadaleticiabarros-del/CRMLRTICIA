import { db } from '../config/database';

/**
 * Destino ÚNICO dos envios de WhatsApp pessoais: fechamento do dia e lembretes
 * de pessoal/recado/medicamento. Pedido explícito (01/10/2026): vão só para o
 * número da Jessica, não para todos os números do briefing matinal.
 * Pode ser trocado em office_settings.whatsapp_pessoal_destino.
 */
const PADRAO = '27988798093';

export async function destinoWhatsappPessoal(): Promise<string> {
  const [[cfg]] = await db.query(
    "SELECT setting_value FROM office_settings WHERE setting_key = 'whatsapp_pessoal_destino'"
  ).catch(() => [[null]]) as any;
  const d = String(cfg?.setting_value || PADRAO).replace(/\D/g, '');
  return d.length <= 11 ? '55' + d : d;
}
