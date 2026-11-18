/**
 * Ligação oficial com os tribunais (MNI): o que o resto do CRM usa.
 *  - rodarMonitoramentoMniAgora(): rodada completa (cron);
 *  - statusDosSistemas(): situação de cada sistema, sem expor CPF nem senha;
 *  - salvarCredencial(): testa o login UMA vez e só guarda se o tribunal aceitar;
 *  - removerCredencial();
 *  - avisosPendentes(): intimações ainda não abertas, com a ciência automática.
 * CPF e senha ficam criptografados (utils/crypto) e nunca voltam para a tela.
 */
import { db } from '../../config/database';
import { encrypt, decrypt } from '../../utils/crypto';
import { notificationService } from '../NotificationService';
import { criarClienteMni } from './cliente';
import { criarNomesMovimento } from './nomesMovimento';
import { DepsMonitorMni, rodarMonitoramentoMni, testarLogin } from './monitorMni';
import { SISTEMAS_MNI, sistemaPorId } from './sistemas';

const paraDataSql = (iso: string | null) => (iso ? iso.replace('T', ' ').slice(0, 19) : null);

async function avisarAdmins(titulo: string, mensagem: string): Promise<void> {
  const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin' AND active = 1") as any;
  for (const a of admins) {
    await notificationService.create({
      userId: a.id, title: titulo.slice(0, 200), message: mensagem.slice(0, 1000),
      notificationType: 'mni_tribunal', channel: 'sistema', scheduledAt: new Date(),
    }).catch(() => undefined);
  }
}

