import { consultarProcessoDataJud, NormalizedMovement } from './datajud';

export interface ProcessQueryResult {
  found: boolean;
  error?: string;
  movements: NormalizedMovement[];
  metadata?: any;
}

/** Contrato comum dos providers de monitoramento processual. */
export interface ProcessProvider {
  name: string;
  getMovements(processNumber: string, courtAlias: string): Promise<ProcessQueryResult>;
}

/** Mock — para testes locais sem API. */
export class MockProvider implements ProcessProvider {
  name = 'mock';
  async getMovements(processNumber: string): Promise<ProcessQueryResult> {
    return {
      found: true,
      movements: [
        { movement_date: '2026-06-18T10:00:00', title: 'Conclusos para despacho', description: 'Movimentação simulada (mock).' },
        { movement_date: '2026-06-17T14:30:00', title: 'Juntada de petição', description: 'Movimentação simulada (mock).' },
      ],
    };
  }
}

/** Manual — processos sem consulta externa (movimentações inseridas à mão). */
export class ManualProvider implements ProcessProvider {
  name = 'manual';
  async getMovements(): Promise<ProcessQueryResult> {
    return { found: true, movements: [] };
  }
}

/** DataJud/CNJ — gratuito e oficial. */
export class DataJudProvider implements ProcessProvider {
  name = 'datajud';
  async getMovements(processNumber: string, courtAlias: string): Promise<ProcessQueryResult> {
    return consultarProcessoDataJud(processNumber, courtAlias);
  }
}

/** Preparado para APIs pagas (Escavador, Data Lawyer, Jusbrasil). Inativo. */
export class PaidApiProvider implements ProcessProvider {
  name = 'paid_api';
  async getMovements(): Promise<ProcessQueryResult> {
    return { found: false, error: 'Provider pago ainda não configurado', movements: [] };
  }
}

const PROVIDERS: Record<string, ProcessProvider> = {
  mock: new MockProvider(),
  manual: new ManualProvider(),
  datajud: new DataJudProvider(),
  paid_api: new PaidApiProvider(),
};

/** Provider ativo — definido por PROCESS_PROVIDER no .env (default: datajud). */
export function getActiveProvider(): ProcessProvider {
  const key = process.env.PROCESS_PROVIDER || 'datajud';
  return PROVIDERS[key] || PROVIDERS.datajud;
}

export function getProvider(name: string): ProcessProvider {
  return PROVIDERS[name] || PROVIDERS.datajud;
}
