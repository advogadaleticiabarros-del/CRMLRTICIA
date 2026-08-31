import { db } from '../config/database';
import { sendText } from './uazapiInstance';
import { uazapi } from './uazapiClient';
import { createPendingReply } from './pendingWhatsappReplyService';

/**
 * Follow-up automático de propostas enviadas — 3 estágios, cada um dispara
 * uma vez só (idempotente via followup_Nx_at). Roda 1x/dia; olha só
 * propostas 'enviada'/'em_negociacao' com telefone, ainda não aceitas.
 *
 * Proteção contra "blast" retroativo: se a proposta já passou de 14 dias
 * sem NENHUM follow-up registrado (ex.: enviada antes desta função existir),
 * marca os 3 estágios como cumpridos SEM disparar mensagem — evita reabrir
 * contato antigo do nada quando a rotina entra no ar.
 */

export const INSTAGRAM_URL = 'https://www.instagram.com/adv.leticiabarros2/';
const BLOG_URL = 'https://advogadaleticiabarros.com.br/blog/index.html';
const LINK_BASE = 'https://crm.advogadaleticiabarros.com.br/proposta.html?t=';

export function primeiroNome(nome: string): string {
  return (nome || '').trim().split(' ')[0] || '';
}

function msg48h(nome: string, link: string): string {
  return [
    `Olá${primeiroNome(nome) ? ', ' + primeiroNome(nome) : ''}! Passando para lembrar que sua proposta de honorários já está disponível:`,
    link,
    `Qualquer dúvida sobre as condições, é só responder por aqui, estou à disposição.`,
  ].join('\n\n');
}

function msg5d(nome: string, link: string): string {
  return [
    `Olá${primeiroNome(nome) ? ', ' + primeiroNome(nome) : ''}! Sua proposta de honorários está próxima do vencimento.`,
    `Se tiver alguma dúvida ou quiser conversar sobre as condições, este é um bom momento. *Podemos negociar* para encontrar o melhor caminho para você buscar seus direitos.`,
    `Acesse a proposta aqui: ${link}`,
  ].join('\n\n');
}

// ── Proposta expirada (7 dias) — mensagem com botões (PATCH /:id/status não
// participa aqui: é o cron runPropostaFollowups que dispara isso sozinho) ──
// Em vez de só avisar que encerrou, oferece 2 botões: "Preciso de mais
// tempo" (concede uma ÚNICA extensão, ver concederExtensaoPrazo) e
// "Recusar" (segue o mesmo caminho de dispararRecusaProposta). Decisão
// comercial: sem desconto/pressão, uma extensão só — evita ficar
// perguntando de novo indefinidamente, o que afasta o cliente.
export const PROPOSTA_EXPIRADA_BOTAO_MAIS_TEMPO_ID = 'proposta_mais_tempo';
export const PROPOSTA_EXPIRADA_BOTAO_RECUSAR_ID = 'proposta_recusar';

export function msgPropostaExpirada(nome: string): string {
  return [
    `Olá${primeiroNome(nome) ? ', ' + primeiroNome(nome) : ''}! O prazo da sua proposta chegou ao fim.`,
    `Isso não fecha a porta: se ainda estiver avaliando e precisar de mais alguns dias, é só avisar. Se não for mais o momento, também tudo bem, nos diga.`,
  ].join('\n\n');
}

export function msgPropostaMaisTempoConfirmado(nome: string): string {
  return `Sem problema${primeiroNome(nome) ? ', ' + primeiroNome(nome) : ''}! Vou aguardar você com calma. Qualquer coisa é só me chamar por aqui.`;
}

