import { db } from '../config/database';

/**
 * RETENÇÃO E EXPURGO DE DADOS PESSOAIS (LGPD, arts. 15 e 16)
 *
 * A LGPD manda eliminar o dado pessoal quando acaba a finalidade do tratamento.
 * MAS um escritório de advocacia tem DEVER LEGAL de guardar processo, procuração,
 * contrato e financeiro (prazos prescricionais, deveres da OAB). Apagar isso seria
 * pior do que não apagar nada.
 *
 * Por isso este expurgo é CIRÚRGICO. A regra de ouro:
 *
 *   ❌ NUNCA TOCA: clients, cases, documents, financial_records, contracts,
 *      legal_pieces, deadlines — pode ser prova, e há dever de guarda.
 *
 *   ✅ TOCA: logs operacionais, tokens vencidos, e-mails que você RECUSOU,
 *      leads que nunca viraram cliente (anonimizados, não apagados) e mídia de
 *      WhatsApp ÓRFÃ (de contato que nunca virou cliente).
 *
 * Tudo fica registrado em `retention_log` — a LGPD exige eliminar, mas o
 * escritório também precisa PROVAR que cumpre.
 */

export interface Politica {
  nome: string;
  tabela: string;
  acao: 'apagado' | 'anonimizado';
  criterio: string;
  /** Por que é seguro (ou por que NÃO é dever de guarda). */
  porque: string;
  contar: string;              // SELECT COUNT(*)
  executar: string;            // DELETE/UPDATE
  params?: any[];
}

const DIAS = {
  tokens: 7,            // token de reset de senha: sem valor após usar/expirar
  logsOperacionais: 90, // job_runs: sem dado pessoal
  notificacoes: 180,    // avisos de tela
  reminders: 365,       // log de "já enviei"
  emailsRecusados: 90,  // e-mail de parceria que você DESCARTOU
  leadsPerdidos: 730,   // 2 anos — nunca virou cliente
  midiaOrfa: 365,       // mídia de WhatsApp sem cliente vinculado
};

export const POLITICAS: Politica[] = [
  // ── NÍVEL 1 — logs e tokens: risco zero, sem dever de guarda ──────────────
  {
    nome: 'tokens_reset_vencidos', tabela: 'password_resets', acao: 'apagado',
    criterio: `usados ou expirados há mais de ${DIAS.tokens} dias`,
    porque: 'Token de recuperação de senha não tem valor depois de usado/expirado — guardá-lo só cria risco.',
    contar: `SELECT COUNT(*) AS n FROM password_resets
              WHERE (used_at IS NOT NULL OR expires_at < NOW())
                AND created_at < NOW() - INTERVAL ${DIAS.tokens} DAY`,
    executar: `DELETE FROM password_resets
                WHERE (used_at IS NOT NULL OR expires_at < NOW())
                  AND created_at < NOW() - INTERVAL ${DIAS.tokens} DAY`,
  },
  {
    nome: 'logs_rotinas', tabela: 'job_runs', acao: 'apagado',
    criterio: `mais de ${DIAS.logsOperacionais} dias`,
    porque: 'Log operacional das rotinas. Não contém dado pessoal.',
    contar: `SELECT COUNT(*) AS n FROM job_runs WHERE ran_at < NOW() - INTERVAL ${DIAS.logsOperacionais} DAY`,
    executar: `DELETE FROM job_runs WHERE ran_at < NOW() - INTERVAL ${DIAS.logsOperacionais} DAY`,
  },
  {
    nome: 'notificacoes_antigas', tabela: 'notifications', acao: 'apagado',
    criterio: `mais de ${DIAS.notificacoes} dias`,
    porque: 'Aviso de tela já visto. O fato em si (prazo, protocolo) continua no caso — isto é só o aviso.',
    contar: `SELECT COUNT(*) AS n FROM notifications WHERE created_at < NOW() - INTERVAL ${DIAS.notificacoes} DAY`,
    executar: `DELETE FROM notifications WHERE created_at < NOW() - INTERVAL ${DIAS.notificacoes} DAY`,
  },
  {
    nome: 'log_lembretes', tabela: 'sent_reminders', acao: 'apagado',
    criterio: `mais de ${DIAS.reminders} dias`,
    porque: 'Apenas o registro de "este lembrete já foi enviado", para não repetir. Sem dado pessoal.',
    contar: `SELECT COUNT(*) AS n FROM sent_reminders WHERE created_at < NOW() - INTERVAL ${DIAS.reminders} DAY`,
    executar: `DELETE FROM sent_reminders WHERE created_at < NOW() - INTERVAL ${DIAS.reminders} DAY`,
  },

  // ── NÍVEL 2 — tem dado pessoal, mas SEM dever de guarda: a LGPD manda apagar ──
  {
    nome: 'emails_recusados', tabela: 'email_imports', acao: 'apagado',
    criterio: `descartados há mais de ${DIAS.emailsRecusados} dias`,
    porque: 'E-mail de parceria que VOCÊ DESCARTOU: o caso não é seu, não virou cliente. ' +
            'Contém dados de uma pessoa que não é sua cliente — guardar é justamente o que a LGPD proíbe. ' +
            'Os CONFIRMADOS não são tocados (viraram caso).',
    contar: `SELECT COUNT(*) AS n FROM email_imports
              WHERE status = 'descartado' AND created_at < NOW() - INTERVAL ${DIAS.emailsRecusados} DAY`,
    executar: `DELETE FROM email_imports
                WHERE status = 'descartado' AND created_at < NOW() - INTERVAL ${DIAS.emailsRecusados} DAY`,
  },
  {
    nome: 'leads_perdidos', tabela: 'leads', acao: 'anonimizado',
    criterio: `perdidos há mais de ${DIAS.leadsPerdidos} dias (2 anos)`,
    porque: 'Nunca virou cliente → não há dever de guarda. NÃO apaga a linha: ANONIMIZA ' +
            '(tira nome, e-mail e telefone). Assim você mantém a estatística comercial e, ' +
            'pelo art. 12 da LGPD, dado anonimizado deixa de ser dado pessoal.',
    contar: `SELECT COUNT(*) AS n FROM leads
              WHERE status = 'perdido' AND created_at < NOW() - INTERVAL ${DIAS.leadsPerdidos} DAY
                AND name <> '[anonimizado]'`,
    executar: `UPDATE leads
                  SET name = '[anonimizado]', email = NULL, phone = NULL
                WHERE status = 'perdido' AND created_at < NOW() - INTERVAL ${DIAS.leadsPerdidos} DAY
                  AND name <> '[anonimizado]'`,
  },

  // ── NÍVEL 3 — mídia: só a ÓRFÃ. Mídia de cliente PODE SER PROVA. ───────────
  {
    nome: 'midia_whatsapp_orfa', tabela: 'whatsapp_media', acao: 'apagado',
    criterio: `sem cliente vinculado e com mais de ${DIAS.midiaOrfa} dias`,
    porque: '⚠️ SÓ a mídia ÓRFÃ (client_id IS NULL) — de contato que NUNCA virou cliente. ' +
            'Mídia de cliente NÃO é tocada: pode ser prova (foto da CTPS, laudo, print de conversa). ' +
            'Também alivia o backup diário, que carrega esses arquivos.',
    contar: `SELECT COUNT(*) AS n FROM whatsapp_media
              WHERE client_id IS NULL AND created_at < NOW() - INTERVAL ${DIAS.midiaOrfa} DAY`,
    executar: `DELETE FROM whatsapp_media
                WHERE client_id IS NULL AND created_at < NOW() - INTERVAL ${DIAS.midiaOrfa} DAY`,
  },
];

