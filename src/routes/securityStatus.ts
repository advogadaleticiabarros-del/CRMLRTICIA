import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { isEncrypted } from '../utils/crypto';

const router = Router();

/**
 * Estado da proteção de dados (LGPD) — prova verificável, não promessa.
 *
 * Responde: a chave está configurada? sobrou algum token em TEXTO PURO no banco?
 * o backup sairá cifrado?
 *
 * NUNCA revela a chave nem qualquer token — só diz "cifrado" ou "em claro".
 * Somente ADMIN.
 */

const ALVOS: { tabela: string; rotulo: string; campos: string[] }[] = [
  { tabela: 'google_accounts',   rotulo: 'Google (Agenda/Drive)', campos: ['access_token', 'refresh_token'] },
  { tabela: 'email_integration', rotulo: 'Gmail da parceria',     campos: ['access_token', 'refresh_token'] },
  { tabela: 'whatsapp_settings', rotulo: 'WhatsApp',              campos: ['access_token'] },
];

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const temChavePropria = !!process.env.ENCRYPTION_KEY;
    const temFallback = !temChavePropria && !!process.env.JWT_SECRET;

    const tokens: any[] = [];
    let emClaroTotal = 0, cifradosTotal = 0;

    for (const a of ALVOS) {
      try {
        const [rows] = await db.query(`SELECT ${a.campos.join(', ')} FROM ${a.tabela}`) as any;
        let cifrados = 0, emClaro = 0;
        for (const r of rows) {
          for (const c of a.campos) {
            const v = r[c];
            if (v == null || v === '') continue;
            if (isEncrypted(v)) cifrados++; else emClaro++;
          }
        }
        cifradosTotal += cifrados; emClaroTotal += emClaro;
        tokens.push({ origem: a.rotulo, tabela: a.tabela, cifrados, em_claro: emClaro, ok: emClaro === 0 });
      } catch (e: any) {
        tokens.push({ origem: a.rotulo, tabela: a.tabela, erro: e?.message });
      }
    }

    const chaveOk = temChavePropria;
    const tokensOk = emClaroTotal === 0;

    const alertas: string[] = [];
    if (!temChavePropria && temFallback) {
      alertas.push(
        'ENCRYPTION_KEY não está definida — o sistema está derivando a chave do JWT_SECRET. ' +
        'Funciona, mas se você rotacionar o JWT_SECRET perderá o acesso aos tokens cifrados e aos backups novos. ' +
        'Defina ENCRYPTION_KEY no Railway.'
      );
    }
    if (!temChavePropria && !temFallback) {
      alertas.push('🚨 Sem ENCRYPTION_KEY nem JWT_SECRET: os dados sensíveis NÃO estão sendo cifrados.');
    }
    if (emClaroTotal > 0) {
      alertas.push(
        `🚨 ${emClaroTotal} token(s) ainda em TEXTO PURO no banco. Eles são cifrados no boot — ` +
        'reinicie o serviço no Railway (ou aguarde o próximo deploy).'
      );
    }

    res.json({
      protegido: chaveOk && tokensOk,
      chave: {
        configurada: temChavePropria,
        origem: temChavePropria ? 'ENCRYPTION_KEY' : (temFallback ? 'derivada do JWT_SECRET (frágil)' : 'NENHUMA'),
      },
      tokens_oauth: {
        cifrados: cifradosTotal,
        em_claro: emClaroTotal,
        ok: tokensOk,
        detalhe: tokens,
      },
      backup: {
        sera_cifrado: temChavePropria || temFallback,
        observacao: 'Backups antigos (em claro) continuam restaurando — a detecção é pelo conteúdo.',
      },
      alertas,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Erro ao ler o estado de segurança' });
  }
});

export default router;