// Defensivo: só deveria disparar se alguém clicar "Preciso de mais tempo"
// numa proposta que já tinha usado a extensão única antes (não acontece no
// fluxo normal, já que a 2ª janela não oferece essa pergunta de novo).
// Decisão: não concede outra extensão nem trata como recusa (a pessoa não
// disse não) — só confirma educadamente, sem reabrir o prazo.
export function msgPropostaMaisTempoJaUsada(nome: string): string {
  return `Entendido${primeiroNome(nome) ? ', ' + primeiroNome(nome) : ''}! Já tínhamos ampliado seu prazo antes, então vamos seguir por aqui mesmo. Qualquer novidade, é só me chamar.`;
}

/**
 * Envia a mensagem de proposta expirada com os 2 botões e grava a
 * pendência (`whatsapp_pending_replies`, tipo 'proposta_expirada') pra o
 * webhook casar a resposta depois. Best-effort: nunca lança, só loga —
 * quem chama decide o que fazer com o retorno (ex.: só marcar
 * followup_7d_at se `ok`, pra tentar de novo amanhã em caso de falha).
 */
export async function dispararPropostaExpirada(p: {
  propostaId: number; leadId: number | null; clientId: number | null; phone: string; contactName: string;
}): Promise<boolean> {
  try {
    const number = digitsOf(p.phone);
    await uazapi.sendMenu(number, 'button', msgPropostaExpirada(p.contactName), [
      `Preciso de mais tempo|${PROPOSTA_EXPIRADA_BOTAO_MAIS_TEMPO_ID}`,
      `Recusar|${PROPOSTA_EXPIRADA_BOTAO_RECUSAR_ID}`,
    ]);
    await createPendingReply({
      phone: number,
      tipo: 'proposta_expirada',
      leadId: p.leadId,
      clientId: p.clientId,
      propostaId: p.propostaId,
      expectedYes: PROPOSTA_EXPIRADA_BOTAO_MAIS_TEMPO_ID,
      expectedNo: PROPOSTA_EXPIRADA_BOTAO_RECUSAR_ID,
    });
    return true;
  } catch (e: any) {
    console.error(`[proposta ${p.propostaId}] falha ao enviar mensagem de expiração com botões:`, e?.message || e);
    return false;
  }
}

/**
 * Concede a extensão única de prazo (botão "Preciso de mais tempo").
 * UPDATE atômico com guarda `prazo_estendido_em IS NULL` no WHERE — evita
 * condição de corrida e serve de fonte da verdade pra "já foi usada":
 * `affectedRows > 0` só acontece na 1ª vez. Retorna false (sem concender
 * nada) se a extensão já tinha sido usada antes.
 */
export async function concederExtensaoPrazo(propostaId: number): Promise<boolean> {
  const [r] = await db.query(
    "UPDATE propostas SET status = 'enviada', prazo_estendido_em = NOW() WHERE id = ? AND prazo_estendido_em IS NULL",
    [propostaId]
  ) as any;
  return r.affectedRows > 0;
}

/** Fecha a proposta definitivamente (cron de 2ª janela, ver runFechamentoDefinitivoPropostas). */
export async function fecharPropostaDefinitivamente(propostaId: number): Promise<void> {
  await db.query("UPDATE propostas SET status = 'expirada' WHERE id = ?", [propostaId]);
}

export function digitsOf(phone: string): string {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length <= 11) d = '55' + d;
  return d;
}

// ── Mensagem de recusa de proposta (PATCH /:id/status, status='recusada') ──
// Objetivo: manter o contato próximo mesmo sem fechar negócio dessa vez —
// se coloca à disposição, pede pra salvar o contato e seguir o Instagram, e
// pergunta (com botões nativos Sim/Não) se a pessoa quer continuar recebendo
// os informativos jurídicos do escritório.
export const NEWSLETTER_BOTAO_SIM_ID = 'newsletter_sim';
export const NEWSLETTER_BOTAO_NAO_ID = 'newsletter_nao';