export interface ItemRelatorio {
  politica: string; tabela: string; acao: string; criterio: string; porque: string;
  linhas: number; erro?: string;
}
export interface RelatorioRetencao {
  simulacao: boolean;
  itens: ItemRelatorio[];
  total: number;
  intocadas: string[];
}

/** Tabelas que este serviço JAMAIS toca — dever de guarda / podem ser prova. */
export const INTOCADAS = [
  'clients', 'cases', 'documents', 'financial_records',
  'contracts', 'legal_pieces', 'deadlines',
];

/**
 * Roda (ou simula) o expurgo.
 * @param simulacao true = só conta, não apaga nada (use para revisar antes)
 */
export async function runRetention(simulacao = false): Promise<RelatorioRetencao> {
  const itens: ItemRelatorio[] = [];
  let total = 0;

  for (const p of POLITICAS) {
    try {
      const [[c]] = await db.query(p.contar) as any;
      const linhas = Number(c?.n) || 0;

      if (linhas > 0 && !simulacao) {
        await db.query(p.executar);
      }
      // Registra sempre — inclusive a simulação (prova de diligência).
      if (linhas > 0) {
        try {
          await db.query(
            `INSERT INTO retention_log (politica, tabela, acao, linhas, criterio, simulacao)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [p.nome, p.tabela, p.acao, linhas, p.criterio, simulacao ? 1 : 0]
          );
        } catch { /* o log não pode travar o expurgo */ }
      }

      itens.push({ politica: p.nome, tabela: p.tabela, acao: p.acao, criterio: p.criterio, porque: p.porque, linhas });
      total += linhas;
    } catch (e: any) {
      // Tabela pode não existir ainda (migration não rodou) — não derruba as outras.
      itens.push({
        politica: p.nome, tabela: p.tabela, acao: p.acao, criterio: p.criterio, porque: p.porque,
        linhas: 0, erro: e?.message || String(e),
      });
    }
  }

  const verbo = simulacao ? 'seriam tratadas' : 'tratadas';
  console.log(`🧹 [LGPD] Expurgo${simulacao ? ' (SIMULAÇÃO)' : ''}: ${total} linha(s) ${verbo}.`);
  return { simulacao, itens, total, intocadas: INTOCADAS };
}
