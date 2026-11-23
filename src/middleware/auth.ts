import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { sessoes } from '../services/sessaoUsuario';
import { precisaAceitar, rotaLiberadaSemAceite } from '../services/termos';

export interface AuthPayload {
  id: number;
  email: string;
  name: string;
  role: string;
  /** Versão da sessão (users.token_version). Token antigo sem ela = 0. */
  tv?: number;
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
  const { id, email, name, role, tv } = payload;
  return jwt.sign({ id, email, name, role, tv: tv ?? 0 }, env.JWT_SECRET, { expiresIn: '24h' });
}

/** Token para quem acabou de entrar: já leva a versão atual da sessão. */
export async function emitirToken(payload: AuthPayload): Promise<string> {
  sessoes.esquecer(payload.id);
  const e = await sessoes.estado(payload.id);
  return signToken({ ...payload, tv: e?.versao ?? 0 });
}

const MSG_SESSAO: Record<string, string> = {
  inexistente: 'Sessão inválida. Entre novamente.',
  inativo: 'Seu acesso foi desativado. Fale com o escritório.',
  encerrada: 'Sua sessão foi encerrada (senha trocada ou acesso alterado). Entre novamente.',
};

/**
 * Middleware de autenticação. Lê o token do header Authorization: Bearer <token>,
 * valida e popula req.user. Bloqueia com 401 se ausente ou inválido.
 * Desde 23/11/2026 também confere no servidor (sessaoUsuario.ts) se o usuário
 * continua ativo e se a sessão não foi encerrada, e se já aceitou os Termos
 * de Uso e a Política de Privacidade vigentes (403 TERMOS_PENDENTES).
 * RENOVAÇÃO DESLIZANTE: se faltar menos de 12h para expirar, devolve um token
 * novo no header X-Renew-Token — quem usa o sistema nunca é deslogado no meio
 * do trabalho; quem para de usar perde a sessão em até 24h.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token de autenticação ausente' });
    return;
  }

  const token = header.slice(7);
  let payload: AuthPayload & { exp?: number; purpose?: string };
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as AuthPayload & { exp?: number; purpose?: string };
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
    return;
  }
  // Passes temporários (2FA, passkey, OAuth) usam o mesmo segredo: nunca valem como login.
  if (payload.purpose || !payload.id || !payload.role) {
    res.status(401).json({ error: 'Token inválido ou expirado' });
    return;
  }

  let sessao;
  try {
    sessao = await sessoes.verificar(payload.id, payload.tv);
  } catch {
    res.status(503).json({ error: 'Sistema indisponível no momento. Tente de novo em instantes.' });
    return;
  }
  if (!sessao.ok) {
    res.status(401).json({ error: MSG_SESSAO[sessao.motivo], code: 'SESSAO_ENCERRADA' });
    return;
  }

  req.user = { id: payload.id, email: payload.email, name: payload.name, role: payload.role, tv: sessao.estado.versao };

  const restante = (payload.exp || 0) * 1000 - Date.now();
  if (restante > 0 && restante < 12 * 60 * 60 * 1000) {
    res.setHeader('X-Renew-Token', signToken(req.user));
  }

  if (precisaAceitar(sessao.estado.termosVersao) && !rotaLiberadaSemAceite(req.originalUrl)) {
    res.status(403).json({ error: 'Para continuar, leia e aceite os Termos de Uso e a Política de Privacidade.', code: 'TERMOS_PENDENTES' });
    return;
  }
  next();
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

export const STAFF_ROLES = ['admin', 'advogado', 'estagiario', 'parceiro', 'staff', 'comercial'];

/** Bloqueia o papel 'cliente' das rotas de gestão (ele só acessa /api/portal). */
export function requireStaff(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || !STAFF_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: 'Acesso restrito à equipe do escritório' });
    return;
  }
  next();
}

/** WhatsApp: equipe interna. Parceiro externo não vê conversas de clientes (LGPD). */
export const WHATSAPP_ROLES = ['admin', 'advogado', 'estagiario', 'staff', 'comercial'];
export const requireWhatsappAccess = authorize(...WHATSAPP_ROLES);

/** Somente admin. */
export const requireAdmin = authorize('admin');
