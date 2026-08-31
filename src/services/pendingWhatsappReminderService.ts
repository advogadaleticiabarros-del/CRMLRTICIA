import { uazapi } from './uazapiClient';
import { msgLembreteNewsletterOptIn } from './propostaFollowupService';
import {
  findPendingRepliesNeedingReminder, markReminderSent, PendingReplyForReminder,
} from './pendingWhatsappReplyService';

/**
 * Lembrete de 24h pras pendências de "pergunta com botão" (whatsapp_pending_replies,
 * ver pendingWhatsappReplyService.ts) que ainda não foram respondidas.
 *
 * Pedido da Dra. Letícia: "ao recusar você já envia a mensagem de finalização,
 * se em 24 horas nada respondido envie a mensagem final" — ou seja, um único
 * lembrete reforçando a mesma pergunta antes de desistir de vez na janela de
 * 7 dias que já existia (findOpenPendingReply, inalterada).
 *
 * Genérico por `tipo`: a busca (findPendingRepliesNeedingReminder) não
 * hardcoda 'newsletter_opt_in' — só o texto do lembrete abaixo é específico
 * por tipo, hoje o único que existe. Um tipo novo de pendência de botão no
 * futuro só precisa de um novo `case` aqui.
 *
 * Best-effort por pendência: uma falha na Uazapi (ex.: número bloqueou) não
 * impede o lembrete das demais, e reminder_sent_at é marcado mesmo assim —
 * não fica tentando de novo a cada hora pra sempre (ver comentário no
 * finally abaixo).
 */
export async function sendPendingReplyReminders(): Promise<{ lembretes: number; falhas: number }> {
  const pendencias = await findPendingRepliesNeedingReminder();
  let lembretes = 0;
  let falhas = 0;

  for (const p of pendencias) {
    try {
      await enviarLembrete(p);
      lembretes++;
    } catch (e: any) {
      falhas++;
      console.error(`[lembrete pendência ${p.id}] falha ao enviar:`, e?.message || e);
    } finally {
      // Marca como tentado mesmo em falha de envio — evita martelar a pessoa
      // (ou insistir contra uma API fora do ar) a cada hora pra sempre.
      await markReminderSent(p.id);
    }
  }

  return { lembretes, falhas };
}

async function enviarLembrete(p: PendingReplyForReminder): Promise<void> {
  switch (p.tipo) {
    case 'newsletter_opt_in':
      // Reaproveita expected_yes/expected_no já salvos na pendência original —
      // não gera ids novos, senão o clique do lembrete não bateria com a
      // pendência que o webhook está esperando resolver.
      await uazapi.sendMenu(p.phone, 'button', msgLembreteNewsletterOptIn(p.nome || ''), [
        `Sim|${p.expected_yes}`,
        `Não|${p.expected_no}`,
      ]);
      break;
    default:
      // Tipo de pendência sem lembrete definido ainda — não faz nada (e
      // marca reminder_sent_at do mesmo jeito, no chamador, pra não ficar
      // tentando de novo a cada hora indefinidamente).
      break;
  }
}
