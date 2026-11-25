import fs from 'fs';
import path from 'path';
import { db } from '../config/database';
import {
  montarNotaCliente, arquivosDoEspelho, situacaoPonte, deveAvisarQueda,
  type CasoNota, type NotaCliente,
} from './obsidianPonte';

/**
 * Ponte do Obsidian com banco (regras em obsidianPonte.ts).
 * Quem chama é o programa do computador do escritório (routes/obsidianPonte.ts).
 */

const inList = (ids: number[]) => ids.map(() => '?').join(',') || 'NULL';

/** Uma nota por cliente com caso encerrado ou com documento guardado (mesmo critério do script antigo). */
export async function indiceClientes(): Promise<NotaCliente[]> {
  const [casos] = await db.query(
    `SELECT c.id, c.client_id, c.case_number, c.title, c.legal_area, c.polo_cliente, c.production_labels, c.description,
            c.valor_causa, c.valor_obtido, c.resultado, c.resultado_em,
            cl.name, cl.cpf_cnpj, cl.address, cl.phone, cl.email, cl.tipo
       FROM cases c JOIN clients cl ON cl.id = c.client_id
      WHERE c.resultado IS NOT NULL
         OR EXISTS (SELECT 1 FROM documents d WHERE d.case_id = c.id AND d.data IS NOT NULL)
      ORDER BY cl.name, c.id`) as any;
  if (!casos.length) return [];
  const ids: number[] = casos.map((c: any) => c.id);

  const [acordos] = await db.query(`SELECT id, case_id, opposing_party, total_agreement_value, honorarium_percentage, honorarium_value, sucumbencia_value, status FROM agreements WHERE case_id IN (${inList(ids)}) ORDER BY id`, ids) as any;
  const acIds: number[] = acordos.map((a: any) => a.id);
  const caseDoAcordo = new Map<number, number>(acordos.map((a: any) => [a.id, a.case_id]));
  const [lanc] = acIds.length ? await db.query(`SELECT agreement_id, description, valor, due_date, status, paid_at FROM financial_records WHERE agreement_id IN (${inList(acIds)}) ORDER BY due_date, id`, acIds) as any : [[]];
  const [rep] = acIds.length ? await db.query(`SELECT agreement_id, tranche_label, valor_bruto, valor_honorarios, valor_liquido, status, data_repasse FROM agreement_client_payouts WHERE agreement_id IN (${inList(acIds)}) ORDER BY id`, acIds) as any : [[]];
  const [partes] = await (db.query(`SELECT case_id, papel, nome, cpf_cnpj, advogado, advogado_oab FROM case_partes WHERE case_id IN (${inList(ids)}) ORDER BY id`, ids) as any).catch(() => [[]]);
  const [docs] = await db.query(`SELECT id, case_id, name, mime FROM documents WHERE case_id IN (${inList(ids)}) AND data IS NOT NULL ORDER BY id`, ids) as any;

  const porCaso = new Map<number, CasoNota>();
  for (const c of casos) porCaso.set(c.id, { ...c, acordos: [], lancamentos: [], repasses: [], partes: [], documentos: [] });
  for (const a of acordos) porCaso.get(a.case_id)?.acordos.push(a);
  for (const l of lanc) porCaso.get(caseDoAcordo.get(l.agreement_id)!)?.lancamentos.push(l);
  for (const r of rep) porCaso.get(caseDoAcordo.get(r.agreement_id)!)?.repasses.push(r);
  for (const p of partes) porCaso.get(p.case_id)?.partes.push(p);
  for (const d of docs) porCaso.get(d.case_id)?.documentos.push(d);

  const porCliente = new Map<number, { cliente: any; casos: CasoNota[] }>();
  for (const c of casos) {
    const g = porCliente.get(c.client_id) || { cliente: { id: c.client_id, name: c.name, cpf_cnpj: c.cpf_cnpj, address: c.address, phone: c.phone, email: c.email, tipo: c.tipo }, casos: [] };
    g.casos.push(porCaso.get(c.id)!);
    porCliente.set(c.client_id, g);
  }
  // Dois clientes com o mesmo nome caem na mesma pasta: o segundo ganha o nº da ficha.
  const usados = new Set<string>();
  const notas: NotaCliente[] = [];
  for (const { cliente, casos: cs } of porCliente.values()) {
    let n = montarNotaCliente(cliente, cs);
    if (usados.has(n.caminho)) n = montarNotaCliente({ ...cliente, name: `${cliente.name} (ficha ${cliente.id})` }, cs);
    usados.add(n.caminho);
    notas.push(n);
  }
  return notas;
}

