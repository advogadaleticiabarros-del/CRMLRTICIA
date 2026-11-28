/**
 * Vigia da ponte do TJES (28/11/2026).
 *
 * O TJES só é lido pelo computador do escritório (ver ponteEscritorio.ts). Em
 * 27/11 ele ficou desligado o dia todo, nenhuma rodada do TJES rodou e
 * ninguém soube: o erro ficava só gravado. A rotina `mni:vigia-ponte` (a cada
 * 10 min, das 7h às 21h) olha a última rodada do TJES:
 *  - falhou porque a ponte caiu e ela já voltou → roda a rodada de novo
 *    (recuperação), sem esperar o próximo horário;
 *  - falhou e a ponte continua desligada → avisa a equipe UMA vez por queda;
 *  - senão, nada.
 * Todas as dependências (banco, ponte, rodada, WhatsApp) entram por `deps`.
 */

/** Trecho da mensagem que a ponte devolve quando o computador não está conectado. */
export const ERRO_PONTE = 'computador do escritório não está conectado';

export interface EstadoPonteTjes {
  ultimoOkEm: Date | null;
  ultimoErro: string | null;
  ultimoErroEm: Date | null;
  /** Quando a equipe foi avisada da queda (null = nunca). */
  avisoEm: Date | null;
  ponteConectada: boolean;
}

export type AcaoVigia = 'recuperar' | 'avisar' | 'nada';

export function decidirVigiaPonte(e: EstadoPonteTjes | null): AcaoVigia {
  if (!e || !e.ultimoErro || !e.ultimoErroEm) return 'nada';
  if (!e.ultimoErro.includes(ERRO_PONTE)) return 'nada';
  if (e.ultimoOkEm && e.ultimoOkEm >= e.ultimoErroEm) return 'nada';
  if (e.ponteConectada) return 'recuperar';
  // Uma queda começa depois da última rodada boa: aviso de antes dela não conta.
  const inicioQueda = e.ultimoOkEm;
  const jaAvisou = !!e.avisoEm && (!inicioQueda || e.avisoEm > inicioQueda);
  return jaAvisou ? 'nada' : 'avisar';
}

export interface DepsVigiaPonte {
  /** null = TJES sem login cadastrado ou desligado. */
  estado(): Promise<EstadoPonteTjes | null>;
  /** Roda a rodada do MNI de novo. true = o TJES foi lido. */
  recuperar(): Promise<boolean>;
  avisar(texto: string): Promise<void>;
  marcarAviso(): Promise<void>;
}

const hora = (d: Date | null) => (d
  ? d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : 'nunca');

export async function vigiarPonteTjes(deps: DepsVigiaPonte): Promise<{ acao: AcaoVigia; lido?: boolean }> {
  const e = await deps.estado();
  const acao = decidirVigiaPonte(e);
  if (acao === 'avisar' && e) {
    await deps.avisar(
      '⚠️ O CRM não está conseguindo ler o TJES: o computador do escritório (a ponte) está desligado ou sem internet.\n'
      + `Última leitura do TJES: ${hora(e.ultimoOkEm)}. Enquanto isso, intimações e petições do TJES não chegam ao CRM.\n`
      + 'Ligue o computador do escritório na tomada. Quando ele voltar, o CRM lê o TJES sozinho e avisa.',
    );
    await deps.marcarAviso();
    return { acao };
  }
  if (acao === 'recuperar' && e) {
    const lido = await deps.recuperar();
    if (lido && e.avisoEm) await deps.avisar('✅ O computador do escritório voltou e o TJES foi lido de novo. O CRM está em dia.');
    return { acao, lido };
  }
  return { acao };
}
