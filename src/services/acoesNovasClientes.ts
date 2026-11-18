/**
 * Aviso de ação nova envolvendo cliente (pedido da Dra., 17/11/2026).
 *
 * Uma vez por dia, o navegador de quem abre a Central de andamentos procura no
 * DJEN o NOME de cada cliente ativo (o DJEN bloqueia o IP do servidor; a busca
 * por OAB já roda assim, ver `oabDiscover` no front). O resultado vem para cá:
 * fica só a publicação em que um destinatário tem EXATAMENTE o nome do cliente
 * e cujo processo ainda não está no CRM. Pode ser homônimo, por isso a equipe
 * confirma (cadastra o processo ligado ao cliente) ou descarta (não volta).
 */
import { db } from '../config/database';

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Nome comparável: sem acento, maiúsculo, espaços simples, sem pontuação. */
export function normalizarNome(nome: string | null | undefined): string {
  return semAcento(String(nome || '')).toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Só busca nome que identifica alguém: 2+ palavras de verdade, sem "segredo de justiça" nem iniciais. */
export function nomeBuscavel(nome: string | null | undefined): boolean {
  const n = normalizarNome(nome);
  if (!n || /SEGREDO|SIGILO|JUSTICA GRATUITA|DESCONHECID|^E S D J$/.test(n)) return false;
  const palavras = n.split(' ').filter((p) => p.length >= 2 && !['DA', 'DE', 'DO', 'DAS', 'DOS', 'E'].includes(p));
  return palavras.length >= 2 && n.length >= 8;
}

export interface ItemDjen {
  numero_processo?: string; siglaTribunal?: string; nomeOrgao?: string; nomeClasse?: string;
  tipoComunicacao?: string; data_disponibilizacao?: string; texto?: string;
  destinatarios?: Array<{ nome?: string; polo?: string }>;
}

export interface Achado {
  numero_processo: string; tribunal: string | null; orgao: string | null; classe: string | null;
  polo: string | null; tipo_comunicacao: string | null; data_publicacao: string | null; trecho: string | null;
}

/** Publicações do cliente em processos que o CRM ainda não conhece (um achado por processo). */
export function filtrarAchados(nomeCliente: string, itens: ItemDjen[], processosConhecidos: Set<string>): Achado[] {
  const alvo = normalizarNome(nomeCliente);
  if (!alvo) return [];
  const porProcesso = new Map<string, Achado>();
  for (const it of itens || []) {
    const num = String(it.numero_processo || '').replace(/\D/g, '');
    if (num.length !== 20 || processosConhecidos.has(num)) continue;
    const dest = (it.destinatarios || []).find((d) => normalizarNome(d.nome) === alvo);
    if (!dest) continue;
    const data = String(it.data_disponibilizacao || '').slice(0, 10) || null;
    const atual = porProcesso.get(num);
    if (atual && (atual.data_publicacao || '') >= (data || '')) continue; // fica a publicação mais recente
    porProcesso.set(num, {
      numero_processo: num,
      tribunal: it.siglaTribunal?.slice(0, 40) || null,
      orgao: it.nomeOrgao?.slice(0, 255) || null,
      classe: it.nomeClasse?.slice(0, 255) || null,
      polo: (dest.polo || '').slice(0, 10) || null,
      tipo_comunicacao: it.tipoComunicacao?.slice(0, 80) || null,
      data_publicacao: /^\d{4}-\d{2}-\d{2}$/.test(data || '') ? data : null,
      trecho: String(it.texto || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600) || null,
    });
  }
  return [...porProcesso.values()];
}

export function formatarCnj(d: string): string {
  const n = d.replace(/\D/g, '');
  return n.length === 20 ? `${n.slice(0, 7)}-${n.slice(7, 9)}.${n.slice(9, 13)}.${n.slice(13, 14)}.${n.slice(14, 16)}.${n.slice(16, 20)}` : d;
}

// ── banco ───────────────────────────────────────────────────────────────────

/** Clientes com caso ou processo ativo, com nome que dá para buscar. */
export async function clientesParaBuscar() {
  const [rows] = await db.query(
    `SELECT DISTINCT c.id, c.name FROM clients c
      WHERE EXISTS (SELECT 1 FROM cases k WHERE k.client_id = c.id AND k.status = 'ativo')
         OR EXISTS (SELECT 1 FROM legal_processes lp WHERE lp.client_id = c.id AND lp.status = 'ativo')
      ORDER BY c.id`
  ) as any;
  const [[ultima]] = await db.query('SELECT executada_em FROM acoes_novas_buscas ORDER BY id DESC LIMIT 1') as any;
  return {
    ultima_busca: ultima?.executada_em ?? null,
    clientes: rows.filter((r: any) => nomeBuscavel(r.name)).map((r: any) => ({ id: r.id, nome: r.name })),
  };
}

async function processosConhecidos(): Promise<Set<string>> {
  const [lp] = await db.query("SELECT REGEXP_REPLACE(process_number, '[^0-9]', '') AS d FROM legal_processes WHERE process_number IS NOT NULL") as any;
  const [dc] = await db.query("SELECT REGEXP_REPLACE(process_number, '[^0-9]', '') AS d FROM dative_cases WHERE process_number IS NOT NULL").catch(() => [[]]) as any;
  return new Set([...lp, ...dc].map((r: any) => String(r.d || '')).filter(Boolean));
}

/** Recebe o que o navegador achou no DJEN e guarda os achados novos. */
export async function registrarBusca(
  userId: number | null, resultados: Array<{ client_id: number; itens: ItemDjen[] }>, bloqueado: boolean,
  fim: { finalizar: boolean; clientes?: number; achados?: number } = { finalizar: true },
) {
  const conhecidos = await processosConhecidos();
  const ids = [...new Set(resultados.map((r) => Number(r.client_id)).filter((n) => Number.isInteger(n) && n > 0))];
  const nomes = new Map<number, string>();
  if (ids.length) {
    const [rows] = await db.query('SELECT id, name FROM clients WHERE id IN (?)', [ids]) as any;
    for (const r of rows) nomes.set(r.id, r.name);
  }
  let novos = 0;
  for (const r of resultados) {
    const nome = nomes.get(Number(r.client_id));
    if (!nome || !nomeBuscavel(nome)) continue;
    for (const a of filtrarAchados(nome, Array.isArray(r.itens) ? r.itens.slice(0, 200) : [], conhecidos)) {
      const [ins] = await db.query(
        `INSERT IGNORE INTO acoes_novas_clientes
           (client_id, numero_processo, tribunal, orgao, classe, polo, tipo_comunicacao, data_publicacao, trecho)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.client_id, a.numero_processo, a.tribunal, a.orgao, a.classe, a.polo, a.tipo_comunicacao, a.data_publicacao, a.trecho]
      ) as any;
      if (ins.affectedRows === 1) novos++;
    }
  }
  // O navegador manda em lotes; a varredura só conta como feita no último lote.
  if (fim.finalizar) {
    await db.query(
      'INSERT INTO acoes_novas_buscas (executada_por, clientes, achados, bloqueado) VALUES (?, ?, ?, ?)',
      [userId, fim.clientes ?? resultados.length, (fim.achados ?? 0) + novos, bloqueado ? 1 : 0]
    );
  }
  if (novos > 0) {
    const { notificationService } = await import('./NotificationService');
    const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
    for (const ad of admins) {
      await notificationService.create({
        userId: ad.id, title: 'Possível ação nova envolvendo cliente',
        message: `${novos} processo(s) com o nome de cliente que ainda não está(ão) no CRM. Confira em Andamentos nos tribunais → Ações novas de clientes.`,
        notificationType: 'acao_nova_cliente', channel: 'sistema', scheduledAt: new Date(),
      }).catch(() => undefined);
    }
  }
  return { novos };
}

export async function listarAcoesNovas() {
  const [rows] = await db.query(
    `SELECT a.*, c.name AS client_name FROM acoes_novas_clientes a JOIN clients c ON c.id = a.client_id
      WHERE a.status = 'pendente' ORDER BY a.data_publicacao DESC, a.id DESC LIMIT 200`
  ) as any;
  return rows.map((r: any) => ({ ...r, numero_formatado: formatarCnj(r.numero_processo) }));
}

/** É o cliente: cadastra o processo ligado a ele (com monitoramento). */
export async function confirmarAcaoNova(id: number, userId: number) {
  const [[a]] = await db.query("SELECT * FROM acoes_novas_clientes WHERE id = ? AND status = 'pendente'", [id]) as any;
  if (!a) return { ok: false, mensagem: 'Item não encontrado ou já resolvido.' };
  const [ex] = await db.query(
    "SELECT id FROM legal_processes WHERE REGEXP_REPLACE(process_number, '[^0-9]', '') = ? LIMIT 1", [a.numero_processo]
  ) as any;
  let processId = ex[0]?.id ?? null;
  if (!processId) {
    const { aliasFromProcessNumber } = await import('./datajud');
    const [[adv]] = await db.query('SELECT id FROM lawyers WHERE active = 1 ORDER BY id LIMIT 1') as any;
    const [ins] = await db.query(
      `INSERT INTO legal_processes (lawyer_id, client_id, process_number, court, court_alias, status, source, confidential, monitoring_enabled)
       VALUES (?, ?, ?, ?, ?, 'ativo', 'acao_nova', 0, 1)`,
      [adv?.id ?? null, a.client_id, formatarCnj(a.numero_processo), (a.orgao || a.tribunal || '').slice(0, 120) || null, aliasFromProcessNumber(a.numero_processo)]
    ) as any;
    processId = ins.insertId;
  }
  await db.query(
    "UPDATE acoes_novas_clientes SET status = 'confirmada', process_id = ?, resolvido_por = ?, resolvido_em = NOW() WHERE id = ?",
    [processId, userId, id]
  );
  return { ok: true, process_id: processId };
}

export async function descartarAcaoNova(id: number, userId: number) {
  const [r] = await db.query(
    "UPDATE acoes_novas_clientes SET status = 'descartada', resolvido_por = ?, resolvido_em = NOW() WHERE id = ? AND status = 'pendente'",
    [userId, id]
  ) as any;
  return { ok: (r.affectedRows || 0) > 0 };
}
