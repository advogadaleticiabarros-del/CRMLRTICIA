import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { env } from './config/env';
import { authenticate } from './middleware/auth';

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

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Health check (público)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'crm-juridico', timestamp: new Date().toISOString() });
  });

  // Autenticação (login público; /me, register e password tratam auth internamente)
  app.use('/api/auth', authRoutes);

  // ── Rotas protegidas (exigem JWT) ─────────────────────────────────────────
  app.use('/api/clients',               authenticate, clientRoutes);
  app.use('/api/intakes',               authenticate, intakeRoutes);
  app.use('/api/leads',                 authenticate, leadRoutes);
  app.use('/api/dashboards/comercial',  authenticate, comercialDashboard);
  app.use('/api/dashboards/cliente',    authenticate, clienteDashboard);
  app.use('/api/dashboards/processual', authenticate, processualDashboard);
  app.use('/api/dashboards/agenda',     authenticate, agendaDashboard);
  app.use('/api/dashboards/financeiro', authenticate, financeiroDashboard);
  app.use('/api/dashboards/producao',   authenticate, producaoDashboard);
  app.use('/api/calendar',              authenticate, calendarRoutes);
  app.use('/api/notifications',         authenticate, notificationRoutes);

  // ── Frontend (arquivos estáticos) ─────────────────────────────────────────
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));

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
