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
  const t = String(texto || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[!.,👍✅]+/g, ' ').replace(/\s+/g, ' ').trim();
  const sim = t.match(/^(sim|s|si|sin|simm|ss|ok|okay|okey|pode|pode sim|pode ser|pode lancar|pode dar baixa|pode mandar|pode enviar|pode marcar|confirmo|confirma|confirmar|confirmado|isso|isso mesmo|positivo|claro|manda|manda ver|lanca|envia|beleza|blz|certo|perfeito)(?: (\d{1,2}))?$/);
  if (sim) return { resposta: 'sim', indice: sim[2] ? Number(sim[2]) : null };
  const nao = t.match(/^(nao|n|nn|naum|nao quero|nao precisa|cancela|cancelar|cancelado|negativo|deixa|deixa pra la|esquece)(?: (\d{1,2}))?$/);
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
export interface DadosCadastro {
  nome: string | null; cpf: string | null; rg: string | null; nascimento: string | null; endereco: string | null;
  email: string | null; telefone: string | null; estado_civil: string | null; profissao: string | null; nacionalidade: string | null;
}
export interface Compromisso { tipo: 'compromisso'; titulo: string; data: string; hora: string; duracao: number; evento: string; local: string | null; busca: string | null }
export interface Lembrete { tipo: 'lembrete'; texto: string; data: string; hora: string }
export interface Tarefa { tipo: 'tarefa'; titulo: string; data: string | null; prioridade: string; busca: string | null; descricao: string | null }
export interface RecebimentoPedido { tipo: 'recebimento'; busca: string; valor: number; data: string; forma: string; descricao: string }
export interface PagarConta { tipo: 'pagar_conta'; descricao: string; valor: number | null; data: string }
export type Acao =
  | Lancamento
  | { tipo: 'processo'; busca: string }
  | { tipo: 'agenda'; de: string; ate: string }
  | { tipo: 'responder'; texto: string }
  | { tipo: 'a_receber'; de: string; ate: string; atrasados: boolean }
  | { tipo: 'contas_vencer'; de: string; ate: string }
  | { tipo: 'prazos'; de: string; ate: string }
  | { tipo: 'cliente_dados'; busca: string }
  | { tipo: 'andamento'; busca: string }
  | { tipo: 'enviar_documento'; busca: string; documento: string }
  | Compromisso | Lembrete | Tarefa | RecebimentoPedido | PagarConta
  | { tipo: 'cadastro_cliente'; dados: DadosCadastro }
  | { tipo: 'mensagem_cliente'; busca: string; texto: string }
  | { tipo: 'acordos'; busca: string | null };

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

/** "14:00", "14h", "9h", "14h30", "9" → "HH:MM" (inválido → null) */
export function horaHM(v: any): string | null {
  const m = String(v ?? '').trim().toLowerCase().match(/^(\d{1,2})(?:[:h](\d{2})?)?\s*h?$/);
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2] || 0);
  return h <= 23 && mi <= 59 ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : null;
}

function cpfFormatado(v: any): string | null {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (String(v ?? '').trim() || null);
}

