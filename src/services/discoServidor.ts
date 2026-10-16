/**
 * Alarme de disco da VPS (Dr. Bento, guardião). Em 16/10/2026 o disco chegou a
 * 81% por 55 GB de cache de build do Docker do Orbit, que ninguém via crescer.
 * A faxina semanal fica no crontab do root (docker builder prune, domingo 4h);
 * este alarme avisa antes de faltar espaço (backup e banco param sem disco).
 * Regra pura — tests/discoServidor.test.mjs.
 */
import fs from 'fs';

export const LIMITE_ATENCAO = 85;
export const LIMITE_URGENTE = 92;

export interface UsoDisco { usadoPct: number; livresGb: number; totalGb: number }

export function usoDoDisco(caminho = '/'): UsoDisco {
  const s = fs.statfsSync(caminho);
  const total = s.blocks * s.bsize, livre = s.bavail * s.bsize;
  return {
    usadoPct: Math.round(((total - livre) / total) * 100),
    livresGb: Math.round((livre / 1024 ** 3) * 10) / 10,
    totalGb: Math.round(total / 1024 ** 3),
  };
}

/** null = disco tranquilo; senão, o título e o texto do aviso. */
export function avisoDisco(u: UsoDisco): { titulo: string; texto: string } | null {
  if (u.usadoPct < LIMITE_ATENCAO) return null;
  const urgente = u.usadoPct >= LIMITE_URGENTE;
  return {
    titulo: `${urgente ? '🚨' : '⚠️'} Disco do servidor em ${u.usadoPct}%`,
    texto: [
      `${urgente ? '🚨' : '⚠️'} *Disco do servidor do CRM em ${u.usadoPct}%* (${u.livresGb} GB livres de ${u.totalGb} GB).`,
      urgente ? 'Sem espaço, o backup e o banco de dados param. Precisa liberar hoje.' : 'Ainda funciona, mas é bom liberar espaço nos próximos dias.',
      'O que costuma pesar: cache de build do Docker do Orbit (`docker builder prune -f`), arquivos antigos em /tmp e backups locais. Veja o runbook (14-runbook.md, "Disco do servidor cheio").',
    ].join('\n'),
  };
}