export function msgPropostaRecusada(nome: string): string {
  return [
    `Olá${primeiroNome(nome) ? ', ' + primeiroNome(nome) : ''}! Vi que a proposta não seguiu adiante dessa vez. De todo modo, muito obrigada pelo seu tempo e pela confiança em nos procurar.`,
    `Se surgir qualquer dúvida ou outra situação em que possamos ajudar, seguimos à disposição, é só chamar por aqui.`,
    `Aproveita e salva nosso contato, assim fica mais fácil nos encontrar quando precisar. E para acompanhar o dia a dia do escritório, nos siga no Instagram:\n📷 ${INSTAGRAM_URL}`,
    `Por último: quer continuar recebendo nossos informativos e ficar por dentro dos seus direitos?`,
  ].join('\n\n');
}

/**
 * Dispara o fluxo completo de "não fechamos dessa vez": mensagem calorosa
 * (msgPropostaRecusada) + pergunta de newsletter com botões Sim/Não,
 * gravando a pendência pro webhook casar a resposta depois. Compartilhado
 * entre 3 chamadores: PATCH /:id/status (recusa manual), o botão "Recusar"
 * da proposta expirada, e o fechamento definitivo da 2ª janela (cron) —
 * mesmo texto, mesma mecânica, sem duplicar em nenhum dos três.
 * Best-effort: nunca lança, só loga — quem chama decide se precisa do
 * retorno (hoje nenhum chamador trava a mudança de status por causa disso).
 */
export async function dispararRecusaProposta(p: {
  propostaId: number; leadId: number | null; clientId: number | null; phone: string; contactName: string;
}): Promise<boolean> {
  try {
    const number = digitsOf(p.phone);
    await uazapi.sendMenu(number, 'button', msgPropostaRecusada(p.contactName), [
      `Sim|${NEWSLETTER_BOTAO_SIM_ID}`,
      `Não|${NEWSLETTER_BOTAO_NAO_ID}`,
    ]);
    await createPendingReply({
      phone: number,
      tipo: 'newsletter_opt_in',
      leadId: p.leadId,
      clientId: p.clientId,
      propostaId: p.propostaId,
      expectedYes: NEWSLETTER_BOTAO_SIM_ID,
      expectedNo: NEWSLETTER_BOTAO_NAO_ID,
    });
    return true;
  } catch (e: any) {
    console.error(`[proposta ${p.propostaId}] falha ao enviar mensagem de recusa/newsletter:`, e?.message || e);
    return false;
  }
}

export function msgNewsletterConfirmado(nome: string): string {
  return `Prontinho${primeiroNome(nome) ? ', ' + primeiroNome(nome) : ''}! Você está cadastrada nos nossos informativos. 🎉 Qualquer dúvida, estamos por aqui.`;
}

// ── Lembrete de 24h sem resposta ao opt-in de newsletter (ver
// src/services/pendingWhatsappReminderService.ts). Só é mandado uma vez,
// reforçando a mesma pergunta, com os mesmos botões Sim/Não da mensagem
// original — nunca gera um novo /send/menu do zero.
export function msgLembreteNewsletterOptIn(nome: string): string {
  return `Oi${primeiroNome(nome) ? ', ' + primeiroNome(nome) : ''}! Só passando pra saber: você ainda quer continuar recebendo nossos informativos jurídicos? 😊`;
}

export function msgNewsletterRecusado(): string {
  return `Tudo bem, obrigada pelo retorno! Qualquer coisa, estamos à disposição.`;
}

