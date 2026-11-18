/**
 * Aviso no WhatsApp quando o Google cancela a autorização do CRM (18/11/2026).
 *
 * Por quê: de 29/10 a 18/11 as três conexões Google (Gmail dos tribunais,
 * Gmail da parceria e Agenda) falharam com `invalid_grant` e ninguém viu —
 * o aviso ia só para o sino e para Configurações. Nesse tempo o Push do TRT17
 * e os outros e-mails de tribunal não entraram no CRM.
 *
 * Agora a falha desse tipo manda UMA mensagem por dia ao WhatsApp do
 * escritório (aviso interno, nunca a cliente), dizendo o que parou e onde
 * reconectar.
 */

const QUEDA_RE = /invalid_grant|invalid_token|revoked|expired or revoked|unauthorized_client/i;
const JANELA_HORAS = 24;

export function ehQuedaDeAutorizacaoGoogle(msg: string | null | undefined): boolean {
  return QUEDA_RE.test(String(msg || ''));
}

/** O que cada rotina Google deixa de fazer e onde reconectar. */
const ROTINAS: Record<string, { parou: string; onde: string }> = {
  'monitoramento:processos-email': {
    parou: 'os e-mails dos tribunais (Push do TRT17 e demais avisos) não estão entrando no CRM',
    onde: 'Configurações → Monitoramento por e-mail → Reconectar',
  },
  'agenda:sync-incremental': { parou: 'a Agenda do Google não está sincronizando', onde: 'Agenda → Reconectar Google' },
  'agenda:sync-completa': { parou: 'a Agenda do Google não está sincronizando', onde: 'Agenda → Reconectar Google' },
  'parceria:sync-gmail': { parou: 'os e-mails da parceira (indicações) não estão sendo lidos', onde: 'Parcerias → Reconectar' },
};

export interface DepsAvisoGoogle {
  /** Horas desde o último aviso deste tipo (qualquer rotina Google), ou null se nunca. */
  horasDesdeUltimoAviso(): Promise<number | null>;
  enviarWhatsapp(texto: string): Promise<boolean>;
  /** Guarda o aviso (sino) — também serve de marca para a janela de 24 h. */
  registrarAviso(texto: string): Promise<void>;
}

export type ResultadoAviso = 'avisado' | 'ja_avisado' | 'nao_se_aplica';

export async function avisarQuedaConexaoGoogle(job: string, d: DepsAvisoGoogle): Promise<ResultadoAviso> {
  const r = ROTINAS[job];
  if (!r) return 'nao_se_aplica';
  const h = await d.horasDesdeUltimoAviso();
  if (h != null && h < JANELA_HORAS) return 'ja_avisado';
  const texto = [
    '⚠️ A conexão do CRM com o Google caiu (o Google cancelou a autorização).',
    '',
    `O que parou: ${r.parou}.`,
    `Para voltar: ${r.onde}, entrando com a conta Google do escritório.`,
    '',
    'As outras conexões Google (Agenda, parceria, e-mail dos tribunais) costumam cair juntas: reconecte todas.',
  ].join('\n');
  await d.registrarAviso(texto);
  await d.enviarWhatsapp(texto);
  return 'avisado';
}

/** Dependências reais (banco + Uazapi). */
export async function avisarQuedaConexaoGoogleReal(job: string): Promise<ResultadoAviso> {
  const { db } = await import('../config/database');
  const { sendText } = await import('./uazapiInstance');
  const { destinoWhatsappPessoal } = await import('./destinoWhatsappPessoal');
  return avisarQuedaConexaoGoogle(job, {
    async horasDesdeUltimoAviso() {
      const [[r]] = await db.query(
        `SELECT TIMESTAMPDIFF(MINUTE, MAX(created_at), NOW()) / 60 AS h FROM notifications
          WHERE notification_type = 'conexao_google_caiu'`
      ) as any;
      return r?.h == null ? null : Number(r.h);
    },
    async enviarWhatsapp(texto) {
      return sendText(await destinoWhatsappPessoal(), texto, 'Automático — conexão Google').catch(() => false);
    },
    async registrarAviso(texto) {
      const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
      for (const a of admins) {
        await db.query(
          `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
           VALUES (?, '⚠️ Conexão com o Google caiu', ?, 'conexao_google_caiu', 'sistema', NOW(), 'pendente')`,
          [a.id, texto]
        );
      }
    },
  });
}
