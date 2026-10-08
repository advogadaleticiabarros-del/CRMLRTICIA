/**
 * Assistente pessoal do CRM pelo WhatsApp (desde 08/10/2026).
 *
 * A Dra. Letícia e a Jessica (números em office_settings.assistente_whatsapp_numeros)
 * escrevem para o número do escritório como numa conversa normal — texto, áudio,
 * foto de boleto — e o CRM responde: lança contas a pagar e gastos (sempre com
 * confirmação "sim"), consulta processo de cliente e agenda. E quando um CLIENTE
 * manda comprovante, confere e pergunta a elas se dá baixa.
 *
 * A IA só interpreta e lê documentos; o que é gravado é decidido aqui e nas regras
 * puras (assistenteRegras.ts). Banco, IA e envio são injetados — os testes usam a
 * mesma interface que o webhook (tests/assistenteWhatsapp.test.mjs).
 */
import {
  Lancamento, ItemAberto, ItemAgenda, ProcessoInfo,
  interpretarConfirmacao, parseAcao, promptAssistente, lerJson,
  PROMPT_LEITURA_DOCUMENTO, parseLeituraDocumento, destinatarioConfere, casarComprovante,
  textoConfirmacao, formatarAgenda, formatarProcessos, moedaBR, dataBR,
} from './assistenteRegras';

export interface Midia { mime: string; data: Buffer; file_name?: string }
export interface Pendencia { id: number; phone: string; tipo: 'lancamento' | 'baixa'; payload: any; resumo: string; grupo?: string | null }
export type ResultadoBaixa = 'ok' | 'ja_pago' | 'nao_encontrado';

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

const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const ehAudio = (m?: Midia) => !!m && /^(audio|video)\//.test(m.mime);
const ehDocumento = (m?: Midia) => !!m && (/^image\//.test(m.mime) || m.mime === 'application/pdf');

export function criarAssistente(deps: AssistenteDeps) {
  const { repo, ia, enviar } = deps;
  const agora = deps.agora || (() => new Date());
  /** Data de hoje em Brasília (UTC-3). */
  const hoje = () => new Date(agora().getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const diaSemana = () => DIAS_SEMANA[new Date(hoje() + 'T12:00:00Z').getUTCDay()];
  const quem = (phone: string) => `Assistente WhatsApp (${phone})`;

  async function executar(phone: string, p: Pendencia): Promise<string> {
    if (p.tipo === 'lancamento') {
      const l = p.payload as Lancamento;
      const id = await repo.lancar(l, quem(phone));
      await repo.fecharPendencia(p.id, 'confirmada');
      return `✅ Lançado ${l.tipo === 'conta_pagar' ? 'no Contas a Pagar' : 'nos gastos'} (nº ${id}): ${l.descricao} — ${moedaBR(l.valor)} — ${l.tipo === 'conta_pagar' ? 'vence' : 'em'} ${dataBR(l.data)}.`;
    }
    const b = p.payload;
    const r = await repo.baixar({ fonte: b.fonte, id: b.id }, { data: b.data, valor: b.valor, quem: quem(phone) });
    await repo.fecharPendencia(p.id, 'confirmada');
    if (r === 'ja_pago') return `ℹ️ ${b.descricao} de ${b.cliente} já estava baixada. Nada mudou.`;
    if (r === 'nao_encontrado') return `⚠️ Não encontrei mais a parcela "${b.descricao}" de ${b.cliente}. Confira no A Receber.`;
    return `✅ Baixa feita: ${b.cliente} — ${b.descricao} — ${moedaBR(b.valor)} pago em ${dataBR(b.data)}.`;
  }

  function listar(pend: Pendencia[]): string {
    return `Tenho ${pend.length} itens aguardando confirmação:\n` +
      pend.map((p, i) => `${i + 1}) ${p.resumo}`).join('\n') +
      `\n\nResponda *sim 1*, *sim 2*… (ou *não 1* para cancelar).`;
  }

  /** Mensagem de um número que comanda o assistente. */
  async function atenderComandante(m: { phone: string; texto: string; midia?: Midia }): Promise<void> {
    let msg = String(m.texto || '').trim();

    if (ehAudio(m.midia)) {
      const t = await ia.transcrever(m.midia!);
      if (!t) { await enviar(m.phone, '🎧 Não consegui entender o áudio. Pode mandar de novo ou escrever?'); return; }
      msg = [msg, t].filter(Boolean).join(' ');
    }

    const pend = await repo.pendencias(m.phone);
    const conf = m.midia ? null : interpretarConfirmacao(msg);
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
      if (!documento && !msg) { await enviar(m.phone, '📄 Não consegui ler o documento. Me diga o que é, o valor e o vencimento.'); return; }
    }
    if (!msg && !documento) return;

    const pendenteLanc = [...pend].reverse().find((p) => p.tipo === 'lancamento') || null;
    const raw = await ia.interpretar(promptAssistente({
      hoje: hoje(), diaSemana: diaSemana(), mensagem: msg || '(sem texto — só o documento)',
      documento, pendente: pendenteLanc ? pendenteLanc.payload : null,
    }));
    if (raw === null) { await enviar(m.phone, '⚠️ A IA não respondeu agora. Tente de novo em instantes.'); return; }
    const acao = parseAcao(raw, hoje());
    if (!acao) {
      await enviar(m.phone, 'Não entendi. 🙂 Posso lançar *contas a pagar* (mande a foto do boleto), registrar *gastos* ("gastei 50 de táxi"), '
        + 'dizer o *processo* de um cliente e mostrar sua *agenda* ("agenda de amanhã").');
      return;
    }

    if (acao.tipo === 'conta_pagar' || acao.tipo === 'gasto') {
      if (pendenteLanc && lerJson(raw)?.corrige === true) await repo.fecharPendencia(pendenteLanc.id, 'substituida');
      await repo.criarPendencia({
        phone: m.phone, tipo: 'lancamento', payload: acao, grupo: null,
        resumo: `${acao.tipo === 'conta_pagar' ? 'Conta a pagar' : 'Gasto'}: ${acao.descricao} — ${moedaBR(acao.valor)}`,
      });
      await enviar(m.phone, textoConfirmacao(acao));
    } else if (acao.tipo === 'processo') {
      await enviar(m.phone, formatarProcessos(await repo.buscarProcessos(acao.busca), acao.busca));
    } else if (acao.tipo === 'agenda') {
      await enviar(m.phone, formatarAgenda(await repo.agenda(acao.de, acao.ate), acao.de, acao.ate));
    } else if (acao.tipo === 'responder') {
      await enviar(m.phone, acao.texto);
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
