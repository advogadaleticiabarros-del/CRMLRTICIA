/**
 * Rodada do monitoramento pela ligação oficial com os tribunais (MNI).
 *
 * Para cada sistema com login cadastrado e ativo:
 *  1. busca as intimações pendentes (sem abrir: não dá ciência) e registra a
 *     data da ciência automática; avisa a equipe das novas;
 *  2. busca as movimentações dos processos monitorados daquele sistema e grava
 *     as novas no mesmo lugar das demais fontes (DJEN, DataJud, e-mail).
 *
 * Se o tribunal recusar o login, PARA aquele sistema na hora e desliga a
 * credencial (não tenta de novo sozinho), porque alguns tribunais bloqueiam a
 * senha depois de poucos erros. A equipe é avisada para conferir a senha.
 *
 * Todas as dependências (banco, tribunal, CNJ, avisos) entram por `deps`.
 */
import { AvisoMni, ClienteMni, CredencialMni, DocumentoMni, ErroLoginMni, MovimentoMni, ParteMni } from './cliente';
import { SISTEMAS_MNI, SistemaMni, cienciaAutomaticaEm, fonteMni } from './sistemas';

export interface MovimentacaoParaGravar { movement_date: string | null; title: string; description: string }

export interface DepsMonitorMni {
  credenciaisAtivas(): Promise<Array<{ sistema: string } & CredencialMni>>;
  cliente(sistema: SistemaMni): ClienteMni;
  nomeMovimento(codigo: number | null): Promise<string | null>;
  processosMonitorados(): Promise<Array<{ id: number; process_number: string }>>;
  /** Acha o processo pelo número (só dígitos) ou cadastra; devolve o id. */
  garantirProcesso(numero: string, orgao: string | null): Promise<{ id: number; criado: boolean }>;
  gravarMovimentos(processId: number, numero: string, movs: MovimentacaoParaGravar[], fonte: string): Promise<number>;
  /** Grava/atualiza os avisos vistos agora e marca como resolvidos os que sumiram. Devolve os novos. */
  registrarAvisos(sistema: string, avisos: Array<AvisoMni & { processId: number | null; cienciaAutomatica: string | null }>): Promise<{ novos: number; resolvidos: number; listaNovos: Array<AvisoMni & { cienciaAutomatica: string | null }> }>;
  marcarOk(sistema: string, avisosPendentes: number): Promise<void>;
  marcarErro(sistema: string, mensagem: string, desligar: boolean): Promise<void>;
  avisarEquipe(titulo: string, mensagem: string): Promise<void>;
  /** Completa a ficha do cliente do processo com as partes vindas do tribunal (só campos vazios). Devolve quantos campos gravou. */
  completarFicha?(processId: number, partes: ParteMni[]): Promise<number>;
  /** Guarda no processo o valor da causa e a lista de partes que o tribunal devolveu. */
  guardarDadosDoProcesso?(processId: number, dados: { valorCausa: number | null; partes: ParteMni[] }): Promise<void>;
  /** Data (do tribunal) da petição mais nova cujos documentos já foram lidos. */
  documentosLidosAte?(processId: number, sistema: string): Promise<string | null>;
  /** Guarda a lista de documentos e marca até qual petição foi lida. Devolve quantos guardou. */
  guardarDocumentos?(processId: number, sistema: string, docs: DocumentoMni[], lidosAte: string): Promise<number>;
  /** Hoje (AAAA-MM-DD), para a janela de petições recentes. */
  hoje?(): string;
  pausa?(ms: number): Promise<void>;
}

/** Código nacional (TPU) do movimento "Petição" (juntada de petição). */
export const MOVIMENTO_PETICAO = 85;
/** Só olha os documentos de petições juntadas nos últimos N dias. */
export const JANELA_DOCUMENTOS_DIAS = 30;
/** Máximo de processos com lista de documentos por rodada (cada um é uma consulta a mais ao tribunal). */
export const LIMITE_DOCUMENTOS_POR_RODADA = 15;

/**
 * Se há petição juntada nos últimos 30 dias mais nova que a última leitura,
 * devolve a data dela (a mais nova); senão, null.
 */
