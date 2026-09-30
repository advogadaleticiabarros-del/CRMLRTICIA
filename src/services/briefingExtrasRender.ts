/**
 * Blocos do briefing matinal que faltavam (diagnóstico ago/2026) — render
 * puro para e-mail e WhatsApp. As consultas ficam em `briefingExtras.ts`.
 */

export interface BriefingExtras {
  whatsappAguardando: { nome: string; horas: number }[];
  docsRecebidos: number;
  naoAnalisadas: string[];      // nº de processo com movimentação sem análise da IA
  falhasConsulta: string[];     // nº de processo cuja consulta ao tribunal falhou (24h)
  parcelasAtrasadas: { qtd: number; total: number };
  repassesCliente: { qtd: number; total: number };
  leadsSemResposta24h: string[];
  saude: { rotinasComErro: string[]; backupOk: boolean };
}

const brl = (n: number) => `R$ ${(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const lista = (xs: string[], max = 5) => xs.slice(0, max).join(', ') + (xs.length > max ? ` +${xs.length - max}` : '');

/** Linhas em texto simples (sem marcação), na ordem de importância. */
function linhas(e: BriefingExtras): { icone: string; titulo: string; texto: string }[] {
  const out: { icone: string; titulo: string; texto: string }[] = [];
  if (e.whatsappAguardando.length) out.push({ icone: '💬', titulo: 'WhatsApp aguardando sua resposta', texto: e.whatsappAguardando.slice(0, 6).map((w) => `${w.nome} (${w.horas}h)`).join(', ') + (e.whatsappAguardando.length > 6 ? ` +${e.whatsappAguardando.length - 6}` : '') });
  if (e.leadsSemResposta24h.length) out.push({ icone: '📥', titulo: 'Leads sem resposta há 24h+', texto: lista(e.leadsSemResposta24h) });
  if (e.parcelasAtrasadas.qtd) out.push({ icone: '💸', titulo: 'Cobrança', texto: `${e.parcelasAtrasadas.qtd} parcela(s) atrasada(s) — ${brl(e.parcelasAtrasadas.total)}` });
  if (e.repassesCliente.qtd) out.push({ icone: '🤝', titulo: 'Repasse ao cliente pendente', texto: `${e.repassesCliente.qtd} repasse(s) de acordo — ${brl(e.repassesCliente.total)}` });
  if (e.docsRecebidos) out.push({ icone: '📎', titulo: 'Documentos recebidos no WhatsApp (24h)', texto: `${e.docsRecebidos} arquivo(s) — confira em Documentos` });
  if (e.naoAnalisadas.length) out.push({ icone: '🔎', titulo: 'Publicações não analisadas pela IA', texto: `processos ${lista(e.naoAnalisadas)} — leia manualmente` });
  if (e.falhasConsulta.length) out.push({ icone: '⚠️', titulo: 'Consultas ao tribunal que falharam (24h)', texto: `processos ${lista(e.falhasConsulta)} — conferir manualmente` });
  const saude: string[] = [];
  if (!e.saude.backupOk) saude.push('backup das últimas 24h não confirmado');
  if (e.saude.rotinasComErro.length) saude.push(`rotinas com erro: ${lista(e.saude.rotinasComErro)}`);
  if (saude.length) out.push({ icone: '🩺', titulo: 'Saúde do CRM', texto: saude.join(' · ') });
  return out;
}

export function extrasWhatsapp(e: BriefingExtras): string {
  const l = linhas(e);
  if (!l.length) return '';
  return `📌 *Também precisa de você*\n${l.map((x) => `${x.icone} *${x.titulo}:* ${x.texto}`).join('\n')}`;
}

export function extrasHtml(e: BriefingExtras, navy = '#1f3047'): string {
  const l = linhas(e);
  if (!l.length) return '';
  return `<h3 style="color:${navy};font-size:15px;margin:22px 0 8px;font-family:Georgia,serif">Também precisa de você</h3>
    ${l.map((x) => `<p style="margin:0 0 7px;font-size:13.5px;line-height:1.5;color:#232323">${x.icone} <strong>${esc(x.titulo)}:</strong> ${esc(x.texto)}</p>`).join('')}`;
}

/** Quantos itens extras contam como urgentes no assunto do e-mail. */
export function criticosExtras(e: BriefingExtras): number {
  return e.whatsappAguardando.filter((w) => w.horas >= 24).length + (e.saude.backupOk ? 0 : 1);
}