export async function runPropostaFollowups(): Promise<{ enviados48h: number; enviados5d: number; enviados7d: number; backfill: number }> {
  // Só propostas em 'enviada' — se ela já marcou 'em_negociacao' manualmente,
  // está conduzindo a conversa por conta própria e o automático dá um passo atrás.
  const [rows] = await db.query(`
    SELECT id, lead_id, client_id, contact_name, phone, public_token, enviada_em,
           followup_48h_at, followup_5d_at, followup_7d_at
      FROM propostas
     WHERE status = 'enviada'
       AND aceito_em IS NULL
       AND enviada_em IS NOT NULL
       AND phone IS NOT NULL AND phone <> ''
  `) as any;

  let enviados48h = 0, enviados5d = 0, enviados7d = 0, backfill = 0;
  const agora = Date.now();
  const HORA = 3600 * 1000;

  for (const p of rows) {
    const enviadaEm = new Date(p.enviada_em).getTime();
    const horasDesdeEnvio = (agora - enviadaEm) / HORA;
    const link = p.public_token ? LINK_BASE + p.public_token : null;

    // Backfill silencioso: proposta antiga (>14 dias) que nunca recebeu follow-up
    // nenhum — não faz sentido reabrir contato do nada, só fecha o ciclo.
    if (!p.followup_48h_at && horasDesdeEnvio > 14 * 24) {
      await db.query(
        'UPDATE propostas SET followup_48h_at = enviada_em, followup_5d_at = enviada_em, followup_7d_at = enviada_em WHERE id = ?',
        [p.id]
      );
      backfill++;
      continue;
    }

    if (!p.followup_7d_at && horasDesdeEnvio >= 7 * 24) {
      const ok = await dispararPropostaExpirada({
        propostaId: p.id, leadId: p.lead_id ?? null, clientId: p.client_id ?? null,
        phone: p.phone, contactName: p.contact_name,
      });
      if (ok) {
        await db.query("UPDATE propostas SET followup_7d_at = NOW(), status = 'expirada' WHERE id = ?", [p.id]);
        enviados7d++;
      }
    } else if (!p.followup_5d_at && horasDesdeEnvio >= 5 * 24 && link) {
      const ok = await sendText(digitsOf(p.phone), msg5d(p.contact_name, link), 'Automático — follow-up proposta 5 dias').catch(() => false);
      if (ok) { await db.query('UPDATE propostas SET followup_5d_at = NOW() WHERE id = ?', [p.id]); enviados5d++; }
    } else if (!p.followup_48h_at && horasDesdeEnvio >= 48 && link) {
      const ok = await sendText(digitsOf(p.phone), msg48h(p.contact_name, link), 'Automático — follow-up proposta 48h').catch(() => false);
      if (ok) { await db.query('UPDATE propostas SET followup_48h_at = NOW() WHERE id = ?', [p.id]); enviados48h++; }
    }
  }

  return { enviados48h, enviados5d, enviados7d, backfill };
}

/**
 * Fechamento definitivo da 2ª janela: proposta que usou a extensão única
 * de prazo (prazo_estendido_em preenchido) e sumiu de novo — mais 7 dias
 * sem responder nada, ainda em 'enviada'. Fecha com status = 'expirada'
 * (ela nunca disse não, só sumiu de novo — NÃO é 'recusada') e manda a
 * MESMA mensagem calorosa de fechamento (dispararRecusaProposta), sem
 * oferecer uma 3ª chance de prazo. Silencioso do lado da Letícia — só
 * fecha o ciclo com o cliente.
 */
export async function runFechamentoDefinitivoPropostas(): Promise<{ fechadas: number }> {
  const [rows] = await db.query(`
    SELECT id, lead_id, client_id, contact_name, phone
      FROM propostas
     WHERE status = 'enviada'
       AND prazo_estendido_em IS NOT NULL
       AND prazo_estendido_em <= NOW() - INTERVAL 7 DAY
  `) as any;

  let fechadas = 0;
  for (const p of rows) {
    // Fecha o status sempre — mesmo se o WhatsApp falhar, a proposta não
    // pode continuar "em aberto" pra sempre depois de já ter usado a
    // extensão e sumido de novo.
    await fecharPropostaDefinitivamente(p.id);
    if (p.phone) {
      await dispararRecusaProposta({
        propostaId: p.id, leadId: p.lead_id ?? null, clientId: p.client_id ?? null,
        phone: p.phone, contactName: p.contact_name,
      });
    }
    fechadas++;
  }
  return { fechadas };
}