export function precisaLerDocumentos(movimentos: MovimentoMni[], lidosAte: string | null, hoje: string): string | null {
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - JANELA_DOCUMENTOS_DIAS);
  const desde = d.toISOString().slice(0, 10);
  const datas = movimentos
    .filter((m) => m.codigoNacional === MOVIMENTO_PETICAO && m.dataHora && m.dataHora.slice(0, 10) >= desde)
    .map((m) => m.dataHora as string)
    .sort();
  const maisNova = datas[datas.length - 1];
  if (!maisNova) return null;
  return !lidosAte || maisNova > lidosAte ? maisNova : null;
}

export interface ResumoSistema {
  sistema: string;
  status: 'ok' | 'login_recusado' | 'erro';
  avisosPendentes: number;
  avisosNovos: number;
  processosConsultados: number;
  movimentacoesNovas: number;
  processosNovos: number;
  camposDeFichaCompletados: number;
  /** Documentos (só os dados) guardados nesta rodada. */
  documentosLidos: number;
  mensagem?: string;
}

const dataBr = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

const TIPOS: Record<string, string> = { INT: 'Intimação', CIT: 'Citação', NOT: 'Notificação', VIS: 'Vista', URG: 'Urgente', PTI: 'Pauta' };
export const nomeTipoComunicacao = (t: string | null) => (t ? TIPOS[t.toUpperCase()] || t : 'Comunicação');

export function formatarNumeroCnj(d: string): string {
  const n = d.replace(/\D/g, '');
  if (n.length !== 20) return d;
  return `${n.slice(0, 7)}-${n.slice(7, 9)}.${n.slice(9, 13)}.${n.slice(13, 14)}.${n.slice(14, 16)}.${n.slice(16, 20)}`;
}

/** Movimento do tribunal → movimentação do CRM (título por extenso + complementos). */
export async function converterMovimento(m: MovimentoMni, nome: (c: number | null) => Promise<string | null>): Promise<MovimentacaoParaGravar> {
  const titulo = m.descricao || (await nome(m.codigoNacional)) || (m.codigoNacional != null ? `Movimento (código ${m.codigoNacional})` : 'Movimento');
  const complementos = m.complementos.filter((c) => c && c.toLowerCase() !== titulo.toLowerCase());
  return {
    movement_date: m.dataHora,
    title: titulo,
    description: complementos.length ? `${titulo} — ${complementos.join('; ')}` : titulo,
  };
}

