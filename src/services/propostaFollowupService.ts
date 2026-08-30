import { db } from '../config/database';
import { sendText } from './uazapiInstance';

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
    `Qualquer dúvida sobre as condições, é só responder por aqui — estou à disposição.`,
  ].join('\n\n');
}

function msg5d(nome: string, link: string): string {
  return [
    `Olá${primeiroNome(nome) ? ', ' + primeiroNome(nome) : ''}! Sua proposta de honorários está próxima do vencimento.`,
    `Se tiver alguma dúvida ou quiser conversar sobre as condições, este é um bom momento — *podemos negociar* para encontrar o melhor caminho para você buscar seus direitos.`,
    `Acesse a proposta aqui: ${link}`,
  ].join('\n\n');
}

function msg7d(nome: string): string {
  return [
    `Olá${primeiroNome(nome) ? ', ' + primeiroNome(nome) : ''}! Sua proposta de honorários chegou ao prazo final e foi encerrada.`,
    `Se ainda tiver interesse, é só me chamar por aqui que providenciamos uma nova proposta.`,
    `Enquanto isso, nos siga no Instagram para acompanhar o dia a dia do escritório:\n📷 ${INSTAGRAM_URL}`,
    `E acompanhe nosso blog, onde mostramos seus direitos:\n🔗 ${BLOG_URL}`,
    `Continuamos à disposição sempre que precisar.`,
  ].join('\n\n');
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
    `Olá${primeiroNome(nome) ? ', ' + primeiroNome(nome) : ''}! Vi que a proposta não seguiu adiante dessa vez — de todo modo, muito obrigada pelo seu tempo e pela confiança em nos procurar.`,
    `Se surgir qualquer dúvida ou outra situação em que possamos ajudar, seguimos à disposição — é só chamar por aqui.`,
    `Aproveita e salva nosso contato, assim fica mais fácil nos encontrar quando precisar. E para acompanhar o dia a dia do escritório, nos siga no Instagram:\n📷 ${INSTAGRAM_URL}`,
    `Por último: quer continuar recebendo nossos informativos e ficar por dentro dos seus direitos?`,
  ].join('\n\n');
}

export function msgNewsletterConfirmado(nome: string): string {
  return `Prontinho${primeiroNome(nome) ? ', ' + primeiroNome(nome) : ''}! Você está cadastrada nos nossos informativos. 🎉 Qualquer dúvida, estamos por aqui.`;
}

export function msgNewsletterRecusado(): string {
  return `Tudo bem, obrigada pelo retorno! Qualquer coisa, estamos à disposição.`;
}

export async function runPropostaFollowups(): Promise<{ enviados48h: number; enviados5d: number; enviados7d: number; backfill: number }> {
  // Só propostas em 'enviada' — se ela já marcou 'em_negociacao' manualmente,
  // está conduzindo a conversa por conta própria e o automático dá um passo atrás.
  const [rows] = await db.query(`
    SELECT id, contact_name, phone, public_token, enviada_em, followup_48h_at, followup_5d_at, followup_7d_at
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
      const ok = await sendText(digitsOf(p.phone), msg7d(p.contact_name), 'Automático — follow-up proposta 7 dias').catch(() => false);
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
