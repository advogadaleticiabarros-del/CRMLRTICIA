/**
 * Regras puras do assistente pessoal do CRM pelo WhatsApp (desde 08/10/2026).
 * Sem banco e sem IA aqui: quem conversa com o mundo é assistenteWhatsapp.ts.
 * Ver docs/manual/03-whatsapp.md (Assistente pessoal).
 */

// ── Quem pode dar ordens ────────────────────────────────────────────────────

/** Padrão: Dra. Letícia e Jessica (pedido de 08/10/2026). Trocável em office_settings.assistente_whatsapp_numeros. */
export const COMANDANTES_PADRAO = '5544991011402,5527988798093';

export function parseNumerosComandantes(setting: string | null | undefined): string[] {
  return String(setting || '').split(/[,;\s]+/).map((n) => n.replace(/\D/g, '')).filter((n) => n.length >= 10);
}

/** DDD + 8 últimos dígitos: o WhatsApp às vezes entrega o número sem o 9º dígito. */
export function chaveFone(p: string): string | null {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

export function ehComandante(phone: string, lista: string[]): boolean {
  const k = chaveFone(phone);
  return !!k && lista.some((n) => chaveFone(n) === k);
}

// ── Confirmação (sim / não) ────────────────────────────────────────────────

/**
 * "sim", "pode lançar", "ok 👍", "sim 2" → confirma (com o nº da pendência, se veio).
 * "não", "cancela" → cancela. Qualquer coisa a mais depois do "não" (ex.: "não,
 * é pessoal") NÃO é cancelamento: é correção e vai para a IA.
 */
export function interpretarConfirmacao(texto: string): { resposta: 'sim' | 'nao'; indice: number | null } | null {
  const t = String(texto || '').trim().toLowerCase().replace(/[!.👍✅]+/g, ' ').replace(/\s+/g, ' ').trim();
  const sim = t.match(/^(sim|s|ok|okay|pode|pode lançar|pode lancar|pode dar baixa|confirmo|confirma|confirmado|isso|positivo|manda|lança|lanca)(?: (\d{1,2}))?$/);
  if (sim) return { resposta: 'sim', indice: sim[2] ? Number(sim[2]) : null };
  const nao = t.match(/^(não|nao|n|cancela|cancelar|cancelado|negativo|deixa|esquece)(?: (\d{1,2}))?$/);
  if (nao) return { resposta: 'nao', indice: nao[2] ? Number(nao[2]) : null };
  return null;
}

// ── Categorias de saída (mesmas da tela Contas a Pagar) ────────────────────

export const CATEGORIAS_SAIDA: Record<string, string> = {
  empresa: 'Empresa / Escritório', pessoal: 'Pessoal', cartao: 'Cartão de crédito', moradia: 'Moradia',
  impostos: 'Impostos & Tributos', salarios: 'Salários & Folha', fornecedores: 'Fornecedores',
  software: 'Software & Assinaturas', marketing: 'Marketing', transporte: 'Transporte & Deslocamento',
  extraordinaria: 'Despesas extraordinárias', outro_saida: 'Outras saídas',
};

// ── O que a IA devolve → ação validada ─────────────────────────────────────

export interface Lancamento {
  tipo: 'conta_pagar' | 'gasto';
  descricao: string; valor: number; data: string; categoria: string;
  escopo: 'empresa' | 'pessoal'; codigo: string | null;
}
export type Acao =
  | Lancamento
  | { tipo: 'processo'; busca: string }
  | { tipo: 'agenda'; de: string; ate: string }
  | { tipo: 'responder'; texto: string };

export function lerJson(texto: string): any | null {
  const t = String(texto || '').replace(/```(?:json)?/g, '');
  const i = t.indexOf('{'); const j = t.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(t.slice(i, j + 1)); } catch { return null; }
}

/** "R$ 1.312,40" / "312,4" / 312.4 → 312.4 */
export function valorBR(v: any): number | null {
  if (typeof v === 'number') return v > 0 ? Math.round(v * 100) / 100 : null;
  const s = String(v ?? '').replace(/[^\d,.]/g, '');
  if (!s) return null;
  const n = /,\d{1,2}$/.test(s) ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** "15/10/2026" ou "2026-10-15" → "2026-10-15" (data inválida → null) */
export function dataISO(v: any): string | null {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  let iso = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  if (!iso) { m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); iso = m ? `${m[3]}-${m[2]}-${m[1]}` : null; }
  if (!iso) return null;
  const d = new Date(iso + 'T12:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

function somaDias(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function parseAcao(texto: string, hoje: string): Acao | null {
  const j = lerJson(texto);
  if (!j || typeof j !== 'object') return null;
  const acao = String(j.acao || '').toLowerCase();

  if (acao === 'conta_pagar' || acao === 'gasto') {
    const descricao = String(j.descricao || '').trim().slice(0, 200) || (acao === 'gasto' ? 'Gasto' : 'Conta a pagar');
    const valor = valorBR(j.valor);
    if (!valor) return { tipo: 'responder', texto: `Qual é o valor de "${descricao}"?` };
    let data = dataISO(j.data);
    if (!data && acao === 'conta_pagar') return { tipo: 'responder', texto: `Qual é o vencimento de "${descricao}"? (ex.: 15/10)` };
    if (!data) data = hoje;
    const escopo = j.escopo === 'pessoal' ? 'pessoal' : 'empresa';
    const categoria = CATEGORIAS_SAIDA[j.categoria] ? String(j.categoria) : escopo;
    const codigo = j.codigo ? String(j.codigo).trim().slice(0, 120) || null : null;
    return { tipo: acao, descricao, valor, data, categoria, escopo, codigo };
  }
  if (acao === 'processo') {
    const busca = String(j.busca || '').trim();
    return busca ? { tipo: 'processo', busca: busca.slice(0, 120) } : { tipo: 'responder', texto: 'De qual cliente (ou qual número de processo)?' };
  }
  if (acao === 'agenda') {
    let de = dataISO(j.data_inicio) || hoje;
    let ate = dataISO(j.data_fim) || de;
    if (ate < de) [de, ate] = [ate, de];
    const limite = somaDias(de, 30);
    if (ate > limite) ate = limite;
    return { tipo: 'agenda', de, ate };
  }
  if (acao === 'responder') {
    const t = String(j.texto || '').trim();
    return t ? { tipo: 'responder', texto: t.slice(0, 1500) } : null;
  }
  return null;
}

/** Prompt de interpretação: a IA só classifica e extrai — quem executa é o código. */
export function promptAssistente(opts: { hoje: string; diaSemana: string; mensagem: string; documento?: any; pendente?: Lancamento | null }): string {
  const cats = Object.keys(CATEGORIAS_SAIDA).join(', ');
  return `Você é o assistente pessoal do CRM de um escritório de advocacia (Dra. Letícia Barros). Hoje é ${opts.diaSemana}, ${opts.hoje}.
Interprete o pedido e responda SOMENTE um JSON, com UMA destas ações:
- {"acao":"conta_pagar","descricao":"...","valor":123.45,"data":"AAAA-MM-DD (vencimento)","categoria":"...","escopo":"empresa|pessoal","codigo":"linha digitável, se houver"} → boleto/conta que AINDA vai ser paga.
- {"acao":"gasto","descricao":"...","valor":123.45,"data":"AAAA-MM-DD (dia do gasto; hoje se não disser)","categoria":"...","escopo":"empresa|pessoal"} → algo que JÁ foi pago/gasto.
- {"acao":"processo","busca":"nome do cliente ou nº do processo"} → pergunta sobre processo de cliente.
- {"acao":"agenda","data_inicio":"AAAA-MM-DD","data_fim":"AAAA-MM-DD"} → pergunta sobre agenda/compromissos/audiências (resolva "amanhã", "quinta", "semana que vem" a partir de hoje).
- {"acao":"responder","texto":"..."} → cumprimento, dúvida sobre o que você faz, ou pedido fora dessas ações (diga com educação o que você consegue fazer: lançar contas a pagar e gastos, consultar processos e agenda).
Categorias permitidas: ${cats}. Escopo "empresa" = escritório; "pessoal" = casa/família. Na dúvida, escopo "empresa".
Valores em número (312.40). Nunca invente valor ou data que não estejam no pedido ou no documento.${opts.pendente ? `
Há um lançamento aguardando confirmação: ${JSON.stringify(opts.pendente)}. Se a mensagem for uma CORREÇÃO dele (ex.: "é pessoal", "o valor é 300", "vence dia 20"), devolva o mesmo tipo de ação com TODOS os campos já corrigidos.` : ''}${opts.documento ? `
Documento enviado junto (lido por IA): ${JSON.stringify(opts.documento)}. Se for boleto/conta e o pedido não disser outra coisa, é "conta_pagar"; se for comprovante/nota de algo já pago, é "gasto".` : ''}
Mensagem: """${String(opts.mensagem || '').slice(0, 2000)}"""`;
}

// ── Leitura de documento (boleto, conta, comprovante) ──────────────────────

export const PROMPT_LEITURA_DOCUMENTO = 'Leia este documento e responda SOMENTE JSON: {"tipo":"boleto|conta|comprovante|nota_fiscal|outro",'
  + '"descricao":"o que é, em poucas palavras","beneficiario":"quem recebe (boleto/conta)","valor":"1234,56",'
  + '"vencimento":"dd/mm/aaaa","data_pagamento":"dd/mm/aaaa (comprovante)","linha_digitavel":"...",'
  + '"destinatario_nome":"nome de quem RECEBEU o pagamento (comprovante)","destinatario_chave":"chave PIX/CPF/conta de quem recebeu"}. '
  + 'Não invente: deixe vazio o que não estiver escrito.';

export interface LeituraDocumento {
  tipo: 'boleto' | 'conta' | 'comprovante' | 'nota_fiscal' | 'outro';
  descricao: string | null; beneficiario: string | null; valor: number | null;
  vencimento: string | null; data_pagamento: string | null; linha_digitavel: string | null;
  destinatario_nome: string | null; destinatario_chave: string | null;
}

export function parseLeituraDocumento(texto: string): LeituraDocumento | null {
  const j = lerJson(texto);
  if (!j) return null;
  const s = (v: any) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().slice(0, 200));
  const tipos = ['boleto', 'conta', 'comprovante', 'nota_fiscal', 'outro'];
  return {
    tipo: (tipos.includes(String(j.tipo)) ? j.tipo : 'outro') as LeituraDocumento['tipo'],
    descricao: s(j.descricao), beneficiario: s(j.beneficiario), valor: valorBR(j.valor),
    vencimento: dataISO(j.vencimento), data_pagamento: dataISO(j.data_pagamento), linha_digitavel: s(j.linha_digitavel),
    destinatario_nome: s(j.destinatario_nome), destinatario_chave: s(j.destinatario_chave),
  };
}

/** O PIX foi para a Dra. Letícia? true/false, ou null quando o comprovante não mostra. */
export function destinatarioConfere(l: { destinatario_nome: string | null; destinatario_chave: string | null }): boolean | null {
  const semAcento = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const chave = String(l.destinatario_chave || '');
  if (chave) {
    const dig = chave.replace(/\D/g, '');
    if (dig.includes('13451070723') || /510\.?707/.test(chave) || /advleticiabarros|advogadaleticia/i.test(chave)) return true;
  }
  const nome = semAcento(String(l.destinatario_nome || ''));
  if (nome) return /LETICIA/.test(nome) && /BARROS/.test(nome);
  return chave ? false : null;
}

// ── Comprovante × parcelas em aberto ───────────────────────────────────────

export interface ItemAberto { fonte: string; id: number; descricao: string; valor: number; vencimento: string | null }

/** Mesmo valor (±1 centavo); entre vários, o vencimento mais próximo da data do pagamento. */
export function casarComprovante(c: { valor: number | null; data: string | null }, abertos: ItemAberto[]): ItemAberto | null {
  if (!c.valor) return null;
  const iguais = abertos.filter((a) => Math.abs(Number(a.valor) - Number(c.valor)) < 0.011);
  if (!iguais.length) return null;
  const ref = new Date((c.data || new Date().toISOString().slice(0, 10)) + 'T12:00:00Z').getTime();
  const dist = (a: ItemAberto) => (a.vencimento ? Math.abs(new Date(String(a.vencimento).slice(0, 10) + 'T12:00:00Z').getTime() - ref) : Infinity);
  return [...iguais].sort((a, b) => dist(a) - dist(b))[0];
}

// ── Textos das respostas ───────────────────────────────────────────────────

export const moedaBR = (n: number) => `R$ ${(Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const dataBR = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');

export function textoConfirmacao(l: Lancamento): string {
  const onde = l.tipo === 'conta_pagar' ? '🧾 *Contas a Pagar*' : '💸 *Gasto (já pago)*';
  const quando = l.tipo === 'conta_pagar' ? `Vencimento: ${dataBR(l.data)}` : `Data: ${dataBR(l.data)}`;
  return `${onde}\n${l.descricao}\nValor: *${moedaBR(l.valor)}*\n${quando}\nCategoria: ${CATEGORIAS_SAIDA[l.categoria] || l.categoria}\n`
    + `Conta: ${l.escopo === 'pessoal' ? 'pessoal (casa/família)' : 'escritório'}`
    + `${l.codigo ? `\nCódigo: ${l.codigo}` : ''}\n\nConfirma? Responda *sim* ou *não* (ou me diga o que corrigir).`;
}

export interface ItemAgenda { data: string; hora: string | null; tipo: string; titulo: string; local: string | null }
const ICONE: Record<string, string> = { audiencia: '⚖️', prazo: '⏰', tarefa: '✅', reuniao: '👥', compromisso: '📌', pessoal: '🏠', recado: '📝', medicamento: '💊' };
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function formatarAgenda(itens: ItemAgenda[], de: string, ate: string): string {
  const periodo = de === ate ? `${DIAS[new Date(de + 'T12:00:00Z').getUTCDay()]}, ${dataBR(de)}` : `${dataBR(de)} a ${dataBR(ate)}`;
  if (!itens.length) return `📅 Agenda de ${periodo}: nada marcado.`;
  const porDia = new Map<string, ItemAgenda[]>();
  for (const i of [...itens].sort((a, b) => (a.data + (a.hora || '99')).localeCompare(b.data + (b.hora || '99')))) {
    if (!porDia.has(i.data)) porDia.set(i.data, []);
    porDia.get(i.data)!.push(i);
  }
  const blocos = [...porDia.entries()].map(([d, lista]) =>
    `*${DIAS[new Date(d + 'T12:00:00Z').getUTCDay()]}, ${dataBR(d).slice(0, 5)}*\n` +
    lista.map((i) => `${ICONE[i.tipo] || '•'} ${i.hora ? i.hora + ' — ' : ''}${i.titulo}${i.local ? ` (${i.local})` : ''}`).join('\n'));
  return `📅 Agenda de ${periodo}:\n\n${blocos.join('\n\n')}`;
}

export interface ProcessoInfo { cliente: string; numero: string | null; area: string | null; fase: string | null; status: string | null; titulo: string | null; tribunal: string | null }
const FASE_PT: Record<string, string> = { inicial: 'inicial', instrucao: 'instrução', sentenca: 'sentença', recurso: 'recurso', execucao: 'execução', encerrado: 'encerrado' };

export function formatarProcessos(lista: ProcessoInfo[], busca: string): string {
  if (!lista.length) return `Não encontrei processo para "${busca}". Confira o nome (ou mande o nº do processo).`;
  const linhas = lista.slice(0, 8).map((p) =>
    `👤 *${p.cliente}*\n📄 ${p.numero || 'sem número (ainda não protocolado)'}${p.tribunal ? ` · ${p.tribunal}` : ''}\n` +
    `${p.titulo ? p.titulo + '\n' : ''}Área: ${p.area || '—'} · Fase: ${p.fase ? FASE_PT[p.fase] || p.fase : '—'}${p.status && p.status !== 'ativo' ? ` · ${p.status}` : ''}`);
  return linhas.join('\n\n') + (lista.length > 8 ? `\n\n…e mais ${lista.length - 8}. Seja mais específica no nome.` : '');
}