function depsDeProducao(): DepsMonitorMni {
  return {
    async credenciaisAtivas() {
      const [rows] = await db.query('SELECT sistema, cpf_enc, senha_enc FROM mni_credenciais WHERE ativo = 1') as any;
      return rows
        .map((r: any) => ({ sistema: r.sistema, cpf: decrypt(r.cpf_enc) || '', senha: decrypt(r.senha_enc) || '' }))
        .filter((c: any) => c.cpf && c.senha);
    },
    cliente: (s) => criarClienteMni({ url: s.url }),
    nomeMovimento: criarNomesMovimento({
      async lerCache(codigo) {
        const [r] = await db.query('SELECT nome FROM tpu_movimentos WHERE codigo = ?', [codigo]) as any;
        return r[0]?.nome ?? null;
      },
      async gravarCache(codigo, nome) {
        await db.query('INSERT IGNORE INTO tpu_movimentos (codigo, nome) VALUES (?, ?)', [codigo, nome.slice(0, 255)]);
      },
    }),
    async processosMonitorados() {
      const [rows] = await db.query(
        `SELECT id, process_number FROM legal_processes
          WHERE status = 'ativo' AND monitoring_enabled = 1 AND process_number IS NOT NULL`
      ) as any;
      return rows;
    },
    async garantirProcesso(numero, orgao) {
      const digitos = numero.replace(/\D/g, '');
      const [ex] = await db.query(
        "SELECT id FROM legal_processes WHERE REGEXP_REPLACE(process_number, '[^0-9]', '') = ? ORDER BY id LIMIT 1", [digitos]
      ) as any;
      if (ex.length) return { id: ex[0].id, criado: false };
      const { aliasFromProcessNumber } = await import('../datajud');
      const { formatarNumeroCnj } = await import('./monitorMni');
      const [[adv]] = await db.query('SELECT id FROM lawyers WHERE active = 1 ORDER BY id LIMIT 1') as any;
      const [ins] = await db.query(
        `INSERT INTO legal_processes (lawyer_id, process_number, court, court_alias, status, source, confidential, last_sync_at)
         VALUES (?, ?, ?, ?, 'ativo', 'mni', 0, NOW())`,
        [adv?.id ?? null, formatarNumeroCnj(digitos), orgao?.slice(0, 120) ?? null, aliasFromProcessNumber(digitos)]
      ) as any;
      return { id: ins.insertId, criado: true };
    },
    async gravarMovimentos(processId, numero, movs, fonte) {
      const { registrarMovimentacoesMni } = await import('../monitoringService');
      return registrarMovimentacoesMni(processId, numero, movs, fonte);
    },
    async registrarAvisos(sistema, avisos) {
      const listaNovos = [];
      for (const a of avisos) {
        const [ins] = await db.query(
          `INSERT INTO mni_avisos (sistema, id_aviso, numero_processo, process_id, tipo_comunicacao, orgao_julgador, disponibilizado_em, ciencia_automatica_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE visto_pela_ultima_vez = NOW(), resolvido_em = NULL,
             process_id = COALESCE(process_id, VALUES(process_id))`,
          [sistema, a.idAviso.slice(0, 64), a.numeroProcesso, a.processId, a.tipoComunicacao?.slice(0, 20) ?? null,
            a.orgaoJulgador?.slice(0, 255) ?? null, paraDataSql(a.disponibilizadoEm), a.cienciaAutomatica]
        ) as any;
        if (ins.affectedRows === 1) listaNovos.push(a); // 1 = inserido, 2 = já existia
      }
      const ids = avisos.map((a) => a.idAviso);
      const [res] = await db.query(
        `UPDATE mni_avisos SET resolvido_em = NOW()
          WHERE sistema = ? AND resolvido_em IS NULL ${ids.length ? 'AND id_aviso NOT IN (?)' : ''}`,
        ids.length ? [sistema, ids] : [sistema]
      ) as any;
      return { novos: listaNovos.length, resolvidos: res.affectedRows || 0, listaNovos };
    },
    async marcarOk(sistema, n) {
      await db.query('UPDATE mni_credenciais SET ultimo_ok_em = NOW(), ultimo_erro = NULL, avisos_pendentes = ? WHERE sistema = ?', [n, sistema]);
    },
    async marcarErro(sistema, mensagem, desligar) {
      await db.query(
        `UPDATE mni_credenciais SET ultimo_erro = ?, ultimo_erro_em = NOW() ${desligar ? ', ativo = 0' : ''} WHERE sistema = ?`,
        [mensagem.slice(0, 500), sistema]
      );
    },
    avisarEquipe: avisarAdmins,
    async completarFicha(processId, partes) {
      const { dadosParaCompletar } = await import('./fichaPeloTribunal');
      const [[c]] = await db.query(
        `SELECT c.id, c.name, c.cpf_cnpj, c.birth_date, c.address FROM legal_processes lp JOIN clients c ON c.id = lp.client_id WHERE lp.id = ?`,
        [processId]
      ) as any;
      if (!c) return 0;
      const patch = dadosParaCompletar(c, partes) as Record<string, string>;
      let n = 0;
      for (const [campo, valor] of Object.entries(patch)) {
        if (campo === 'cpf_cnpj') {
          // Uma pessoa, uma ficha: CPF que já está em outra ficha não é gravado aqui.
          const [dup] = await db.query("SELECT id FROM clients WHERE id <> ? AND REGEXP_REPLACE(cpf_cnpj, '[^0-9]', '') = ? LIMIT 1", [c.id, valor.replace(/\D/g, '')]) as any;
          if (dup.length) continue;
        }
        const vazio = campo === 'birth_date' ? `${campo} IS NULL` : `(${campo} IS NULL OR ${campo} = '')`;
        const [r] = await db.query(`UPDATE clients SET ${campo} = ? WHERE id = ? AND ${vazio}`, [valor, c.id]) as any;
        n += r.affectedRows || 0;
      }
      return n;
    },
    pausa: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

export async function rodarMonitoramentoMniAgora() {
  const r = await rodarMonitoramentoMni(depsDeProducao());
  const falhas = r.sistemas.filter((s) => s.status !== 'ok');
  // Erro de rede/tribunal fora do ar não derruba a rotina; login recusado já avisou a equipe.
  return {
    sistemas: r.sistemas.length,
    avisos_pendentes: r.sistemas.reduce((a, s) => a + s.avisosPendentes, 0),
    avisos_novos: r.sistemas.reduce((a, s) => a + s.avisosNovos, 0),
    movimentacoes_novas: r.sistemas.reduce((a, s) => a + s.movimentacoesNovas, 0),
    campos_de_ficha_completados: r.sistemas.reduce((a, s) => a + s.camposDeFichaCompletados, 0),
    falhas: falhas.map((s) => `${s.sistema}: ${s.mensagem || s.status}`).join(' | ') || null,
  };
}

export async function statusDosSistemas() {
  const [rows] = await db.query(
    'SELECT sistema, ativo, ultimo_ok_em, ultimo_erro, ultimo_erro_em, avisos_pendentes, atualizado_em FROM mni_credenciais'
  ) as any;
  const porId = new Map<string, any>(rows.map((r: any) => [r.sistema, r]));
  return SISTEMAS_MNI.map((s) => {
    const r = porId.get(s.id);
    return {
      id: s.id, nome: s.nome,
      cadastrado: !!r, ativo: !!r?.ativo,
      ultimo_ok_em: r?.ultimo_ok_em ?? null, ultimo_erro: r?.ultimo_erro ?? null, ultimo_erro_em: r?.ultimo_erro_em ?? null,
      avisos_pendentes: r?.avisos_pendentes ?? 0, atualizado_em: r?.atualizado_em ?? null,
    };
  });
}

/** Testa o login (uma tentativa) e só guarda se o tribunal aceitar. */
export async function salvarCredencial(sistemaId: string, cpf: string, senha: string, userId: number | null) {
  const s = sistemaPorId(sistemaId);
  if (!s) return { ok: false, mensagem: 'Sistema desconhecido.' };
  const cpfDig = String(cpf || '').replace(/\D/g, '');
  if (cpfDig.length !== 11) return { ok: false, mensagem: 'CPF deve ter 11 números.' };
  if (!senha) return { ok: false, mensagem: 'Informe a senha.' };
  const t = await testarLogin(criarClienteMni({ url: s.url, timeoutMs: 60_000 }), { cpf: cpfDig, senha });
  if (!t.ok) {
    return {
      ok: false,
      mensagem: t.loginRecusado
        ? `O tribunal recusou o login: ${t.mensagem}. Nada foi salvo. Atenção: alguns sistemas bloqueiam a senha depois de erros seguidos.`
        : `Não foi possível falar com o tribunal agora: ${t.mensagem}. Nada foi salvo.`,
    };
  }
  await db.query(
    `INSERT INTO mni_credenciais (sistema, cpf_enc, senha_enc, ativo, ultimo_ok_em, ultimo_erro, avisos_pendentes, atualizado_por)
     VALUES (?, ?, ?, 1, NOW(), NULL, ?, ?)
     ON DUPLICATE KEY UPDATE cpf_enc = VALUES(cpf_enc), senha_enc = VALUES(senha_enc), ativo = 1, ultimo_ok_em = NOW(),
       ultimo_erro = NULL, ultimo_erro_em = NULL, avisos_pendentes = VALUES(avisos_pendentes), atualizado_por = VALUES(atualizado_por)`,
    [s.id, encrypt(cpfDig), encrypt(senha), t.avisos ?? 0, userId]
  );
  return { ok: true, avisos: t.avisos ?? 0, mensagem: `Login aceito. ${t.avisos ?? 0} intimação(ões) pendente(s) agora.` };
}

export async function removerCredencial(sistemaId: string) {
  await db.query('DELETE FROM mni_credenciais WHERE sistema = ?', [sistemaId]);
}

export async function avisosPendentes() {
  const [rows] = await db.query(
    `SELECT a.id, a.sistema, a.numero_processo, a.process_id, a.tipo_comunicacao, a.orgao_julgador,
            a.disponibilizado_em, a.ciencia_automatica_em, lp.client_id, c.name AS client_name
       FROM mni_avisos a
       LEFT JOIN legal_processes lp ON lp.id = a.process_id
       LEFT JOIN clients c ON c.id = lp.client_id
      WHERE a.resolvido_em IS NULL
      ORDER BY a.ciencia_automatica_em IS NULL, a.ciencia_automatica_em, a.id`
  ) as any;
  const nomes = new Map(SISTEMAS_MNI.map((s) => [s.id, s.nome]));
  return rows.map((r: any) => ({ ...r, sistema_nome: nomes.get(r.sistema) || r.sistema }));
}
