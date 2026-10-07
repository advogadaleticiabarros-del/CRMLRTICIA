/**
 * Rotina do backup (07/10/2026) — "o backup não pode falhar nenhum dia".
 *
 *  - fazerBackup: roda o backup e, se falhar ou travar, tenta de novo sozinho;
 *  - vigiarBackupsPerdidos: 45 min depois de cada horário (02h, 09h, 19h)
 *    confere se a cópia daquele horário existe; se não, avisa e refaz na hora;
 *  - enviarRelatorioDiario: todo dia às 20h30 manda o aviso "backup realizado"
 *    (WhatsApp + sino). Se algo deu errado no dia, o aviso vem com ⚠️.
 *
 * As decisões (o que é "perdido", o texto do aviso) são regras puras em
 * backupRegras.ts; aqui só busca dados, executa e avisa.
 */
import { db } from '../config/database';
import { runBackup, resumoMega } from './backupService';
import { slotsPerdidos, textoRelatorioDiario, HORARIOS_BACKUP, dataDoArquivo, type BackupDoDia } from './backupRegras';

const JOBS_BACKUP = ['backup:diario', 'backup:recuperacao'];
const BRT_MS = 3 * 3600_000;
const horaBrt = (d: Date) => new Date(d.getTime() - BRT_MS).getUTCHours();
const diaBrt = (d: Date) => new Date(d.getTime() - BRT_MS).toISOString().slice(0, 10);
const fmtDia = (iso: string) => iso.split('-').reverse().join('/');
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Horário programado ao qual uma execução pertence (o último horário ≤ hora da execução). */
const slotDe = (d: Date) => [...HORARIOS_BACKUP].reverse().find((h) => h <= horaBrt(d)) ?? HORARIOS_BACKUP[HORARIOS_BACKUP.length - 1];

/**
 * Faz o backup; se der erro, travar ou não salvar em NENHUM destino, espera
 * 3 min e tenta mais uma vez. Lança erro só se as duas tentativas falharem
 * (aí o runJob dispara o alerta crítico). O resumo cabe nos 300 caracteres
 * que o job_runs guarda — é dele que o aviso diário lê o dia.
 */
export async function fazerBackup(): Promise<Record<string, unknown>> {
  let ultimoErro = '';
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const { mega, local, verificacao } = await runBackup();
      if (mega.ok || local.ok) {
        return {
          h: slotDe(new Date()), m: mega.ok ? 1 : 0, l: local.ok ? 1 : 0, v: verificacao.ok ? 1 : 0,
          mb: Math.round((mega.sizeKB || local.sizeKB || 0) / 1024), tabelas: verificacao.tabelas, t: tentativa,
          ...(mega.ok ? {} : { erroMega: String(mega.message).slice(0, 80) }),
          ...(local.ok ? {} : { erroLocal: String(local.message).slice(0, 80) }),
        };
      }
      ultimoErro = `MEGA: ${mega.message} · Local: ${local.message}`;
    } catch (e: any) {
      ultimoErro = e?.message || String(e);
    }
    if (tentativa === 1) { console.warn(`⚠️ [backup] 1ª tentativa falhou (${ultimoErro}) — nova tentativa em 3 min`); await espera(3 * 60_000); }
  }
  throw new Error(`Backup NÃO realizado após 2 tentativas — ${ultimoErro}`);
}

/** Aviso no sino de todos os admins + WhatsApp pessoal (mesmo destino do fechamento do dia). */
export async function avisarBackup(titulo: string, texto: string): Promise<{ whatsapp: boolean }> {
  const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
  for (const a of admins) {
    await db.query(
      `INSERT INTO notifications (user_id, title, message, notification_type, channel, scheduled_at, status)
       VALUES (?, ?, ?, 'backup', 'sistema', NOW(), 'pendente')`, [a.id, titulo, texto.replace(/\*/g, '')]);
  }
  let whatsapp = false;
  try {
    const { destinoWhatsappPessoal } = await import('./destinoWhatsappPessoal');
    const { sendText } = await import('./uazapiInstance');
    whatsapp = await sendText(await destinoWhatsappPessoal(), texto, 'Automático — backup');
  } catch { /* o sino já foi avisado */ }
  return { whatsapp };
}

async function execucoesOkDeHoje(agora: Date) {
  const [rows] = await db.query(
    `SELECT job, message, ran_at FROM job_runs
      WHERE job IN (?) AND status = 'ok' AND ran_at >= ? ORDER BY ran_at`,
    [JOBS_BACKUP, new Date(Date.parse(diaBrt(agora) + 'T00:00:00Z') + BRT_MS)]) as any;
  // ran_at é gravado em UTC pelo MySQL da VPS
  return rows.map((r: any) => ({ ...r, quando: new Date(String(r.ran_at instanceof Date ? r.ran_at.toISOString() : r.ran_at + 'Z')) }));
}

