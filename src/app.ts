import express, { Request, Response, NextFunction } from 'express';
import 'express-async-errors'; // captura erros de rotas async e envia ao error handler
import cors from 'cors';
import compression from 'compression';
import path from 'path';
import { env } from './config/env';
import { authenticate, requireStaff, requireAdmin } from './middleware/auth';

// Rotas já existentes
import comercialDashboard from './routes/dashboards/comercial';
import clienteDashboard from './routes/dashboards/cliente';
import processualDashboard from './routes/dashboards/processual';
import agendaDashboard from './routes/dashboards/agenda';
import financeiroDashboard from './routes/dashboards/financeiro';
import producaoDashboard from './routes/dashboards/producao';
import calendarRoutes from './routes/calendar';
import notificationRoutes from './routes/notifications';
import authRoutes from './routes/auth';
import clientRoutes from './routes/clients';
import intakeRoutes from './routes/intakes';
import leadRoutes from './routes/leads';
import propostaRoutes from './routes/propostas';
import caseRoutes from './routes/cases';
import deadlineRoutes from './routes/deadlines';
import taskRoutes from './routes/tasks';
import financialRoutes from './routes/financial';
import receitaRoutes from './routes/receitas';
import parcelaRoutes from './routes/parcelas';
import acordoRoutes from './routes/acordos';
import repasseRoutes from './routes/repasses';
import inadimplenciaRoutes from './routes/inadimplencias';
import auditoriaFinanceiraRoutes from './routes/auditoria-financeira';
import cashflowRoutes from './routes/cashflow';
import userRoutes from './routes/users';
import portalRoutes from './routes/portal';
import meRoutes from './routes/me';
import dativeRoutes from './routes/dative';
import contractRoutes from './routes/contracts';
import lawyerRoutes from './routes/lawyers';
import processRoutes from './routes/processes';
import detectedDeadlineRoutes from './routes/detected-deadlines';
import journeyRoutes from './routes/journey';
import controladoriaRoutes from './routes/controladoria';
import correspondenteRoutes from './routes/correspondente';
import documentRoutes from './routes/documents';
import aiRoutes from './routes/ai';
import signPublicRoutes from './routes/sign-public';
import propostaPublicRoutes from './routes/propostas-public';
import backupRoutes from './routes/backup';
import { googleOAuthCallback } from './routes/google-callback';