/** Arquivo de um documento de caso (só os que entram em Clientes/). */
export async function anexo(id: number): Promise<{ mime: string; data: Buffer } | null> {
  const [[d]] = await db.query('SELECT mime, data FROM documents WHERE id = ? AND case_id IS NOT NULL AND data IS NOT NULL', [id]) as any;
  if (!d) return null;
  return { mime: String(d.mime || 'application/octet-stream'), data: Buffer.isBuffer(d.data) ? d.data : Buffer.from(d.data) };
}

/** Manual (docs/manual), ficha do Escritório Virtual e Mapa do cofre, como estão publicados no servidor. */
export async function espelho() {
  const raiz = process.cwd();
  const pastaManual = path.join(raiz, 'docs', 'manual');
  let nomes: string[] = [];
  try { nomes = fs.readdirSync(pastaManual).filter((n) => n.endsWith('.md')).sort(); } catch { /* sem docs no servidor */ }
  const manual = nomes.map((nome) => ({ nome, texto: fs.readFileSync(path.join(pastaManual, nome), 'utf8') }));
  let ficha: string | null = null;
  try { ficha = fs.readFileSync(path.join(raiz, 'docs', 'escritorio-virtual', 'ficha-escritorio-virtual.md'), 'utf8'); } catch { /* sem ficha */ }
  let mapa: string | null = null;
  try {
    const { relatorioOrganizacao } = await import('./cerebroServico');
    const r = await relatorioOrganizacao();
    mapa = r.totalNotas ? r.mapaDoCofre : null;
  } catch { /* Cérebro vazio ou fora do ar */ }
  return arquivosDoEspelho(manual, ficha, mapa);
}

export async function registrarSinal(s: { versao?: string; resumo?: unknown; erro?: string | null }) {
  await db.query(
    `INSERT INTO obsidian_ponte_sinal (id, ultimo_sinal, versao, resumo, erro) VALUES (1, NOW(), ?, ?, ?)
     ON DUPLICATE KEY UPDATE ultimo_sinal = NOW(), versao = VALUES(versao), resumo = VALUES(resumo), erro = VALUES(erro)`,
    [String(s.versao || '').slice(0, 20) || null, JSON.stringify(s.resumo ?? null).slice(0, 4000), s.erro ? String(s.erro).slice(0, 300) : null]);
}

async function linhaSinal() {
  const [[r]] = await db.query('SELECT ultimo_sinal, versao, resumo, erro, avisado_em FROM obsidian_ponte_sinal WHERE id = 1') as any;
  return r || null;
}

/** Para a tela: conectada / parada / nunca ligada, com o último resumo. */
export async function situacao() {
  const r = await linhaSinal();
  const s = situacaoPonte(r?.ultimo_sinal ? new Date(r.ultimo_sinal) : null, new Date());
  let resumo = r?.resumo ?? null;
  if (typeof resumo === 'string') { try { resumo = JSON.parse(resumo); } catch { resumo = null; } }
  return { ...s, ultimoSinal: r?.ultimo_sinal || null, versao: r?.versao || null, erro: r?.erro || null, resumo };
}

/** Rotina obsidian:ponte-vigia: avisa (Dr. Bento, erros do sistema) quando a ponte passa 24 h sem sinal. */
export async function vigiarPonte() {
  const r = await linhaSinal();
  const agora = new Date();
  const ultimo = r?.ultimo_sinal ? new Date(r.ultimo_sinal) : null;
  if (!deveAvisarQueda(ultimo, r?.avisado_em ? new Date(r.avisado_em) : null, agora)) return { avisou: false };
  await db.query('UPDATE obsidian_ponte_sinal SET avisado_em = NOW() WHERE id = 1');
  const { registrarErro } = await import('./errosServico');
  await registrarErro({
    origem: 'servidor', local: 'ponte do Obsidian',
    mensagem: 'A ponte do Obsidian está sem sinal há mais de 24 horas: o cofre e o CRM pararam de se atualizar. Confira se o computador do escritório está ligado e se a tarefa "CRM - ponte do Obsidian" está rodando.',
  });
  return { avisou: true };
}