const txt = (v: any, max = 200) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
const FORMAS_RECEB: Record<string, string> = { pix: 'PIX', transferencia: 'Transferência', ted: 'Transferência', boleto: 'Boleto', cartao: 'Cartão', dinheiro: 'Dinheiro', especie: 'Dinheiro', deposito: 'Depósito judicial', alvara: 'Depósito judicial' };
const EVENTOS = ['reuniao', 'audiencia', 'compromisso', 'pessoal'];
const PRIORIDADES = ['baixa', 'media', 'alta', 'critica'];

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
  const periodo = (padraoDias: number) => {
    let de = dataISO(j.data_inicio) || hoje;
    let ate = dataISO(j.data_fim) || somaDias(de, padraoDias);
    if (ate < de) [de, ate] = [ate, de];
    const limite = somaDias(de, 92);
    return { de, ate: ate > limite ? limite : ate };
  };
  const busca = txt(j.busca, 120);
  const pedeCliente = (o: string) => ({ tipo: 'responder' as const, texto: `De qual cliente? (${o})` });

  if (acao === 'a_receber') {
    const ini = hoje.slice(0, 8) + '01';
    const fimMes = somaDias(new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), 1)).toISOString().slice(0, 10), -1);
    const de = dataISO(j.data_inicio) || ini;
    const ate = dataISO(j.data_fim) || (dataISO(j.data_inicio) ? somaDias(de, 30) : fimMes);
    return { tipo: 'a_receber', de, ate: ate < de ? de : ate, atrasados: j.atrasados === true };
  }
  if (acao === 'contas_vencer') return { tipo: 'contas_vencer', ...periodo(7) };
  if (acao === 'acordos') return { tipo: 'acordos', busca };
  if (acao === 'prazos') return { tipo: 'prazos', ...periodo(7) };
  if (acao === 'cliente_dados') return busca ? { tipo: 'cliente_dados', busca } : pedeCliente('nome completo ou parte do nome');
  if (acao === 'andamento') return busca ? { tipo: 'andamento', busca } : pedeCliente('ou o nº do processo');
  if (acao === 'enviar_documento') return busca ? { tipo: 'enviar_documento', busca, documento: txt(j.documento, 80) || '' } : pedeCliente('e qual documento');

  if (acao === 'compromisso') {
    const titulo = txt(j.titulo, 150) || 'Compromisso';
    const data = dataISO(j.data);
    if (!data) return { tipo: 'responder', texto: `Para que dia é "${titulo}"?` };
    const hora = horaHM(j.hora);
    if (!hora) return { tipo: 'responder', texto: `Qual o horário de "${titulo}"?` };
    const dur = Number(j.duracao) || 60;
    return { tipo: 'compromisso', titulo, data, hora, duracao: Math.min(480, Math.max(15, dur)), evento: EVENTOS.includes(j.evento) ? j.evento : 'compromisso', local: txt(j.local, 150), busca };
  }
  if (acao === 'lembrete') {
    const texto = txt(j.texto, 300);
    if (!texto) return { tipo: 'responder', texto: 'Do que você quer que eu te lembre?' };
    const hora = horaHM(j.hora);
    if (!hora) return { tipo: 'responder', texto: `Em que horário te lembro de "${texto}"?` };
    return { tipo: 'lembrete', texto, data: dataISO(j.data) || hoje, hora };
  }
  if (acao === 'tarefa') {
    const titulo = txt(j.titulo, 200);
    if (!titulo) return { tipo: 'responder', texto: 'Qual é a tarefa?' };
    return { tipo: 'tarefa', titulo, data: dataISO(j.data), prioridade: PRIORIDADES.includes(j.prioridade) ? j.prioridade : 'media', busca, descricao: txt(j.descricao, 500) };
  }
  if (acao === 'recebimento') {
    if (!busca) return pedeCliente('quem pagou');
    const valor = valorBR(j.valor);
    if (!valor) return { tipo: 'responder', texto: `Qual foi o valor recebido de ${busca}?` };
    let data = dataISO(j.data) || hoje;
    if (data > hoje) data = hoje;
    const f = String(j.forma || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
    return { tipo: 'recebimento', busca, valor, data, forma: FORMAS_RECEB[f] || 'PIX', descricao: txt(j.descricao, 200) || 'Pagamento recebido' };
  }
  if (acao === 'pagar_conta') {
    const descricao = txt(j.descricao, 150) || '';
    const valor = valorBR(j.valor);
    if (!descricao && !valor) return { tipo: 'responder', texto: 'Qual conta você pagou? (ex.: "paguei a conta de luz")' };
    let data = dataISO(j.data) || hoje;
    if (data > hoje) data = hoje;
    return { tipo: 'pagar_conta', descricao, valor, data };
  }
  if (acao === 'cadastro_cliente') {
    const tel = String(j.telefone ?? '').replace(/\D/g, '');
    const dados: DadosCadastro = {
      nome: txt(j.nome, 150), cpf: cpfFormatado(j.cpf), rg: txt(j.rg, 30), nascimento: dataISO(j.nascimento),
      endereco: txt(j.endereco, 300), email: txt(j.email, 150), telefone: tel.length >= 10 ? tel : null,
      estado_civil: txt(j.estado_civil, 30), profissao: txt(j.profissao, 80), nacionalidade: txt(j.nacionalidade, 40),
    };
    if (!dados.nome && !dados.cpf) return { tipo: 'responder', texto: 'Qual o nome completo (ou CPF) do cliente? Pode mandar foto do RG/CNH também.' };
    return { tipo: 'cadastro_cliente', dados };
  }
  if (acao === 'mensagem_cliente') {
    if (!busca) return pedeCliente('para quem envio');
    const texto = txt(j.texto, 1500);
    if (!texto) return { tipo: 'responder', texto: `O que você quer dizer para ${busca}?` };
    return { tipo: 'mensagem_cliente', busca, texto };
  }
  return null;
}

/** Junta dois cadastros lidos (ex.: RG e depois comprovante de residência): só completa o que falta. */
export function mesclarCadastro(a: DadosCadastro, b: DadosCadastro): DadosCadastro {
  const out: any = { ...a };
  for (const k of Object.keys(b) as (keyof DadosCadastro)[]) if (!out[k] && b[k]) out[k] = b[k];
  return out;
}

