/**
 * Assistente pessoal do CRM pelo WhatsApp (desde 08/10/2026).
 *
 * A Dra. Letícia e a Jessica (números em office_settings.assistente_whatsapp_numeros)
 * escrevem para o número do escritório como numa conversa normal — texto, áudio,
 * foto — e o CRM responde. Consultas (processo, andamento, dados do cliente,
 * documentos, agenda, prazos, a receber, contas a vencer) saem na hora. Tudo que
 * GRAVA ou ENVIA (contas, gastos, baixas, recebimentos, compromissos, lembretes,
 * tarefas, cadastros, mensagens a clientes) só acontece depois de um "sim".
 * Quando um CLIENTE manda comprovante, confere e pergunta se dá baixa.
 *
 * A IA só interpreta e lê documentos; o que é gravado é decidido aqui e nas regras
 * puras (assistenteRegras.ts / assistenteBusca.ts). Banco, IA e envio são injetados —
 * os testes usam a mesma interface que o webhook (tests/assistenteWhatsapp*.test.mjs).
 */
import {
  Lancamento, ItemAberto, ItemAgenda, ProcessoInfo, DadosCadastro, ResumoAReceber,
  interpretarConfirmacao, parseAcao, promptAssistente, lerJson,
  PROMPT_LEITURA_DOCUMENTO, parseLeituraDocumento, destinatarioConfere, casarComprovante,
  textoConfirmacao, textoFeito, formatarAgenda, formatarProcessos, formatarAReceber, formatarContasVencer,
  formatarPrazos, formatarClienteDados, formatarAndamento, moedaBR, dataBR, foneBR,
} from './assistenteRegras';
import { encontrarClientes, escolherConta, escolherDocumento, ContaAberta } from './assistenteBusca';

export interface Midia { mime: string; data: Buffer; file_name?: string }
export interface Pendencia { id: number; phone: string; tipo: string; payload: any; resumo: string; grupo?: string | null }
export type ResultadoBaixa = 'ok' | 'ja_pago' | 'nao_encontrado';
export interface ClienteRef { id: number; name: string }
export interface DadosClienteInfo { name: string; phone: string | null; email: string | null; cpf_cnpj: string | null; address: string | null; birth_date: string | null; processos: number }
export interface AndamentoInfo { processo: string | null; cliente: string; movimentos: { data: string | null; titulo: string | null; resumo: string | null }[] }

export interface AssistenteRepo {
  comandantes(): Promise<string[]>;
  /** Pendências abertas (não expiradas) do número, da mais antiga para a mais nova. */
  pendencias(phone: string): Promise<Pendencia[]>;
  criarPendencia(p: Omit<Pendencia, 'id'>): Promise<number>;
  /** Fecha a pendência e as abertas do mesmo grupo (comprovante enviado às duas). */
  fecharPendencia(id: number, status: 'confirmada' | 'cancelada' | 'substituida'): Promise<void>;
  lancar(l: Lancamento, quem: string): Promise<number>;
  buscarProcessos(busca: string): Promise<ProcessoInfo[]>;
  agenda(de: string, ate: string): Promise<ItemAgenda[]>;
  abertosDoCliente(clientId: number): Promise<ItemAberto[]>;
  nomeCliente(clientId: number): Promise<string>;
  baixar(item: { fonte: string; id: number }, opts: { data: string; valor: number; quem: string }): Promise<ResultadoBaixa>;
  clientes(): Promise<ClienteRef[]>;
  historico(phone: string): Promise<{ deMim: boolean; texto: string }[]>;
  processosDoCliente(clientId: number): Promise<ProcessoInfo[]>;
  dadosCliente(clientId: number): Promise<DadosClienteInfo>;
  andamento(clientId: number | null, numero: string | null): Promise<AndamentoInfo[]>;
  documentosDoCliente(clientId: number): Promise<{ id: number; name: string; type: string | null; created_at: string }[]>;
  enviarDocumento(phone: string, docId: number, legenda: string): Promise<boolean>;
  resumoAReceber(de: string, ate: string): Promise<Omit<ResumoAReceber, 'de' | 'ate' | 'atrasados'>>;
  contasAPagar(de: string, ate: string): Promise<{ descricao: string; valor: number; vencimento: string | null; vencida: boolean }[]>;
  contasEmAberto(): Promise<ContaAberta[]>;
  pagarConta(id: number, data: string, quem: string): Promise<ResultadoBaixa>;
  prazos(de: string, ate: string): Promise<{ data: string; descricao: string; processo: string | null; cliente: string | null }[]>;
  registrarRecebimento(r: { clientId: number; valor: number; data: string; forma: string; descricao: string }, quem: string): Promise<number>;
  criarCompromisso(c: { titulo: string; data: string; hora: string; duracao: number; evento: string; local: string | null; clientId: number | null }, quem: string): Promise<number>;
  criarLembrete(phone: string, quando: string, texto: string): Promise<number>;
  criarTarefa(t: { titulo: string; data: string | null; prioridade: string; descricao: string | null; clientId: number | null }, quem: string): Promise<number>;
  clientePorCpfOuNome(d: DadosCadastro): Promise<ClienteRef | null>;
  salvarCadastro(d: DadosCadastro, existenteId: number | null, midias: number[], quem: string): Promise<{ id: number; criado: boolean }>;
  enviarMensagemCliente(phone: string, texto: string): Promise<boolean>;
}
export interface AssistenteIa {
  /** Prompt → texto JSON (null = IA indisponível). */
  interpretar(prompt: string): Promise<string | null>;
  lerDocumento(midia: Midia, instrucao: string): Promise<string | null>;
  transcrever(midia: Midia): Promise<string | null>;
}
export interface AssistenteDeps {
  repo: AssistenteRepo;
  ia: AssistenteIa;
  enviar(phone: string, texto: string): Promise<void>;
  agora?: () => Date;
}