async function rodarSistema(sistema: SistemaMni, cred: CredencialMni, processos: Array<{ id: number; process_number: string }>, deps: DepsMonitorMni): Promise<ResumoSistema> {
  const resumo: ResumoSistema = { sistema: sistema.id, status: 'ok', avisosPendentes: 0, avisosNovos: 0, processosConsultados: 0, movimentacoesNovas: 0, processosNovos: 0, camposDeFichaCompletados: 0, documentosLidos: 0 };
  const cli = deps.cliente(sistema);
  const pausa = deps.pausa ?? (() => Promise.resolve());
  const hoje = deps.hoje ? deps.hoje() : new Date().toISOString().slice(0, 10);
  let consultasDeDocumentos = 0;

  try {
    // 1) Intimações pendentes
    const avisos = await cli.avisosPendentes(cred);
    resumo.avisosPendentes = avisos.length;
    const comProcesso = [];
    for (const a of avisos) {
      let processId: number | null = null;
      if (a.numeroProcesso && a.numeroProcesso.length === 20) {
        const p = await deps.garantirProcesso(a.numeroProcesso, a.orgaoJulgador);
        processId = p.id;
        if (p.criado) resumo.processosNovos++;
      }
      comProcesso.push({ ...a, processId, cienciaAutomatica: cienciaAutomaticaEm(a.disponibilizadoEm) });
    }
    const reg = await deps.registrarAvisos(sistema.id, comProcesso);
    resumo.avisosNovos = reg.novos;
    for (const a of reg.listaNovos) {
      await deps.avisarEquipe(
        `${nomeTipoComunicacao(a.tipoComunicacao)} pendente — ${sistema.nome}`,
        [
          a.numeroProcesso ? `Processo ${formatarNumeroCnj(a.numeroProcesso)}` : 'Processo sem número no aviso',
          a.orgaoJulgador || null,
          a.disponibilizadoEm ? `Disponibilizada em ${dataBr(a.disponibilizadoEm)}` : null,
          a.cienciaAutomatica ? `Se ninguém abrir, a ciência é automática em ${dataBr(a.cienciaAutomatica)} e o prazo começa a contar.` : null,
          'O CRM não abriu a intimação: abra no sistema do tribunal quando decidir.',
        ].filter(Boolean).join(' · '),
      );
    }

    // 2) Movimentações dos processos monitorados deste sistema
    for (const p of processos) {
      if (!sistema.atende(p.process_number)) continue;
      let proc;
      try {
        proc = await cli.consultarProcesso(cred, p.process_number);
      } catch (e) {
        if (e instanceof ErroLoginMni) throw e;
        continue; // processo de outro grau, em sigilo ou fora deste sistema: segue
      }
      resumo.processosConsultados++;
      const movs = [];
      for (const m of proc.movimentos) movs.push(await converterMovimento(m, deps.nomeMovimento));
      if (movs.length) resumo.movimentacoesNovas += await deps.gravarMovimentos(p.id, p.process_number, movs, fonteMni(sistema.id));
      if (deps.guardarDadosDoProcesso && (proc.valorCausa != null || proc.partes?.length)) {
        await deps.guardarDadosDoProcesso(p.id, { valorCausa: proc.valorCausa, partes: proc.partes || [] }).catch(() => {});
      }
      if (deps.completarFicha && proc.partes?.length) {
        resumo.camposDeFichaCompletados += await deps.completarFicha(p.id, proc.partes).catch(() => 0);
      }
      // Petição nova: lê a LISTA de documentos (quem juntou, que tipo), base da baixa automática de prazos.
      if (cli.documentosDoProcesso && deps.guardarDocumentos && deps.documentosLidosAte && consultasDeDocumentos < LIMITE_DOCUMENTOS_POR_RODADA) {
        const ate = precisaLerDocumentos(proc.movimentos, await deps.documentosLidosAte(p.id, sistema.id).catch(() => null), hoje);
        if (ate) {
          consultasDeDocumentos++;
          try {
            await pausa(800);
            const docs = await cli.documentosDoProcesso(cred, p.process_number);
            resumo.documentosLidos += await deps.guardarDocumentos(p.id, sistema.id, docs, ate);
          } catch (e) {
            if (e instanceof ErroLoginMni) throw e;
            // tribunal lento ou recusou a lista: tenta de novo na próxima rodada
          }
        }
      }
      await pausa(800);
    }

    await deps.marcarOk(sistema.id, resumo.avisosPendentes);
  } catch (e: any) {
    if (e instanceof ErroLoginMni) {
      resumo.status = 'login_recusado';
      resumo.mensagem = e.message;
      await deps.marcarErro(sistema.id, e.message, true);
      await deps.avisarEquipe(
        `Login recusado — ${sistema.nome}`,
        `O tribunal recusou o login (${e.message}). Para não bloquear a senha, o CRM parou de tentar neste sistema. Confira a senha em Configurações → Ligação com os tribunais.`,
      );
    } else {
      resumo.status = 'erro';
      resumo.mensagem = String(e?.message || e).slice(0, 300);
      await deps.marcarErro(sistema.id, resumo.mensagem, false);
    }
  }
  return resumo;
}

export async function rodarMonitoramentoMni(deps: DepsMonitorMni): Promise<{ sistemas: ResumoSistema[] }> {
  const creds = await deps.credenciaisAtivas();
  if (!creds.length) return { sistemas: [] };
  const processos = await deps.processosMonitorados();
  const sistemas: ResumoSistema[] = [];
  for (const c of creds) {
    const sistema = SISTEMAS_MNI.find((s) => s.id === c.sistema);
    if (!sistema) continue;
    sistemas.push(await rodarSistema(sistema, { cpf: c.cpf, senha: c.senha, totp: c.totp ?? null }, processos, deps));
  }
  return { sistemas };
}

/** Teste de login de UM sistema (uma única tentativa, pedida pela usuária na tela). */
export async function testarLogin(cli: ClienteMni, cred: CredencialMni): Promise<{ ok: boolean; avisos?: number; mensagem?: string; loginRecusado?: boolean }> {
  try {
    const avisos = await cli.avisosPendentes(cred);
    return { ok: true, avisos: avisos.length };
  } catch (e: any) {
    return { ok: false, mensagem: String(e?.message || e).slice(0, 300), loginRecusado: e instanceof ErroLoginMni };
  }
}