/** Prompt de interpretação: a IA só classifica e extrai — quem executa é o código. */
export function promptAssistente(opts: {
  hoje: string; diaSemana: string; mensagem: string; documento?: any; pendente?: any | null;
  historico?: { deMim: boolean; texto: string }[];
}): string {
  const cats = Object.keys(CATEGORIAS_SAIDA).join(', ');
  const hist = (opts.historico || []).slice(-8).map((h) => `${h.deMim ? 'Assistente' : 'Dra.'}: ${String(h.texto).slice(0, 300)}`).join('\n');
  return `Você é o assistente pessoal do CRM de um escritório de advocacia (Dra. Letícia Barros). Hoje é ${opts.diaSemana}, ${opts.hoje} (fuso de Brasília).
A mensagem pode ter erros de digitação, abreviações, falta de acento ou vir de áudio transcrito: interprete pela INTENÇÃO e pelo contexto da conversa (ex.: "dela", "esse", "a mesma" referem-se ao que foi falado antes).
Responda SOMENTE um JSON, com UMA destas ações:
AÇÕES (financeiro pede confirmação; agenda, lembrete, tarefa, cadastro e recado são feitos na hora):
- {"acao":"conta_pagar","descricao":"...","valor":123.45,"data":"AAAA-MM-DD (vencimento)","categoria":"...","escopo":"empresa|pessoal","codigo":"linha digitável, se houver"} → boleto/conta que AINDA vai ser paga.
- {"acao":"gasto","descricao":"...","valor":123.45,"data":"AAAA-MM-DD","categoria":"...","escopo":"empresa|pessoal"} → algo que JÁ foi pago/gasto.
- {"acao":"pagar_conta","descricao":"qual conta","valor":null,"data":"AAAA-MM-DD"} → "paguei a conta de luz": dar baixa numa conta a pagar JÁ lançada.
- {"acao":"recebimento","busca":"nome do cliente","valor":500,"data":"AAAA-MM-DD","forma":"pix|dinheiro|transferencia|cartao|boleto|deposito","descricao":"referente a..."} → dinheiro que um CLIENTE pagou.
- {"acao":"compromisso","titulo":"...","data":"AAAA-MM-DD","hora":"HH:MM","duracao":60,"evento":"reuniao|audiencia|compromisso|pessoal","local":"...","busca":"cliente, se houver"} → marcar na agenda.
- {"acao":"lembrete","texto":"do que lembrar","data":"AAAA-MM-DD","hora":"HH:MM"} → "me lembra de...": mensagem no WhatsApp na hora marcada.
- {"acao":"tarefa","titulo":"...","data":"AAAA-MM-DD ou null","prioridade":"baixa|media|alta|critica","busca":"cliente, se houver","descricao":"..."} → criar tarefa.
- {"acao":"cadastro_cliente","nome":"...","cpf":"...","rg":"...","nascimento":"AAAA-MM-DD","endereco":"...","email":"...","telefone":"...","estado_civil":"...","profissao":"...","nacionalidade":"..."} → cadastrar/completar ficha de cliente (dados do texto e/ou do documento enviado).
- {"acao":"mensagem_cliente","busca":"cliente","texto":"a mensagem PRONTA para o cliente, cordial, em nome da Dra. Letícia Barros"} → mandar recado a um cliente pelo WhatsApp.
CONSULTAS (respondidas na hora):
- {"acao":"processo","busca":"nome do cliente ou nº do processo"} → número/dados do processo.
- {"acao":"andamento","busca":"cliente ou nº do processo"} → o que aconteceu / últimas movimentações.
- {"acao":"cliente_dados","busca":"cliente"} → telefone, e-mail, CPF, endereço, nascimento.
- {"acao":"enviar_documento","busca":"cliente","documento":"procuração|contrato|petição inicial|RG|..."} → mandar o arquivo do CRM aqui no WhatsApp.
- {"acao":"agenda","data_inicio":"AAAA-MM-DD","data_fim":"AAAA-MM-DD"} → agenda/compromissos/audiências.
- {"acao":"prazos","data_inicio":"AAAA-MM-DD","data_fim":"AAAA-MM-DD"} → prazos processuais do período.
- {"acao":"a_receber","data_inicio":"AAAA-MM-DD","data_fim":"AAAA-MM-DD","atrasados":true|false} → quanto tem a receber / quem está em atraso.
- {"acao":"contas_vencer","data_inicio":"AAAA-MM-DD","data_fim":"AAAA-MM-DD"} → contas a pagar que vencem no período.
- {"acao":"acordos","busca":"cliente ou null"} → qualquer pergunta sobre ACORDO (vencimento, próxima parcela, data de pagamento, "e dos acordos?"). Sem cliente → todos os acordos em aberto.
- {"acao":"responder","texto":"..."} → cumprimento, dúvida, ou pedido fora dessas ações (explique com educação o que você consegue fazer).
Resolva datas relativas ("amanhã", "sexta", "semana que vem", "dia 15") a partir de hoje. Omita campos que não souber.
NUNCA pergunte o período nem peça para a Dra. repetir: sem período, deixe as datas de fora que o sistema usa o padrão (mês atual, próximos 7 dias).
Use "responder" só para cumprimento ou algo realmente fora das ações; se der para encaixar numa ação, use a ação.
Exemplos:
"Qual o número do processo do Luiz Felipe" → {"acao":"processo","busca":"Luiz Felipe"}
"Qual o vencimento do próximo acordo?" → {"acao":"acordos"}
"data de pagamento do acordo do Huber" → {"acao":"acordos","busca":"Huber"}
"Quais os meus próximos recebimentos?" → {"acao":"a_receber"}
"quem tá me devendo" → {"acao":"a_receber","atrasados":true}
"agenda de amanhã" → {"acao":"agenda","data_inicio":"(amanhã)","data_fim":"(amanhã)"}
Se a mensagem pedir para MUDAR ou DESFAZER um compromisso, lembrete, tarefa ou recado que a conversa mostra que JÁ foi feito ("✅ ..."), NÃO crie outro: use "responder" explicando que já foi feito e que o ajuste é na Agenda/Tarefas do CRM.
Categorias de saída: ${cats}. Escopo "empresa" = escritório; "pessoal" = casa/família. Na dúvida, "empresa".
Valores em número (312.40). Nunca invente valor, data, CPF ou telefone que não estejam na mensagem, na conversa ou no documento.${opts.pendente ? `
Há um item aguardando confirmação: ${JSON.stringify(opts.pendente)}. Se a mensagem CORRIGIR esse item (ex.: "é pessoal", "o valor é 300", "muda para as 15h", "manda mais curto"), devolva a MESMA ação com TODOS os campos já corrigidos e "corrige": true.` : ''}${opts.documento ? `
Documento enviado junto (lido por IA): ${JSON.stringify(opts.documento)}. Boleto/conta sem outra instrução → "conta_pagar"; comprovante de algo já pago → "gasto"; documento pessoal (RG, CNH, CPF, comprovante de residência, CTPS) → "cadastro_cliente" com os dados lidos.` : ''}${hist ? `
Conversa recente — serve SÓ para entender referências ("ela", "esse", "e dos acordos?"). Não repita a resposta anterior: responda ao PEDIDO ATUAL.
${hist}` : ''}
PEDIDO ATUAL (responda a ESTE): """${String(opts.mensagem || '').slice(0, 2000)}"""`;
}

