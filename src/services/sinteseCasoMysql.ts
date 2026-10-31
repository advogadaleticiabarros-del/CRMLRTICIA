import { db } from '../config/database';
import { retirarSenhaInss } from './senhaInssCliente';
import { VERSAO_FICHA } from './leituraUnica';
import type { FichaDeFatos } from './pecaDossie';
import type { EntradaSintese } from './sinteseCaso';

/**
 * Banco da síntese do caso (regras em sinteseCaso.ts; os contratos vêm do carregarLote): a
 * ficha de fatos mais recente da leitura única, o relato do atendimento (lead) e a
 * parceria e a data de chegada. Senha do Meu INSS nunca aparece (sai do relato).
 */
export async function fontesDaSintese(clientId: number, caseIds: number[]): Promise<Pick<EntradaSintese, 'ficha' | 'relatoCliente' | 'origem'>> {
  let ficha: FichaDeFatos | null = null;
  const [[f]] = await db.query('SELECT leitura FROM documento_leituras WHERE ref LIKE ? ORDER BY id DESC LIMIT 1', [`ficha${VERSAO_FICHA}:${clientId}:%`]).catch(() => [[null]]) as any;
  if (f) {
    try {
      const l = typeof f.leitura === 'string' ? JSON.parse(f.leitura) : f.leitura;
      const parsed = l?.texto ? JSON.parse(String(l.texto)) : null;
      if (parsed && Array.isArray(parsed.contratos)) ficha = parsed as FichaDeFatos;
    } catch { ficha = null; }
  }

  const [[lead]] = await db.query(
    "SELECT case_summary FROM leads WHERE client_id = ? AND case_summary IS NOT NULL AND case_summary <> '' ORDER BY id DESC LIMIT 1", [clientId]).catch(() => [[null]]) as any;
  const relatoCliente = lead?.case_summary ? retirarSenhaInss(String(lead.case_summary)).texto : null;

  const [[parc]] = caseIds.length
    ? await db.query('SELECT p.name FROM cases c JOIN partners p ON p.id = c.partner_id WHERE c.id IN (?) LIMIT 1', [caseIds]).catch(() => [[null]]) as any
    : [[null]];
  const [[email]] = await db.query(
    'SELECT COALESCE(received_at, created_at) AS chegou FROM email_imports WHERE client_id = ? ORDER BY id ASC LIMIT 1', [clientId]).catch(() => [[null]]) as any;
  const chegouEm = email?.chegou ? new Date(email.chegou).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : null;

  return { ficha, relatoCliente, origem: parc?.name || chegouEm ? { parceiro: parc?.name || null, chegouEm } : null };
}