export function createApp() {
  const app = express();
  app.set('trust proxy', true); // Railway atrás de proxy — captura IP real do signatário

  app.use(compression()); // gzip nas respostas (HTML/JS/CSS/JSON) — reduz transferência
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '20mb' })); // ingestão DJEN pode trazer muitas publicações
  app.use(express.urlencoded({ extended: true }));

  // Health check (público)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'crm-juridico', timestamp: new Date().toISOString() });
  });

  // Autenticação (login público; /me, register e password tratam auth internamente)
  app.use('/api/auth', authRoutes);

  // Callback OAuth do Google — PÚBLICO (Google redireciona sem JWT; usa state)
  app.get('/api/calendar/google/callback', googleOAuthCallback);

  // TEMPORÁRIO — semeia os modelos padrão em Documentos e modelos (remover depois)
  app.get('/api/_seed-templates', async (_req, res) => {
    try {
      const { db } = await import('./config/database');
      const t = await import('./services/contractTemplates');
      const { getEscritorio } = await import('./services/escritorio');
      const adv = await getEscritorio();
      const partyTok: any = {
        name: '{{cliente_nome}}', nacionalidade: 'brasileiro(a)', profissao: '{{cliente_profissao}}',
        estadoCivil: '{{cliente_estado_civil}}', cpf: '{{cliente_cpf}}', rg: '{{cliente_rg}}', endereco: '{{cliente_endereco}}',
      };
      const menorTok: any = { nome: '[NOME DO MENOR]', nascimento: null, cpf: '[CPF DO MENOR]' };
      const dataVar = (s: string) => s.split('[DATA]').join('{{data_extenso}}');
      const modelos = [
        ['Contrato de Prestação de Serviços Advocatícios', 'contratos', dataVar(t.buildTemplate({ party: partyTok, area: 'outro', contratada: adv }))],
        ['Contrato de Honorários — Representação de Menor', 'contratos', dataVar(t.buildTemplateMenor({ party: partyTok, menor: menorTok, contratada: adv }))],
        ['Procuração Ad Judicia et Extra', 'procuracoes', dataVar(t.buildProcuracao(partyTok, adv))],
        ['Procuração — Representação de Menor', 'procuracoes', dataVar(t.buildProcuracaoMenor(partyTok, menorTok, adv))],
        ['Declaração de Hipossuficiência', 'declaracoes', dataVar(t.buildDeclaracao(partyTok))],
        ['Declaração de Hipossuficiência — Menor', 'declaracoes', dataVar(t.buildDeclaracaoMenor(partyTok, menorTok))],
      ];
      let criados = 0;
      for (const [name, cat, content] of modelos) {
        const [ex] = await db.query('SELECT id FROM document_templates WHERE name = ? LIMIT 1', [name]) as any;
        if (ex.length) { await db.query('UPDATE document_templates SET content = ?, category = ? WHERE id = ?', [content, cat, ex[0].id]); }
        else { await db.query('INSERT INTO document_templates (name, category, content) VALUES (?, ?, ?)', [name, cat, content]); criados++; }
      }
      res.json({ ok: true, modelos: modelos.length, novos: criados });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Assinatura eletrônica — PÚBLICO (signatário acessa por link, sem login)
  app.use('/api/public', signPublicRoutes);
  app.use('/api/public', propostaPublicRoutes); // proposta pública (link p/ cliente)

  // ── Portal do Cliente (papel 'cliente' — escopo isolado por client_id) ────
  app.use('/api/portal',                authenticate, portalRoutes);

  // ── Administração de usuários (somente admin) ─────────────────────────────
  app.use('/api/users',                 authenticate, requireAdmin, userRoutes);

  // ── Rotas de gestão (equipe do escritório — bloqueadas para 'cliente') ────
  app.use('/api/me',                    authenticate, requireStaff, meRoutes);
  app.use('/api/clients',               authenticate, requireStaff, clientRoutes);
  app.use('/api/intakes',               authenticate, requireStaff, intakeRoutes);
  app.use('/api/leads',                 authenticate, requireStaff, leadRoutes);
  app.use('/api/propostas',             authenticate, requireStaff, propostaRoutes);
  app.use('/api/cases',                 authenticate, requireStaff, caseRoutes);
  app.use('/api/deadlines',             authenticate, requireStaff, deadlineRoutes);
  app.use('/api/tasks',                 authenticate, requireStaff, taskRoutes);
  app.use('/api/financial',             authenticate, requireStaff, financialRoutes);
  app.use('/api/receitas',              authenticate, requireStaff, receitaRoutes);
  app.use('/api/parcelas',              authenticate, requireStaff, parcelaRoutes);
  app.use('/api/acordos',               authenticate, requireStaff, acordoRoutes);
  app.use('/api/repasses',              authenticate, requireStaff, repasseRoutes);
  app.use('/api/inadimplencias',        authenticate, requireStaff, inadimplenciaRoutes);
  app.use('/api/cashflow',              authenticate, requireStaff, cashflowRoutes);
  app.use('/api/auditoria-financeira',  authenticate, requireStaff, auditoriaFinanceiraRoutes);
  app.use('/api/dative',                authenticate, requireStaff, dativeRoutes);
  app.use('/api/contracts',             authenticate, requireStaff, contractRoutes);
  app.use('/api/lawyers',               authenticate, requireAdmin, lawyerRoutes);
  app.use('/api/backup',                authenticate, requireAdmin, backupRoutes);
  app.use('/api/processes',             authenticate, requireStaff, processRoutes);
  app.use('/api/prazos-detectados',     authenticate, requireStaff, detectedDeadlineRoutes);
  app.use('/api/journey',               authenticate, requireStaff, journeyRoutes);
  app.use('/api/controladoria',         authenticate, requireStaff, controladoriaRoutes);
  app.use('/api/correspondente',        authenticate, requireStaff, correspondenteRoutes);
  app.use('/api/documents',             authenticate, requireStaff, documentRoutes);
  app.use('/api/ai',                    authenticate, requireStaff, aiRoutes);
  app.use('/api/dashboards/comercial',  authenticate, requireStaff, comercialDashboard);
  app.use('/api/dashboards/cliente',    authenticate, requireStaff, clienteDashboard);
  app.use('/api/dashboards/processual', authenticate, requireStaff, processualDashboard);
  app.use('/api/dashboards/agenda',     authenticate, requireStaff, agendaDashboard);
  app.use('/api/dashboards/financeiro', authenticate, requireStaff, financeiroDashboard);
  app.use('/api/dashboards/producao',   authenticate, requireStaff, producaoDashboard);
  app.use('/api/calendar',              authenticate, requireStaff, calendarRoutes);
  app.use('/api/notifications',         authenticate, notificationRoutes);

  // ── Frontend (arquivos estáticos) ─────────────────────────────────────────
  const publicDir = path.join(__dirname, '..', 'public');
  // Assets com revalidação (ETag): o browser reusa app.js/styles.css se não mudaram (304),
  // evitando rebaixar ~175KB a cada carregamento.
  app.use(express.static(publicDir, { etag: true, lastModified: true, maxAge: '5m' }));

  // 404 apenas para rotas /api desconhecidas
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Rota não encontrada' });
  });

  // SPA fallback: qualquer outra rota devolve o index.html
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // Error handler global
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Erro não tratado:', err.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  });

  return app;
}