// ── Leitura de documento (boleto, conta, comprovante) ──────────────────────

export const PROMPT_LEITURA_DOCUMENTO = 'Leia este documento e responda SOMENTE JSON: {"tipo":"boleto|conta|comprovante|nota_fiscal|documento_pessoal|comprovante_residencia|outro",'
  + '"descricao":"o que é, em poucas palavras","beneficiario":"quem recebe (boleto/conta)","valor":"1234,56",'
  + '"vencimento":"dd/mm/aaaa","data_pagamento":"dd/mm/aaaa (comprovante)","linha_digitavel":"...",'
  + '"destinatario_nome":"nome de quem RECEBEU o pagamento (comprovante)","destinatario_chave":"chave PIX/CPF/conta de quem recebeu",'
  + '"pessoa":{"nome":"","cpf":"","rg":"","nascimento":"dd/mm/aaaa","endereco":"","estado_civil":"","nacionalidade":""} (só para RG/CNH/CPF/CTPS/certidão/comprovante de residência)}. '
  + 'Não invente: deixe vazio o que não estiver escrito.';

export interface LeituraDocumento {
  tipo: 'boleto' | 'conta' | 'comprovante' | 'nota_fiscal' | 'documento_pessoal' | 'comprovante_residencia' | 'outro';
  descricao: string | null; beneficiario: string | null; valor: number | null;
  vencimento: string | null; data_pagamento: string | null; linha_digitavel: string | null;
  destinatario_nome: string | null; destinatario_chave: string | null;
  /** Dados de pessoa lidos de documento pessoal/comprovante de residência (para cadastro). */
  pessoa: Record<string, string> | null;
}