/** Só o que mexe no financeiro pede "sim" antes. */
const PEDE_CONFIRMACAO = new Set(['lancamento', 'baixa', 'pagar_conta', 'recebimento']);

const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const ehAudio = (m?: Midia) => !!m && /^(audio|video)\//.test(m.mime);
const ehDocumento = (m?: Midia) => !!m && (/^image\//.test(m.mime) || m.mime === 'application/pdf');
const digitos = (s: string) => String(s || '').replace(/\D/g, '');

const AJUDA = 'Não entendi. 🙂 Posso, por exemplo:\n'
  + '• lançar *contas a pagar* (foto do boleto) e *gastos* ("gastei 50 de táxi")\n'
  + '• "paguei a conta de luz" · "recebi 500 da Fulana"\n'
  + '• *processo*, *andamento*, *telefone/CPF* e *documentos* de um cliente\n'
  + '• *agenda*, *prazos*, *a receber* e *contas que vencem*\n'
  + '• *marcar compromisso*, *lembrete*, *tarefa*, *cadastrar cliente* e *mandar recado* a um cliente';

/** Resumo curto de uma pendência (lista quando há mais de uma esperando). */
function resumoDe(p: any): string {
  switch (p.tipo) {
    case 'conta_pagar': return `Conta a pagar: ${p.descricao} — ${moedaBR(p.valor)}`;
    case 'gasto': return `Gasto: ${p.descricao} — ${moedaBR(p.valor)}`;
    case 'pagar_conta': return `Marcar paga: ${p.descricao} — ${moedaBR(p.valor)}`;
    case 'recebimento': return `Recebimento: ${p.cliente} — ${moedaBR(p.valor)}`;
    case 'baixa': return `Baixa: ${p.cliente} — ${p.descricao} — ${moedaBR(p.valor)}`;
    case 'compromisso': return `Agenda: ${p.titulo} — ${dataBR(p.data)} ${p.hora}`;
    case 'lembrete': return `Lembrete: ${p.texto} — ${dataBR(p.data)} ${p.hora}`;
    case 'tarefa': return `Tarefa: ${p.titulo}`;
    case 'cadastro_cliente': return `Cadastro: ${p.dados?.nome || p.dados?.cpf}`;
    case 'mensagem_cliente': return `Mensagem para ${p.cliente}`;
    default: return 'Item pendente';
  }
}

export function criarAssistente(deps: AssistenteDeps) {
  const { repo, ia, enviar } = deps;
  const agora = deps.agora || (() => new Date());
  /** Agora em Brasília (UTC-3), como "AAAA-MM-DDTHH:MM". */
  const agoraBR = () => new Date(agora().getTime() - 3 * 3600 * 1000).toISOString().slice(0, 16);
  const hoje = () => agoraBR().slice(0, 10);
  const diaSemana = () => DIAS_SEMANA[new Date(hoje() + 'T12:00:00Z').getUTCDay()];
  const quem = (phone: string) => `Assistente WhatsApp (${phone})`;

  /** Cliente pelo nome (tolerante a erro). Devolve o cliente ou o texto de resposta. */
  async function resolverCliente(busca: string): Promise<ClienteRef | string> {
    const r = encontrarClientes(busca, await repo.clientes());
    if (r.unico) return r.unico;
    if (r.opcoes.length) return `Encontrei mais de um cliente para "${busca}":\n${r.opcoes.map((c) => `• ${c.name}`).join('\n')}\n\nQual deles? Pode escrever o nome mais completo.`;
    return `Não achei cliente "${busca}". Confira o nome (pode ser só uma parte dele).`;
  }

  // ── Execução depois do "sim" ──────────────────────────────────────────────
  async function executar(phone: string, p: Pendencia): Promise<string> {
    const msg = await executarPayload(phone, p.tipo, p.payload);
    await repo.fecharPendencia(p.id, 'confirmada');
    return msg;
  }

  async function executarPayload(phone: string, tipoPend: string, d: any): Promise<string> {
    const q = quem(phone);
    let msg: string;
    if (tipoPend === 'baixa') {
      const r = await repo.baixar({ fonte: d.fonte, id: d.id }, { data: d.data, valor: d.valor, quem: q });
      msg = r === 'ja_pago' ? `ℹ️ ${d.descricao} de ${d.cliente} já estava baixada. Nada mudou.`
        : r === 'nao_encontrado' ? `⚠️ Não encontrei mais a parcela "${d.descricao}" de ${d.cliente}. Confira no A Receber.`
          : `✅ Baixa feita: ${d.cliente} — ${d.descricao} — ${moedaBR(d.valor)} pago em ${dataBR(d.data)}.`;
    } else if (d.tipo === 'conta_pagar' || d.tipo === 'gasto') {
      const id = await repo.lancar(d as Lancamento, q);
      msg = `✅ Lançado ${d.tipo === 'conta_pagar' ? 'no Contas a Pagar' : 'nos gastos'} (nº ${id}): ${d.descricao} — ${moedaBR(d.valor)} — ${d.tipo === 'conta_pagar' ? 'vence' : 'em'} ${dataBR(d.data)}.`;
    } else if (d.tipo === 'pagar_conta') {
      const r = await repo.pagarConta(d.id, d.data, q);
      msg = r === 'ok' ? `✅ ${d.descricao} marcada como paga em ${dataBR(d.data)}.` : `ℹ️ ${d.descricao} já estava paga (ou não existe mais).`;
    } else if (d.tipo === 'recebimento') {
      const id = await repo.registrarRecebimento({ clientId: d.clientId, valor: d.valor, data: d.data, forma: d.forma, descricao: d.descricao }, q);
      msg = `✅ Recebimento registrado (nº ${id}): ${d.cliente} — ${moedaBR(d.valor)} em ${dataBR(d.data)}.`;
    } else if (d.tipo === 'compromisso') {
      await repo.criarCompromisso({ titulo: d.titulo, data: d.data, hora: d.hora, duracao: d.duracao, evento: d.evento, local: d.local, clientId: d.clientId ?? null }, q);
      msg = textoFeito(d);
    } else if (d.tipo === 'lembrete') {
      await repo.criarLembrete(phone, `${d.data}T${d.hora}`, d.texto);
      msg = textoFeito(d);
    } else if (d.tipo === 'tarefa') {
      const id = await repo.criarTarefa({ titulo: d.titulo, data: d.data, prioridade: d.prioridade, descricao: d.descricao, clientId: d.clientId ?? null }, q);
      msg = textoFeito(d, { id });
    } else if (d.tipo === 'cadastro_cliente') {
      const r = await repo.salvarCadastro(d.dados, d.existente?.id ?? null, d.midias || [], q);
      msg = textoFeito(d, r);
    } else if (d.tipo === 'mensagem_cliente') {
      msg = textoFeito(d, { ok: await repo.enviarMensagemCliente(d.telefone, d.texto) });
    } else {
      msg = '⚠️ Não sei executar esse item.';
    }
    return msg;
  }

  function listar(pend: Pendencia[]): string {
    return `Tenho ${pend.length} itens aguardando confirmação:\n` +
      pend.map((p, i) => `${i + 1}) ${p.resumo}`).join('\n') +
      `\n\nResponda *sim 1*, *sim 2*… (ou *não 1* para cancelar).`;
  }

  /**
   * Financeiro abre pendência e pede "sim"; o resto (agenda, lembrete, tarefa,
   * cadastro, recado a cliente) é feito na hora — pedido de 08/10/2026: "Só peça
   * confirmação em lançamentos de financeiros, fora isso não precisa pedir".
   */
  async function propor(phone: string, tipoPend: string, payload: any): Promise<void> {
    if (!PEDE_CONFIRMACAO.has(tipoPend)) { await enviar(phone, await executarPayload(phone, tipoPend, payload)); return; }
    await repo.criarPendencia({ phone, tipo: tipoPend, payload, grupo: null, resumo: resumoDe({ ...payload, tipo: tipoPend === 'baixa' ? 'baixa' : payload.tipo }) });
    await enviar(phone, tipoPend === 'baixa'
      ? `💰 *Recebimento de ${payload.cliente}*: ${moedaBR(payload.valor)} em ${dataBR(payload.data)}\nBate com: *${payload.descricao}* (venc. ${dataBR(payload.vencimento)})\n\nDar baixa nessa parcela? Responda *sim* ou *não*.`
      : textoConfirmacao(payload));
  }

  /** Mensagem de um número que comanda o assistente. */
  async function atenderComandante(m: { phone: string; texto: string; midia?: Midia; mediaId?: number | null }): Promise<void> {
    let msg = String(m.texto || '').trim();

    if (ehAudio(m.midia)) {
      const t = await ia.transcrever(m.midia!);
      if (!t) { await enviar(m.phone, '🎧 Não consegui entender o áudio. Pode mandar de novo ou escrever?'); return; }
      msg = [msg, t].filter(Boolean).join(' ');
    }

    const pend = await repo.pendencias(m.phone);
    const conf = m.midia && !ehAudio(m.midia) ? null : interpretarConfirmacao(msg);
    if (conf) {
      if (!pend.length) { await enviar(m.phone, 'Não tenho nada aguardando confirmação. 🙂'); return; }
      const alvo = conf.indice ? pend[conf.indice - 1] : pend.length === 1 ? pend[0] : null;
      if (!alvo) { await enviar(m.phone, conf.indice ? `Não achei o item ${conf.indice}.\n\n${listar(pend)}` : listar(pend)); return; }
      if (conf.resposta === 'nao') {
        await repo.fecharPendencia(alvo.id, 'cancelada');
        await enviar(m.phone, `❌ Cancelado: ${alvo.resumo}`);
        return;
      }
      await enviar(m.phone, await executar(m.phone, alvo));
      return;
    }

    let documento = null;
    if (ehDocumento(m.midia)) {
      documento = parseLeituraDocumento(await ia.lerDocumento(m.midia!, PROMPT_LEITURA_DOCUMENTO) || '');
      if (!documento && !msg) { await enviar(m.phone, '📄 Não consegui ler o documento. Me diga o que é e o que faço com ele.'); return; }
    }
    if (!msg && !documento) return;

    const pendente = [...pend].reverse().find((p) => p.tipo !== 'baixa') || null;
    const raw = await ia.interpretar(promptAssistente({
      hoje: hoje(), diaSemana: diaSemana(), mensagem: msg || '(sem texto — só o documento)',
      documento, pendente: pendente ? pendente.payload : null, historico: await repo.historico(m.phone),
    }));
    if (raw === null) { await enviar(m.phone, '⚠️ A IA não respondeu agora. Tente de novo em instantes.'); return; }
    const acao = parseAcao(raw, hoje());
    if (!acao) { await enviar(m.phone, AJUDA); return; }
    const corrige = lerJson(raw)?.corrige === true;
    const substituir = async (tipo: string) => {
      if (corrige && pendente && pendente.payload?.tipo === tipo) await repo.fecharPendencia(pendente.id, 'substituida');
    };

    switch (acao.tipo) {
      // ── consultas ──
      case 'responder': await enviar(m.phone, acao.texto); return;
      case 'agenda': await enviar(m.phone, formatarAgenda(await repo.agenda(acao.de, acao.ate), acao.de, acao.ate)); return;
      case 'prazos': await enviar(m.phone, formatarPrazos(await repo.prazos(acao.de, acao.ate), acao.de, acao.ate)); return;
      case 'a_receber': await enviar(m.phone, formatarAReceber({ ...(await repo.resumoAReceber(acao.de, acao.ate)), de: acao.de, ate: acao.ate, atrasados: acao.atrasados })); return;
      case 'contas_vencer': await enviar(m.phone, formatarContasVencer(await repo.contasAPagar(acao.de, acao.ate), acao.de, acao.ate)); return;
      case 'processo': {
        if (digitos(acao.busca).length >= 7) { await enviar(m.phone, formatarProcessos(await repo.buscarProcessos(acao.busca), acao.busca)); return; }
        const c = await resolverCliente(acao.busca);
        if (typeof c === 'string') { await enviar(m.phone, c); return; }
        const lista = await repo.processosDoCliente(c.id);
        await enviar(m.phone, formatarProcessos(lista.length ? lista : [{ cliente: c.name, numero: null, area: null, fase: null, status: null, titulo: null, tribunal: null }], acao.busca));
        return;
      }
      case 'andamento': {
        let lista: AndamentoInfo[];
        if (digitos(acao.busca).length >= 7) lista = await repo.andamento(null, digitos(acao.busca));
        else {
          const c = await resolverCliente(acao.busca);
          if (typeof c === 'string') { await enviar(m.phone, c); return; }
          lista = await repo.andamento(c.id, null);
          if (!lista.length) { await enviar(m.phone, `${c.name} não tem processo cadastrado no CRM ainda.`); return; }
        }
        await enviar(m.phone, lista.length ? formatarAndamento(lista) : `Não achei processo "${acao.busca}".`);
        return;
      }
      case 'cliente_dados': {
        const c = await resolverCliente(acao.busca);
        await enviar(m.phone, typeof c === 'string' ? c : formatarClienteDados(await repo.dadosCliente(c.id)));
        return;
      }
      case 'enviar_documento': {
        const c = await resolverCliente(acao.busca);
        if (typeof c === 'string') { await enviar(m.phone, c); return; }
        const docs = await repo.documentosDoCliente(c.id);
        const doc = escolherDocumento(acao.documento, docs);
        if (!doc) {
          await enviar(m.phone, docs.length
            ? `Não achei "${acao.documento || 'esse documento'}" de ${c.name}. Na ficha tem:\n${docs.slice(0, 10).map((x) => `• ${x.name}`).join('\n')}\n\nQual eu mando?`
            : `${c.name} não tem documentos com arquivo no CRM.`);
          return;
        }
        const ok = await repo.enviarDocumento(m.phone, doc.id, `${doc.name} — ${c.name}`);
        if (!ok) await enviar(m.phone, `⚠️ Não consegui enviar "${doc.name}". Tente abrir pela ficha no CRM.`);
        return;
      }

      // ── o que grava/envia: confirma antes ──
      case 'conta_pagar':
      case 'gasto':
        await substituir(acao.tipo);
        await propor(m.phone, 'lancamento', acao);
        return;
      case 'pagar_conta': {
        const r = escolherConta({ descricao: acao.descricao, valor: acao.valor }, await repo.contasEmAberto());
        if (!r.unico) {
          await enviar(m.phone, r.opcoes.length
            ? `Qual dessas contas você pagou?\n${r.opcoes.map((c) => `• ${c.descricao} — ${moedaBR(c.valor)} (venc. ${dataBR(c.vencimento)})`).join('\n')}`
            : `Não achei conta a pagar em aberto parecida com "${acao.descricao || moedaBR(acao.valor || 0)}". Se ela não foi lançada, me diga que eu lanço como gasto.`);
          return;
        }
        await substituir('pagar_conta');
        await propor(m.phone, 'pagar_conta', { tipo: 'pagar_conta', id: r.unico.id, descricao: r.unico.descricao, valor: r.unico.valor, vencimento: r.unico.vencimento, data: acao.data });
        return;
      }
      case 'recebimento': {
        const c = await resolverCliente(acao.busca);
        if (typeof c === 'string') { await enviar(m.phone, c); return; }
        await substituir('recebimento');
        const match = casarComprovante({ valor: acao.valor, data: acao.data }, await repo.abertosDoCliente(c.id));
        if (match) {
          await propor(m.phone, 'baixa', { fonte: match.fonte, id: match.id, valor: acao.valor, data: acao.data, cliente: c.name, descricao: match.descricao, vencimento: match.vencimento, clientId: c.id });
          return;
        }
        await propor(m.phone, 'recebimento', { tipo: 'recebimento', clientId: c.id, cliente: c.name, valor: acao.valor, data: acao.data, forma: acao.forma, descricao: acao.descricao });
        return;
      }
      case 'compromisso':
      case 'tarefa': {
        let cliente: ClienteRef | null = null;
        if (acao.busca) { const c = await resolverCliente(acao.busca); if (typeof c !== 'string') cliente = c; }
        if (acao.tipo === 'compromisso' && `${acao.data}T${acao.hora}` <= agoraBR()) { await enviar(m.phone, `Esse horário (${dataBR(acao.data)} às ${acao.hora}) já passou. Para quando marco?`); return; }
        await substituir(acao.tipo);
        await propor(m.phone, acao.tipo, { ...acao, clientId: cliente?.id ?? null, cliente: cliente?.name ?? null });
        return;
      }
      case 'lembrete':
        if (`${acao.data}T${acao.hora}` <= agoraBR()) { await enviar(m.phone, `Esse horário (${dataBR(acao.data)} às ${acao.hora}) já passou. Para quando te lembro?`); return; }
        await substituir('lembrete');
        await propor(m.phone, 'lembrete', acao);
        return;
      case 'cadastro_cliente': {
        // Feito na hora: documentos enviados em sequência (RG, depois comprovante…)
        // completam a MESMA ficha, achada por CPF ou nome — nunca duplica.
        const dados = acao.dados;
        const midias = m.mediaId && ehDocumento(m.midia) ? [m.mediaId] : [];
        const existente = await repo.clientePorCpfOuNome(dados);
        await propor(m.phone, 'cadastro_cliente', { tipo: 'cadastro_cliente', dados, existente, midias });
        return;
      }
      case 'mensagem_cliente': {
        const c = await resolverCliente(acao.busca);
        if (typeof c === 'string') { await enviar(m.phone, c); return; }
        const info = await repo.dadosCliente(c.id);
        if (!digitos(info.phone || '')) { await enviar(m.phone, `${c.name} não tem telefone cadastrado no CRM. Me passe o número que eu completo a ficha.`); return; }
        let tel = digitos(info.phone || '');
        if (tel.length <= 11) tel = '55' + tel;
        await substituir('mensagem_cliente');
        await propor(m.phone, 'mensagem_cliente', { tipo: 'mensagem_cliente', clientId: c.id, cliente: c.name, telefone: tel, texto: acao.texto });
        return;
      }
    }
  }

  /** Foto/PDF de um CLIENTE: se for comprovante, confere e pergunta se dá baixa. */
  async function conferirComprovanteCliente(m: { clientId: number; mediaId: number; midia: Midia }): Promise<void> {
    if (!ehDocumento(m.midia)) return;
    const abertos = await repo.abertosDoCliente(m.clientId);
    if (!abertos.length) return; // nada a receber → nem chama a IA
    const l = parseLeituraDocumento(await ia.lerDocumento(m.midia, PROMPT_LEITURA_DOCUMENTO) || '');
    if (!l || l.tipo !== 'comprovante' || !l.valor) return;

    const nome = await repo.nomeCliente(m.clientId);
    const data = l.data_pagamento || hoje();
    const dest = destinatarioConfere(l);
    const destTxt = dest === true ? '✅ Pago para você (Letícia Elias Barros)'
      : dest === false ? `❌ *ATENÇÃO: pago para ${l.destinatario_nome || l.destinatario_chave}* — não é a sua conta!`
        : '⚠️ O comprovante não mostra para quem foi pago.';
    const cab = `💸 *Comprovante de ${nome}*\nValor: *${moedaBR(l.valor)}* · pago em ${dataBR(data)}\n${destTxt}`;
    const match = casarComprovante({ valor: l.valor, data }, abertos);
    const comandantes = await repo.comandantes();

    if (!match) {
      const lista = abertos.slice(0, 3).map((a) => `• ${a.descricao} — ${moedaBR(a.valor)} (venc. ${dataBR(a.vencimento)})`).join('\n');
      for (const c of comandantes) await enviar(c, `${cab}\n\nNão achei parcela em aberto com esse valor. Em aberto:\n${lista}\n\nConfira no CRM (Financeiro → A Receber).`);
      return;
    }
    const texto = `${cab}\n\nBate com: *${match.descricao}* — ${moedaBR(match.valor)} (venc. ${dataBR(match.vencimento)})\n\nDar baixa? Responda *sim* ou *não*.`;
    const grupo = `comprovante:${m.mediaId}`;
    for (const c of comandantes) {
      await repo.criarPendencia({
        phone: c, tipo: 'baixa', grupo,
        payload: { fonte: match.fonte, id: match.id, valor: l.valor, data, cliente: nome, descricao: match.descricao, clientId: m.clientId, mediaId: m.mediaId },
        resumo: `Baixa: ${nome} — ${match.descricao} — ${moedaBR(l.valor)}`,
      });
      await enviar(c, texto);
    }
  }

  return { atenderComandante, conferirComprovanteCliente };
}