/** 45 min depois de cada horário: se a cópia daquele horário não existe, avisa e refaz agora. */
export async function vigiarBackupsPerdidos(agora = new Date()) {
  const oks = await execucoesOkDeHoje(agora);
  const perdidos = slotsPerdidos(agora, oks.map((o: any) => o.quando), 40);
  if (!perdidos.length) return { perdidos: [] };
  const hs = perdidos.map((h) => `${String(h).padStart(2, '0')}h`).join(', ');
  let resultado = '';
  try { const r = await fazerBackup(); resultado = `✅ Nova cópia feita agora e conferida (${r.mb} MB${r.m ? ', MEGA ok' : ', SEM MEGA'}${r.l ? ', servidor ok' : ', SEM servidor'}).`; }
  catch (e: any) { resultado = `🚨 A nova tentativa TAMBÉM falhou: ${e?.message}. Precisa de atenção imediata.`; }
  await avisarBackup(`Backup das ${hs} não tinha sido feito`, `⚠️ *Backup do CRM*: a cópia das ${hs} de hoje não foi concluída no horário.\n${resultado}`);
  if (resultado.startsWith('🚨')) throw new Error(`Backup das ${hs} perdido e recuperação falhou`);
  return { perdidos, recuperado: true };
}

/** Aviso diário "backup realizado" — 20h30, depois do backup das 19h e da vigia das 19h45. */
export async function enviarRelatorioDiario(agora = new Date()) {
  await vigiarBackupsPerdidos(agora).catch(() => { /* a vigia já avisou */ });
  const oks = await execucoesOkDeHoje(agora);
  const porSlot = new Map<number, BackupDoDia>();
  for (const o of oks) {
    let j: any = {}; try { j = JSON.parse(o.message || '{}'); } catch { /* formato antigo */ }
    const hora = typeof j.h === 'number' ? j.h : slotDe(o.quando);
    const feito: BackupDoDia = j.h != null
      ? { hora, mega: !!j.m, local: !!j.l, verificado: !!j.v, mb: Number(j.mb) || 0 }
      : { hora, mega: !!j.mega?.arquivo, local: !!j.local?.arquivo, verificado: true, mb: Math.round((j.mega?.kb || j.local?.kb || 0) / 1024) };
    const ant = porSlot.get(hora);
    // se o horário teve mais de uma execução, vale a mais completa
    if (!ant || (+feito.mega + +feito.local + +feito.verificado) >= (+ant.mega + +ant.local + +ant.verificado)) porSlot.set(hora, feito);
  }
  const mega = await resumoMega().catch(() => ({ copias: 0, maisAntiga: null as string | null, usoPct: null as number | null }));
  const antiga = mega.maisAntiga ? dataDoArquivo(mega.maisAntiga) : null;
  const [[prova]] = await db.query(
    "SELECT message, ran_at FROM job_runs WHERE job = 'backup:prova-de-restauracao' ORDER BY id DESC LIMIT 1") as any;
  let provaOk = false; try { provaOk = !!JSON.parse(prova?.message || '{}').ok; } catch { /* ignore */ }

  const texto = textoRelatorioDiario({
    dia: fmtDia(diaBrt(agora)),
    // só os horários que já passaram (+40 min de tolerância): às 20h30 são os três
    esperados: HORARIOS_BACKUP.filter((h) => agora.getTime() >= Date.parse(`${diaBrt(agora)}T${String(h).padStart(2, '0')}:40:00Z`) + BRT_MS),
    feitos: [...porSlot.values()].sort((a, b) => a.hora - b.hora),
    copiasMega: mega.copias,
    maisAntigaMega: antiga ? fmtDia(diaBrt(antiga)) : null,
    megaUsoPct: mega.usoPct,
    ultimaProva: prova ? { data: fmtDia(diaBrt(new Date(prova.ran_at))), ok: provaOk } : null,
  });
  const tudoOk = texto.startsWith('✅');
  const { whatsapp } = await avisarBackup(tudoOk ? 'Backup do dia realizado' : 'Backup do dia com problema', texto);
  if (!tudoOk) throw new Error('Aviso diário do backup encontrou problema: ' + texto.split('*Atenção:*')[1]?.trim().slice(0, 200));
  return { enviado: true, whatsapp };
}
