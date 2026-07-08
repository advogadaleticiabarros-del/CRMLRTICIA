import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface AuthPayload {
  id: number;
  email: string;
  name: string;
  role: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

/** Gera um JWT para um usuário autenticado. Sessão de 24h (renova em uso). */
export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '24h' });
}

/**
 * Middleware de autenticação. Lê o token do header Authorization: Bearer <token>,
 * valida e popula req.user. Bloqueia com 401 se ausente ou inválido.
 * RENOVAÇÃO DESLIZANTE: se faltar menos de 12h para expirar, devolve um token
 * novo no header X-Renew-Token — quem usa o sistema nunca é deslogado no meio
 * do trabalho; quem para de usar perde a sessão em até 24h.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token de autenticação ausente' });
    return;
  }

  const token = header.slice(7);

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload & { exp?: number };
    req.user = { id: payload.id, email: payload.email, name: payload.name, role: payload.role };

    const restante = (payload.exp || 0) * 1000 - Date.now();
    if (restante > 0 && restante < 12 * 60 * 60 * 1000) {
      res.setHeader('X-Renew-Token', signToken(req.user));
    }
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

/** Restringe o acesso a determinados papéis (ex.: 'admin'). */
export function authorize(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Acesso negado' });
      return;
    }
    next();
  };
}

export const STAFF_ROLES = ['admin', 'advogado', 'estagiario', 'parceiro', 'staff'];

/** Bloqueia o papel 'cliente' das rotas de gestão (ele só acessa /api/portal). */
export function requireStaff(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || !STAFF_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: 'Acesso restrito à equipe do escritório' });
    return;
  }
  next();
}

/** Somente admin. */
export const requireAdmin = authorize('admin');
