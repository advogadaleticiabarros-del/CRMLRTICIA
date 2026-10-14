import { db } from '../config/database';

/**
 * Contadores do escritório virtual: uso de IA por provedor por dia e ações
 * dos agentes. As duas funções são "dispare e esqueça": nunca lançam nem
 * atrasam quem chamou (registro é só para a tela de métricas).
 */

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

export function registrarUsoIa(provedor: 'openai' | 'openai_smart' | 'groq' | 'gemini' | 'laya'): void {
  db.query(
    'INSERT INTO ia_uso_diario (dia, provedor, chamadas) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE chamadas = chamadas + 1',
    [hojeSP(), provedor]
  ).catch(() => { /* tabela pode não existir antes da migration 156 */ });
}

export function registrarAcaoAgente(agente: string, texto: string): void {
  db.query('INSERT INTO agente_acoes (agente, texto) VALUES (?, ?)', [agente, String(texto).slice(0, 300)])
    .catch(() => { /* idem */ });
}
