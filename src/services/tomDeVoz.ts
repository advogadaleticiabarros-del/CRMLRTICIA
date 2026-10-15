/**
 * Tom de voz da Dra.: o CRM lê as mensagens que a equipe escreveu de próprio
 * punho (no celular ou no CRM), sem as automáticas, tira os dados pessoais e
 * pede à IA um guia de como o escritório conversa. O guia orienta a Dra.
 * Lívia (atendente) e fica no Cérebro. Regras puras — tests/atendenteSociedade.test.mjs.
 */

const AUTOMATICO = /autom|agente|envio autom|assistente|lembrete|sistema|\bbot\b|fila|cobran/i;

/** Mensagem escrita por uma pessoa? (no celular o sent_by vem vazio; o que é automático diz quem mandou). */
export function ehMensagemHumana(sentBy: string | null | undefined): boolean {
  return !sentBy || !AUTOMATICO.test(String(sentBy));
}

/** Tira CPF, CNPJ, telefone, e-mail e número de processo antes de mandar à IA. */
export function mascararDadosPessoais(texto: string): string {
  return String(texto || '')
    .replace(/\b\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}\b/g, '[processo]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[e-mail]')
    .replace(/(\(?\b\d{2}\)?\s?)?\b9?\d{4}[-\s]?\d{4}\b/g, '[telefone]');
}

export interface MensagemWa { phone: string; from_me: number | boolean; body: string; sent_by: string | null; msg_time: string | Date }

/** Trechos de conversa (cliente ↔ escritório) em que alguém da equipe respondeu de próprio punho. */
export function trechosDeConversa(msgs: MensagemWa[], excluirTelefones: string[], maxConversas = 40, maxPorConversa = 14): string[] {
  const fim8 = (p: string) => String(p || '').replace(/\D/g, '').slice(-8);
  const excluir = new Set(excluirTelefones.map(fim8));
  const porFone = new Map<string, MensagemWa[]>();
  for (const m of msgs) {
    const k = fim8(m.phone);
    if (!k || excluir.has(k)) continue;
    porFone.set(k, [...(porFone.get(k) || []), m]);
  }
  const grupos = [...porFone.values()]
    .map((lista) => lista.sort((a, b) => new Date(a.msg_time).getTime() - new Date(b.msg_time).getTime()))
    .filter((lista) => lista.some((m) => m.from_me && ehMensagemHumana(m.sent_by)))
    .sort((a, b) => new Date(b[b.length - 1].msg_time).getTime() - new Date(a[a.length - 1].msg_time).getTime())
    .slice(0, maxConversas);
  return grupos.map((lista) => lista
    .filter((m) => !m.from_me || ehMensagemHumana(m.sent_by))
    .slice(-maxPorConversa)
    .map((m) => `${m.from_me ? 'Escritório' : 'Cliente'}: ${mascararDadosPessoais(String(m.body || '').replace(/\s+/g, ' ').slice(0, 300))}`)
    .join('\n'));
}

export function promptGuia(trechos: string[]): string {
  return `Você analisa como um escritório de advocacia conversa com clientes e parceiros no WhatsApp.
Abaixo, conversas reais (dados pessoais já removidos). Descreva o TOM DE VOZ de quem responde pelo escritório ("Escritório:"),
para que um atendente novo escreva igual. Use só o que aparece nas conversas.
Responda SOMENTE com JSON:
{"resumo":"2-3 linhas sobre o jeito de atender","tratamento":"como chama o cliente (você/senhora/primeiro nome/querida…)",
 "saudacoes":["frases de abertura usadas"],"despedidas":["frases de fechamento usadas"],"emojis":"quais e com que frequência",
 "tamanho":"mensagens curtas ou longas, uma ou várias","expressoes":["expressões típicas"],
 "como_pede_documentos":"como pede documentos","como_explica":"como explica andamento e prazos",
 "como_acolhe":"como lida com cliente ansioso ou bravo","evita":["o que nunca faz"],
 "exemplos":["5 a 8 frases reais típicas, já sem dados pessoais"]}

CONVERSAS:
${trechos.join('\n\n---\n\n').slice(0, 60000)}`;
}

export interface GuiaTomDeVoz {
  resumo: string; tratamento: string; saudacoes: string[]; despedidas: string[]; emojis: string; tamanho: string;
  expressoes: string[]; como_pede_documentos: string; como_explica: string; como_acolhe: string; evita: string[]; exemplos: string[];
}

const txt = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const lst = (v: unknown, n = 10) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, n) : []);

export function parseGuia(resposta: string): GuiaTomDeVoz | null {
  const limpo = String(resposta || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!limpo.startsWith('{')) return null;
  let o: any;
  try { o = JSON.parse(limpo); } catch { return null; }
  if (!txt(o?.resumo)) return null;
  return {
    resumo: txt(o.resumo), tratamento: txt(o.tratamento), saudacoes: lst(o.saudacoes), despedidas: lst(o.despedidas),
    emojis: txt(o.emojis), tamanho: txt(o.tamanho), expressoes: lst(o.expressoes, 15), como_pede_documentos: txt(o.como_pede_documentos),
    como_explica: txt(o.como_explica), como_acolhe: txt(o.como_acolhe), evita: lst(o.evita), exemplos: lst(o.exemplos, 8),
  };
}

export function guiaEmTexto(g: GuiaTomDeVoz): string {
  const item = (t: string, v: string | string[]) => (Array.isArray(v) ? (v.length ? `**${t}:**\n${v.map((x) => `- ${x}`).join('\n')}` : '') : v ? `**${t}:** ${v}` : '');
  return [
    '# Guia de tom de voz do escritório', '', '_Aprendido das conversas reais da equipe no WhatsApp (dados pessoais removidos). Gerado pelo CRM._', '',
    g.resumo, '',
    item('Tratamento', g.tratamento), item('Saudações', g.saudacoes), item('Despedidas', g.despedidas), item('Emojis', g.emojis),
    item('Tamanho das mensagens', g.tamanho), item('Expressões típicas', g.expressoes), item('Como pede documentos', g.como_pede_documentos),
    item('Como explica andamento e prazos', g.como_explica), item('Como acolhe', g.como_acolhe), item('Evita', g.evita), item('Exemplos', g.exemplos),
  ].filter((l) => l !== '').join('\n\n');
}