export function parseLeituraDocumento(texto: string): LeituraDocumento | null {
  const j = lerJson(texto);
  if (!j) return null;
  const s = (v: any) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().slice(0, 200));
  const tipos = ['boleto', 'conta', 'comprovante', 'nota_fiscal', 'documento_pessoal', 'comprovante_residencia', 'outro'];
  let pessoa: Record<string, string> | null = null;
  if (j.pessoa && typeof j.pessoa === 'object') {
    for (const [k, v] of Object.entries(j.pessoa)) {
      const t = s(v);
      if (t) { pessoa = pessoa || {}; pessoa[k.slice(0, 30)] = t; }
    }
  }
  return {
    tipo: (tipos.includes(String(j.tipo)) ? j.tipo : 'outro') as LeituraDocumento['tipo'],
    descricao: s(j.descricao), beneficiario: s(j.beneficiario), valor: valorBR(j.valor),
    vencimento: dataISO(j.vencimento), data_pagamento: dataISO(j.data_pagamento), linha_digitavel: s(j.linha_digitavel),
    destinatario_nome: s(j.destinatario_nome), destinatario_chave: s(j.destinatario_chave), pessoa,
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

/** 20 dígitos → NNNNNNN-DD.AAAA.J.TR.OOOO (padrão CNJ); outro formato fica como veio. */
export function numeroCNJ(n: string | null): string | null {
  const d = String(n || '').replace(/\D/g, '');
  return d.length === 20 ? `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d[13]}.${d.slice(14, 16)}.${d.slice(16)}` : (n || null);
}
/** "api_publica_trf2" → "TRF2" */
const tribunalLegivel = (t: string | null) => (t ? t.replace(/^api_publica_/i, '').toUpperCase() : null);

export function formatarProcessos(lista: ProcessoInfo[], busca: string): string {
  if (!lista.length) return `Não encontrei cliente nem processo para "${busca}". Confira o nome (ou mande o nº do processo).`;
  const linhas = lista.slice(0, 8).map((p) => {
    if (!p.numero && !p.titulo) return `👤 *${p.cliente}*\n📄 Cliente cadastrado, mas nenhum processo cadastrado no CRM ainda.`;
    const trib = tribunalLegivel(p.tribunal);
    return `👤 *${p.cliente}*\n📄 ${numeroCNJ(p.numero) || 'sem número (ainda não protocolado)'}${trib ? ` · ${trib}` : ''}\n` +
      `${p.titulo ? p.titulo + '\n' : ''}Área: ${p.area || '—'} · Fase: ${p.fase ? FASE_PT[p.fase] || p.fase : '—'}${p.status && p.status !== 'ativo' ? ` · ${p.status}` : ''}`;
  });
  return linhas.join('\n\n') + (lista.length > 8 ? `\n\n…e mais ${lista.length - 8}. Seja mais específica no nome.` : '');
}

const DIAS_CURTOS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const diaComSemana = (iso: string) => `${DIAS_CURTOS[new Date(iso + 'T12:00:00Z').getUTCDay()]}, ${dataBR(iso)}`;
const RODAPE = '\n\nConfirma? Responda *sim* ou *não* (ou me diga o que corrigir).';
const EVENTO_PT: Record<string, string> = { reuniao: 'Reunião', audiencia: 'Audiência', compromisso: 'Compromisso', pessoal: 'Pessoal' };

/** Telefone para leitura: "5527900001111" → "(27) 90000-1111". */
export function foneBR(v: string | null | undefined): string {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v ? String(v) : '—';
}

/**
 * Texto de confirmação de QUALQUER item que grava ou envia. Recebe o payload da
 * pendência (a ação já com o cliente resolvido: cliente, telefone, existente…).
 */
export function textoConfirmacao(p: any): string {
  switch (p.tipo) {
    case 'conta_pagar':
    case 'gasto': {
      const onde = p.tipo === 'conta_pagar' ? '🧾 *Contas a Pagar*' : '💸 *Gasto (já pago)*';
      const quando = p.tipo === 'conta_pagar' ? `Vencimento: ${dataBR(p.data)}` : `Data: ${dataBR(p.data)}`;
      return `${onde}\n${p.descricao}\nValor: *${moedaBR(p.valor)}*\n${quando}\nCategoria: ${CATEGORIAS_SAIDA[p.categoria] || p.categoria}\n`
        + `Conta: ${p.escopo === 'pessoal' ? 'pessoal (casa/família)' : 'escritório'}`
        + `${p.codigo ? `\nCódigo: ${p.codigo}` : ''}${RODAPE}`;
    }
    case 'pagar_conta':
      return `✅ *Marcar como paga*\n${p.descricao}\nValor: *${moedaBR(p.valor)}* (venc. ${dataBR(p.vencimento)})\nPaga em: ${dataBR(p.data)}${RODAPE}`;
    case 'recebimento':
      return `💰 *Recebimento de cliente*\nCliente: ${p.cliente}\nValor: *${moedaBR(p.valor)}*\nData: ${dataBR(p.data)} · ${p.forma}\nReferente a: ${p.descricao}${RODAPE}`;
    case 'compromisso': {
      const [h, m] = String(p.hora).split(':').map(Number);
      const fim = new Date(Date.UTC(2000, 0, 1, h, m + Number(p.duracao || 60)));
      const ate = `${String(fim.getUTCHours()).padStart(2, '0')}:${String(fim.getUTCMinutes()).padStart(2, '0')}`;
      return `📅 *Agenda — ${EVENTO_PT[p.evento] || 'Compromisso'}*\n${p.titulo}\n${diaComSemana(p.data)} às ${p.hora} (até ${ate})`
        + `${p.local ? `\nLocal: ${p.local}` : ''}${p.cliente ? `\nCliente: ${p.cliente}` : ''}\nVai também para o Google Agenda.${RODAPE}`;
    }
    case 'lembrete':
      return `⏰ *Lembrete*\n"${p.texto}"\nTe aviso aqui no WhatsApp em ${dataBR(p.data)} às ${p.hora}.${RODAPE}`;
    case 'tarefa':
      return `✅ *Tarefa*\n${p.titulo}${p.data ? `\nPrazo: ${dataBR(p.data)}` : ''}\nPrioridade: ${p.prioridade}`
        + `${p.cliente ? `\nCliente: ${p.cliente}` : ''}${p.descricao ? `\n${p.descricao}` : ''}${RODAPE}`;
    case 'cadastro_cliente': {
      const d = p.dados || {};
      const linhas = [
        ['Nome', d.nome], ['CPF', d.cpf], ['RG', d.rg], ['Nascimento', d.nascimento ? dataBR(d.nascimento) : null],
        ['Endereço', d.endereco], ['E-mail', d.email], ['Telefone', d.telefone ? foneBR(d.telefone) : null],
        ['Estado civil', d.estado_civil], ['Profissão', d.profissao], ['Nacionalidade', d.nacionalidade],
      ].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
      const cab = p.existente
        ? `👤 *Já existe a ficha de ${p.existente.name}* — vou só completar o que estiver faltando (nada é apagado).`
        : '👤 *Nova ficha de cliente*';
      const docs = p.midias && p.midias.length ? `\n📎 ${p.midias.length} documento(s) vão para a ficha (Documentos pessoais).` : '';
      return `${cab}\n${linhas}${docs}\n\nMandou mais algum documento dela? Pode enviar antes de confirmar.${RODAPE}`;
    }
    case 'mensagem_cliente':
      return `💬 *Enviar para ${p.cliente}* (${foneBR(p.telefone)}):\n\n"${p.texto}"${RODAPE}`;
    default:
      return `${p.resumo || 'Confirma?'}${RODAPE}`;
  }
}

// ── Respostas das consultas ────────────────────────────────────────────────

export interface ResumoAReceber {
  de: string; ate: string; atrasados: boolean; aReceber: number; qtd: number; vencidoTotal: number;
  vencidos: { cliente: string; descricao: string; valor: number; vencimento: string | null }[];
  /** Itens a receber no período, para listar ("quais os meus próximos recebimentos?"). */
  proximos?: { cliente: string; descricao: string; valor: number; vencimento: string | null }[];
}

export function formatarAReceber(r: ResumoAReceber): string {
  const lista = r.vencidos.slice(0, 10).map((v) => `• ${v.cliente} — ${v.descricao} — ${moedaBR(v.valor)} (venceu ${dataBR(v.vencimento)})`).join('\n');
  const atraso = r.vencidos.length
    ? `🔴 *Vencido (em atraso): ${moedaBR(r.vencidoTotal)}*\n${lista}${r.vencidos.length > 10 ? `\n…e mais ${r.vencidos.length - 10}.` : ''}`
    : '🟢 Ninguém em atraso.';
  if (r.atrasados) return atraso;
  const prox = [...(r.proximos || [])].sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
  const lp = prox.length
    ? `\n\n🗓️ *Próximos recebimentos*\n${prox.slice(0, 12).map((v) => `• ${dataBR(v.vencimento).slice(0, 5)} — ${v.cliente} — ${v.descricao} — ${moedaBR(v.valor)}`).join('\n')}${prox.length > 12 ? `\n…e mais ${prox.length - 12}.` : ''}`
    : '';
  return `📊 *A receber de ${dataBR(r.de).slice(0, 5)} a ${dataBR(r.ate).slice(0, 5)}*: ${moedaBR(r.aReceber)} (${r.qtd} ${r.qtd === 1 ? 'item' : 'itens'}, só a sua parte)${lp}\n\n${atraso}`;
}

export function formatarContasVencer(contas: { descricao: string; valor: number; vencimento: string | null; vencida: boolean }[], de: string, ate: string): string {
  if (!contas.length) return `🧾 Nenhuma conta a pagar de ${dataBR(de).slice(0, 5)} a ${dataBR(ate).slice(0, 5)}.`;
  const total = contas.reduce((s, c) => s + Number(c.valor), 0);
  const linhas = contas.slice(0, 15).map((c) => `${c.vencida ? '🔴' : '•'} ${dataBR(c.vencimento).slice(0, 5)} — ${c.descricao} — ${moedaBR(c.valor)}${c.vencida ? ' (vencida)' : ''}`).join('\n');
  return `🧾 *Contas a pagar até ${dataBR(ate).slice(0, 5)}*: ${moedaBR(total)}\n${linhas}${contas.length > 15 ? `\n…e mais ${contas.length - 15}.` : ''}`;
}

export function formatarPrazos(prazos: { data: string; descricao: string; processo: string | null; cliente: string | null }[], de: string, ate: string): string {
  if (!prazos.length) return `⏰ Nenhum prazo de ${dataBR(de).slice(0, 5)} a ${dataBR(ate).slice(0, 5)}.`;
  const linhas = [...prazos].sort((a, b) => a.data.localeCompare(b.data)).slice(0, 15)
    .map((p) => `• *${dataBR(p.data).slice(0, 5)}* — ${p.descricao}${p.cliente ? ` — ${p.cliente}` : ''}${p.processo ? ` (${numeroCNJ(p.processo)})` : ''}`).join('\n');
  return `⏰ *Prazos de ${dataBR(de).slice(0, 5)} a ${dataBR(ate).slice(0, 5)}*\n${linhas}`;
}

export function formatarClienteDados(c: { name: string; phone: string | null; email: string | null; cpf_cnpj: string | null; address: string | null; birth_date: string | null; processos: number }): string {
  return `👤 *${c.name}*\n📞 ${foneBR(c.phone)}\n✉️ ${c.email || '—'}\n🪪 CPF: ${c.cpf_cnpj || '—'}\n🏠 ${c.address || '—'}`
    + `\n🎂 ${c.birth_date ? dataBR(c.birth_date) : '—'}\n📄 ${c.processos} processo(s) no CRM`;
}

export function formatarAndamento(lista: { processo: string | null; cliente: string; movimentos: { data: string | null; titulo: string | null; resumo: string | null }[] }[]): string {
  return lista.slice(0, 4).map((p) => {
    const cab = `📄 *${numeroCNJ(p.processo) || 'sem número'}* — ${p.cliente}`;
    if (!p.movimentos.length) return `${cab}\nSem movimentação registrada ainda.`;
    const movs = p.movimentos.slice(0, 5).map((m) => `• ${dataBR(m.data)} — ${String(m.resumo || m.titulo || '').replace(/\s+/g, ' ').slice(0, 220)}`).join('\n');
    return `${cab}\n${movs}`;
  }).join('\n\n');
}

/**
 * Resposta depois de FAZER uma ação que não pede confirmação (desde 08/10/2026:
 * "só peça confirmação em lançamentos financeiros"). Como não houve prévia,
 * mostra tudo o que foi gravado/enviado.
 */
export function textoFeito(p: any, r: { id?: number | null; criado?: boolean; ok?: boolean } = {}): string {
  switch (p.tipo) {
    case 'compromisso': {
      const [h, m] = String(p.hora).split(':').map(Number);
      const fim = Math.min(h * 60 + m + Number(p.duracao || 60), 23 * 60 + 59);
      const ate = `${String(Math.floor(fim / 60)).padStart(2, '0')}:${String(fim % 60).padStart(2, '0')}`;
      return `✅ Marcado na agenda (e no Google Agenda):\n*${p.titulo}*\n${diaComSemana(p.data)} às ${p.hora} (até ${ate})`
        + `${p.local ? `\nLocal: ${p.local}` : ''}${p.cliente ? `\nCliente: ${p.cliente}` : ''}\n\nPara mudar, me diga ou ajuste na Agenda do CRM.`;
    }
    case 'lembrete':
      return `✅ Combinado! Te lembro aqui em ${dataBR(p.data)} às ${p.hora}:\n"${p.texto}"`;
    case 'tarefa':
      return `✅ Tarefa criada${r.id ? ` (nº ${r.id})` : ''}: *${p.titulo}*${p.data ? `\nPrazo: ${dataBR(p.data)}` : ''}\nPrioridade: ${p.prioridade}`
        + `${p.cliente ? `\nCliente: ${p.cliente}` : ''}`;
    case 'cadastro_cliente': {
      const d = p.dados || {};
      const linhas = [
        ['Nome', d.nome], ['CPF', d.cpf], ['RG', d.rg], ['Nascimento', d.nascimento ? dataBR(d.nascimento) : null],
        ['Endereço', d.endereco], ['E-mail', d.email], ['Telefone', d.telefone ? foneBR(d.telefone) : null],
        ['Estado civil', d.estado_civil], ['Profissão', d.profissao], ['Nacionalidade', d.nacionalidade],
      ].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
      const cab = r.criado ? `✅ Ficha criada${r.id ? ` (nº ${r.id})` : ''}` : `✅ Ficha completada${r.id ? ` (nº ${r.id})` : ''} — ${p.existente?.name || d.nome} (só o que faltava; nada foi apagado)`;
      const docs = p.midias && p.midias.length ? `\n📎 ${p.midias.length} documento(s) na ficha (Documentos pessoais).` : '';
      return `${cab}\n${linhas}${docs}`;
    }
    case 'mensagem_cliente':
      return r.ok === false
        ? `⚠️ Não consegui enviar para ${p.cliente} (${foneBR(p.telefone)}). Tente pelo CRM.`
        : `✅ Enviado para ${p.cliente} (${foneBR(p.telefone)}):\n\n"${p.texto}"`;
    default:
      return '✅ Feito.';
  }
}

// ── Acordos (parcelas a receber de acordos judiciais/extrajudiciais) ───────

export interface ItemAcordo {
  agreementId: number; cliente: string; empresa: string | null; processo: string | null;
  vencimento: string; parcela: string | null; valor: number;
}

const quandoTxt = (v: string, hoje: string) => {
  if (v === hoje) return '*hoje*';
  if (v < hoje) return `⚠️ venceu ${dataBR(v).slice(0, 5)}`;
  return dataBR(v).slice(0, 5);
};

/** Consulta "quando vence o acordo do Fulano?": por acordo, as próximas parcelas — o mais urgente primeiro. */
export function formatarAcordos(itens: ItemAcordo[], hoje: string): string {
  if (!itens.length) return '🤝 Nenhum acordo com parcela em aberto.';
  const porAcordo = new Map<number, ItemAcordo[]>();
  for (const i of [...itens].sort((a, b) => a.vencimento.localeCompare(b.vencimento))) {
    if (!porAcordo.has(i.agreementId)) porAcordo.set(i.agreementId, []);
    porAcordo.get(i.agreementId)!.push(i);
  }
  const blocos = [...porAcordo.values()].map((l) => {
    const c = l[0];
    const linhas = l.slice(0, 4).map((i) => `• ${quandoTxt(i.vencimento, hoje)} — ${i.parcela || 'parcela'} — honorários ${moedaBR(i.valor)}`);
    return `🤝 *${c.cliente}*${c.empresa ? ` — ${c.empresa}` : ''}${c.processo ? `\n📄 ${numeroCNJ(c.processo)}` : ''}\n${linhas.join('\n')}`
      + `${l.length > 4 ? `\n…e mais ${l.length - 4} parcela(s) até ${dataBR(l[l.length - 1].vencimento)}` : ''}`;
  });
  return blocos.join('\n\n');
}

/**
 * Aviso diário (pedido 09/10/2026): "me informe sempre 2 dias antes, 1 dia antes e
 * no dia que um acordo está para vencer". Junta também o que venceu nos últimos 7
 * dias e ainda não foi baixado. Sem nada para avisar → null (não manda mensagem).
 */
export function montarAvisoAcordos(itens: ItemAcordo[], hoje: string): string | null {
  const d1 = somaDias(hoje, 1); const d2 = somaDias(hoje, 2); const semana = somaDias(hoje, -7);
  const linha = (i: ItemAcordo) => `• ${i.cliente}${i.empresa ? ` (${i.empresa})` : ''} — ${i.parcela || 'parcela'} — honorários ${moedaBR(i.valor)}`;
  const grupo = (titulo: string, l: ItemAcordo[]) => (l.length ? `*${titulo}*\n${l.map(linha).join('\n')}` : '');
  const blocos = [
    grupo(`Hoje (${dataBR(hoje).slice(0, 5)})`, itens.filter((i) => i.vencimento === hoje)),
    grupo(`Amanhã (${dataBR(d1).slice(0, 5)})`, itens.filter((i) => i.vencimento === d1)),
    grupo(`Em 2 dias (${dataBR(d2).slice(0, 5)})`, itens.filter((i) => i.vencimento === d2)),
    grupo('⚠️ Venceu e ainda não foi baixado', itens.filter((i) => i.vencimento < hoje && i.vencimento >= semana)
      .map((i) => ({ ...i, parcela: `${i.parcela || 'parcela'} (venceu ${dataBR(i.vencimento).slice(0, 5)})` }))),
  ].filter(Boolean);
  if (!blocos.length) return null;
  return `🤝 *Acordos para ficar de olho no pagamento*\n\n${blocos.join('\n\n')}\n\nQuando cair, me diga "recebi o acordo do Fulano" que eu dou baixa.`;
}
