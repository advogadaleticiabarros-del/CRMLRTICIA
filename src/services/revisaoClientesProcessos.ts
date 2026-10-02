/**
 * Conferência de "cliente trocado pela parte contrária" (análise 02/10/2026:
 * 16 clientes eram a empresa ré/INSS). Lista processos cujo cliente parece
 * empresa ou ente público e sugere a parte certa pelas partes das intimações
 * (mesma regra da descoberta: `escolherCliente`). A advogada troca ou confirma.
 */
import { db } from '../config/database';
import { escolherCliente, isCompanyName, isEntePublico } from './djen';

const SUSPEITO = "(cl.name REGEXP 'LTDA|EIRELI|S\\\\.?A\\\\.?$| ME$|INSTITUTO NACIONAL|INSS|MUNIC[IÍ]PIO|ESTADO D[OE]|UNI[AÃ]O FEDERAL|BANCO|FAZENDA')";

export async function listarParaRevisao() {
  const [rows] = await db.query(
    `SELECT lp.id, lp.process_number, lp.client_id, cl.name AS cliente_atual,
            (SELECT pm.movement_metadata FROM process_movements pm
              WHERE pm.process_id = lp.id AND JSON_LENGTH(JSON_EXTRACT(pm.movement_metadata, '$.parties')) > 0
              ORDER BY pm.id DESC LIMIT 1) AS meta
       FROM legal_processes lp JOIN clients cl ON cl.id = lp.client_id
      WHERE COALESCE(lp.cliente_conferido, 0) = 0 AND ${SUSPEITO}
      ORDER BY lp.id`) as any;
  return rows.map((r: any) => {
    let partes: { nome: string; polo: string }[] = [];
    try { const m = typeof r.meta === 'string' ? JSON.parse(r.meta) : r.meta; partes = Array.isArray(m?.parties) ? m.parties : []; } catch { /* sem partes */ }
    const todos = new Map<string, string>(); const polos = new Map<string, string>();
    for (const p of partes) {
      if (!p?.nome) continue;
      const k = String(p.nome).toUpperCase().replace(/\s+/g, ' ').trim();
      todos.set(k, p.nome); if (p.polo) polos.set(k, String(p.polo).toUpperCase());
    }
    const sugestao = escolherCliente(todos, polos);
    const opcoes = partes.filter((p) => p?.nome && !isCompanyName(p.nome) && !isEntePublico(p.nome)).map((p) => p.nome);
    return { id: r.id, process_number: r.process_number, client_id: r.client_id, cliente_atual: r.cliente_atual,
      partes, sugestao: sugestao && sugestao !== r.cliente_atual ? sugestao : null, opcoes: [...new Set(opcoes)] };
  });
}

/** Troca o cliente do processo (e do caso/prazos ligados que estavam com o cliente errado). */
export async function trocarCliente(processId: number, nome: string, userId: number): Promise<{ client_id: number }> {
  const nm = String(nome || '').trim().slice(0, 255);
  if (!nm) throw new Error('Informe o nome do cliente');
  const [[lp]] = await db.query('SELECT client_id, case_id FROM legal_processes WHERE id = ?', [processId]) as any;
  if (!lp) throw new Error('Processo não encontrado');
  const [[existente]] = await db.query('SELECT id FROM clients WHERE LOWER(name) = LOWER(?) LIMIT 1', [nm]) as any;
  let novoId = existente?.id;
  if (!novoId) {
    const [ins] = await db.query(
      "INSERT INTO clients (name, tipo, status, notes, created_by) VALUES (?, ?, 'ativo', 'Cadastrado na conferência de cliente do processo (parte contrária estava como cliente).', ?)",
      [nm, isCompanyName(nm) ? 'PJ' : 'PF', userId]) as any;
    novoId = ins.insertId;
  }
  const antigo = lp.client_id;
  await db.query('UPDATE legal_processes SET client_id = ?, cliente_conferido = 1 WHERE id = ?', [novoId, processId]);
  if (lp.case_id && antigo) await db.query('UPDATE cases SET client_id = ? WHERE id = ? AND client_id = ?', [novoId, lp.case_id, antigo]);
  if (antigo) await db.query('UPDATE detected_deadlines SET client_id = ? WHERE process_id = ? AND client_id = ?', [novoId, processId, antigo]);
  return { client_id: novoId };
}

export async function confirmarCliente(processId: number): Promise<void> {
  await db.query('UPDATE legal_processes SET cliente_conferido = 1 WHERE id = ?', [processId]);
}
