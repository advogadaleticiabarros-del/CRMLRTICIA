// src/services/asaasService.ts
// Integração com a API do Asaas (boleto + cartão, à vista e recorrente).
// Sem chave configurada em office_settings, toda função aqui lança erro
// claro — o chamador (rota de propostas) decide se esconde a opção da UI.
import { db } from '../config/database';

async function getConfig(): Promise<{ apiKey: string; baseUrl: string } | null> {
  // Hook de teste: permite injetar config sem tocar no banco.
  if (process.env.ASAAS_TEST_API_KEY) {
    return { apiKey: process.env.ASAAS_TEST_API_KEY, baseUrl: process.env.ASAAS_TEST_BASE_URL || 'https://sandbox.asaas.com/api/v3' };
  }
  if (process.env.ASAAS_TEST_FORCE_EMPTY_KEY) return null;

  const [rows] = await db.query(
    "SELECT setting_key, setting_value FROM office_settings WHERE setting_key IN ('asaas_api_key','asaas_environment')"
  ) as any;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.setting_key] = r.setting_value;
  if (!map.asaas_api_key) return null;
  const baseUrl = map.asaas_environment === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://sandbox.asaas.com/api/v3';
  return { apiKey: map.asaas_api_key, baseUrl };
}

export async function asaasConfigured(): Promise<boolean> {
  return (await getConfig()) !== null;
}

async function request<T = any>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
  const cfg = await getConfig();
  if (!cfg) throw new Error('Asaas não configurado — defina a chave em Configurações → Financeiro');
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers: { access_token: cfg.apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.errors?.[0]?.description || data?.message || `Asaas HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export interface AsaasCustomer { id: string; name: string; cpfCnpj: string; email?: string }

/** Cria (ou reaproveita, se já existir asaas_customer_id salvo) o cliente no Asaas. */
export async function ensureAsaasCustomer(
  client: { id: number; name: string; cpf_cnpj: string; email?: string; asaas_customer_id?: string | null }
): Promise<AsaasCustomer> {
  if (client.asaas_customer_id) {
    return { id: client.asaas_customer_id, name: client.name, cpfCnpj: client.cpf_cnpj };
  }
  const created = await request<AsaasCustomer>('POST', '/customers', {
    name: client.name,
    cpfCnpj: client.cpf_cnpj,
    email: client.email || undefined,
  });
  await db.query('UPDATE clients SET asaas_customer_id = ? WHERE id = ?', [created.id, client.id]);
  return created;
}

export interface AsaasCharge { id: string; invoiceUrl: string; status: string }

/** Cria uma cobrança avulsa (boleto ou cartão à vista). */
export async function createAsaasCharge(opts: {
  customerId: string; billingType: 'BOLETO' | 'CREDIT_CARD'; value: number; dueDate: string; description: string;
}): Promise<AsaasCharge> {
  return request<AsaasCharge>('POST', '/payments', {
    customer: opts.customerId,
    billingType: opts.billingType,
    value: opts.value,
    dueDate: opts.dueDate,
    description: opts.description,
  });
}

export interface AsaasSubscription { id: string; invoiceUrl?: string }

/** Cria uma assinatura recorrente mensal de cartão. */
export async function createAsaasSubscription(opts: {
  customerId: string; value: number; nextDueDate: string; description: string; cycle?: 'MONTHLY';
}): Promise<AsaasSubscription> {
  return request<AsaasSubscription>('POST', '/subscriptions', {
    customer: opts.customerId,
    billingType: 'CREDIT_CARD',
    value: opts.value,
    nextDueDate: opts.nextDueDate,
    cycle: opts.cycle || 'MONTHLY',
    description: opts.description,
  });
}
