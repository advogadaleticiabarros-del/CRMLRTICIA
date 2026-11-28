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
import { ClienteMni, criarClienteMni } from './cliente';
import { criarClientePjeJt } from '../pjeJt/clientePjeJt';
import { chaveTotpValida, normalizarChaveTotp } from '../pjeJt/totp';
import { criarNomesMovimento } from './nomesMovimento';
import { DepsMonitorMni, rodarMonitoramentoMni, testarLogin } from './monitorMni';
import { SISTEMAS_MNI, SistemaMni, sistemaPorId } from './sistemas';
import { ponteEscritorio } from './ponteEscritorio';

/**
 * Cliente do tribunal: MNI direto da VPS, MNI pelo computador do escritório
 * (TJES) ou o robô do site do PJe-JT pelo computador do escritório (TRT17).
 */
const clienteDo = (s: SistemaMni, timeoutMs?: number): ClienteMni =>
  s.pjeJt
    ? criarClientePjeJt({ grau: s.pjeJt, http: (p) => ponteEscritorio.requisitar(p) })
    : criarClienteMni({ url: s.url, timeoutMs, fetch: s.viaEscritorio ? ponteEscritorio.fetch : undefined });

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
      const [rows] = await db.query('SELECT sistema, cpf_enc, senha_enc, totp_enc FROM mni_credenciais WHERE ativo = 1') as any;
      return rows
        .map((r: any) => ({ sistema: r.sistema, cpf: decrypt(r.cpf_enc) || '', senha: decrypt(r.senha_enc) || '', totp: r.totp_enc ? decrypt(r.totp_enc) : null }))
        .filter((c: any) => c.cpf && c.senha);
    },
    cliente: (s) => clienteDo(s),
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
        `SELECT c.id, c.name, c.cpf_cnpj, c.birth_date, c.address, c.rg, c.sexo, c.nome_mae, c.nome_pai, c.naturalidade, c.nacionalidade
           FROM legal_processes lp JOIN clients c ON c.id = lp.client_id WHERE lp.id = ?`,
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
    async guardarDadosDoProcesso(processId, { valorCausa, partes }) {
      const { resumoDasPartes, partesParaGravar } = await import('./fichaPeloTribunal');
      const lista = resumoDasPartes(partes);
      await db.query(
        `UPDATE legal_processes SET valor_causa = COALESCE(?, valor_causa),
           partes_json = COALESCE(?, partes_json), dados_tribunal_em = NOW() WHERE id = ?`,
        [valorCausa, lista.length ? JSON.stringify(lista) : null, processId]
      );
      // O caso ligado só recebe o valor da causa se ainda estiver vazio (nunca sobrescreve o que a equipe digitou).
      if (valorCausa != null) {
        await db.query(
          `UPDATE cases c JOIN legal_processes lp ON lp.case_id = c.id SET c.valor_causa = ?
            WHERE lp.id = ? AND (c.valor_causa IS NULL OR c.valor_causa = 0)`,
          [valorCausa, processId]
        );
      }
      await gravarPartesEVincular(processId, partesParaGravar(partes, await oabsDoEscritorio()));
    },
    async documentosLidosAte(processId) {
      const [[r]] = await db.query('SELECT mni_documentos_ate FROM legal_processes WHERE id = ?', [processId]) as any;
      const v = r?.mni_documentos_ate;
      if (!v) return null;
      // DATETIME do tribunal (horário local, sem fuso) volta como Date: monta o ISO local de novo.
      const d = v instanceof Date ? v : new Date(v);
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    },
    async guardarDocumentos(processId, sistema, docs, lidosAte) {
      let n = 0;
      for (const d of docs) {
        if (!d.idDocumento) continue;
        const [r] = await db.query(
          `INSERT INTO mni_documentos (process_id, sistema, id_documento, id_vinculado_a, id_movimento, data_hora, tipo, tipo_local, descricao, mimetype, assinado_pelo_login, dados_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE descricao = VALUES(descricao), tipo_local = VALUES(tipo_local),
             assinado_pelo_login = VALUES(assinado_pelo_login), dados_json = VALUES(dados_json), lido_em = NOW()`,
          [processId, sistema, d.idDocumento.slice(0, 64), d.idVinculadoA?.slice(0, 64) ?? null, d.idMovimento?.slice(0, 64) ?? null,
            paraDataSql(d.dataHora), d.tipo?.slice(0, 40) ?? null, d.tipoLocal?.slice(0, 120) ?? null, d.descricao, d.mimetype?.slice(0, 80) ?? null,
            d.assinadoPeloLogin ? 1 : 0, JSON.stringify({ assinantes: d.assinantes, parametros: d.parametros })]
        ) as any;
        if (r.affectedRows === 1) n++; // 1 = novo, 2 = já existia
      }
      await db.query('UPDATE legal_processes SET mni_documentos_ate = ? WHERE id = ?', [paraDataSql(lidosAte), processId]);
      return n;
    },
    pausa: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

async function oabsDoEscritorio(): Promise<string[]> {
  const [rows] = await db.query('SELECT oab_number FROM lawyers WHERE oab_number IS NOT NULL') as any;
  return rows.map((r: any) => String(r.oab_number));
}

/**
 * Grava as partes do processo (inclusive as contrárias) e, se o processo ainda
 * não tem cliente, liga à parte que o escritório representa (pela OAB):
 * acha a ficha pelo CPF/CNPJ ou pelo nome idêntico; se não houver, cadastra.
 */
async function gravarPartesEVincular(processId: number, partes: import('./fichaPeloTribunal').ParteParaGravar[]) {
  if (!partes.length) return;
  for (const p of partes) {
    await db.query(
      `INSERT INTO process_parties (process_id, polo, nome, nome_norm, tipo, documento, rg, data_nascimento, endereco, nome_mae, nossa_parte, fonte)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mni')
       ON DUPLICATE KEY UPDATE nome = VALUES(nome), tipo = VALUES(tipo), documento = COALESCE(VALUES(documento), documento),
         rg = COALESCE(VALUES(rg), rg), data_nascimento = COALESCE(VALUES(data_nascimento), data_nascimento),
         endereco = COALESCE(VALUES(endereco), endereco), nome_mae = COALESCE(VALUES(nome_mae), nome_mae), nossa_parte = VALUES(nossa_parte)`,
      [processId, p.polo, p.nome, p.nome_norm, p.tipo, p.documento, p.rg, p.data_nascimento, p.endereco, p.nome_mae, p.nossa_parte ? 1 : 0]
    );
  }
  const nossas = partes.filter((p) => p.nossa_parte);
  const polo = nossas[0] && (nossas[0].polo === 'ativo' || nossas[0].polo === 'passivo') ? nossas[0].polo : null;
  if (polo) {
    await db.query('UPDATE legal_processes SET polo_cliente = ? WHERE id = ?', [polo, processId]);
    await db.query('UPDATE cases c JOIN legal_processes lp ON lp.case_id = c.id SET c.polo_cliente = ? WHERE lp.id = ? AND c.polo_cliente IS NULL', [polo, processId]);
  }
  await copiarContrariasParaOCaso(processId, partes, polo);
  if (!nossas.length) return;

  const { normalizarNomeParte } = await import('./fichaPeloTribunal');
  for (const p of nossas) {
    let clientId: number | null = null;
    const dig = (p.documento || '').replace(/\D/g, '');
    if (dig) {
      const [r] = await db.query("SELECT id FROM clients WHERE REGEXP_REPLACE(COALESCE(cpf_cnpj,''), '[^0-9]', '') = ? ORDER BY id LIMIT 2", [dig]) as any;
      if (r.length === 1) clientId = r[0].id;
    }
    if (!clientId) {
      const [cands] = await db.query('SELECT id, name, cpf_cnpj FROM clients WHERE name LIKE ?', [`%${p.nome.split(' ')[0]}%`]) as any;
      const iguais = cands.filter((c: any) => normalizarNomeParte(c.name) === p.nome_norm);
      // Nome igual mas CPF diferente na ficha = outra pessoa: não liga.
      const compat = iguais.filter((c: any) => !dig || !c.cpf_cnpj || String(c.cpf_cnpj).replace(/\D/g, '') === dig);
      if (compat.length === 1) clientId = compat[0].id;
      else if (compat.length > 1) continue; // ambíguo: deixa para a equipe
    }
    if (!clientId) {
      const [ins] = await db.query(
        `INSERT INTO clients (name, tipo, cpf_cnpj, address, birth_date, rg, nome_mae, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ativo', ?)`,
        [p.nome, p.tipo === 'juridica' ? 'PJ' : 'PF', p.documento, p.endereco, p.data_nascimento, p.rg, p.nome_mae,
          `Cadastrado automaticamente com os dados do tribunal (PJe), em ${new Date().toLocaleDateString('pt-BR')}. Confira telefone e e-mail.`]
      ) as any;
      clientId = ins.insertId;
    }
    await db.query('UPDATE process_parties SET client_id = ? WHERE process_id = ? AND polo = ? AND nome_norm = ?', [clientId, processId, p.polo, p.nome_norm]);
    await db.query('UPDATE legal_processes SET client_id = ? WHERE id = ? AND client_id IS NULL', [clientId, processId]);
  }
}

/**
 * Partes contrárias vindas do tribunal entram no bloco "Partes do processo" do
 * caso (`case_partes`, o mesmo que a equipe preenche e que as peças usam), sem
 * repetir quem já está lá (mesmo CPF/CNPJ ou mesmo nome) e nunca a própria cliente.
 */
async function copiarContrariasParaOCaso(processId: number, partes: import('./fichaPeloTribunal').ParteParaGravar[], poloNosso: string | null) {
  const [[lp]] = await db.query(
    `SELECT lp.case_id, COALESCE(?, c.polo_cliente) AS polo, cl.name AS cliente_nome, cl.cpf_cnpj AS cliente_doc
       FROM legal_processes lp JOIN cases c ON c.id = lp.case_id LEFT JOIN clients cl ON cl.id = c.client_id WHERE lp.id = ?`,
    [poloNosso, processId]
  ) as any;
  if (!lp?.case_id || (lp.polo !== 'ativo' && lp.polo !== 'passivo')) return; // sem saber o nosso lado, não dá para dizer quem é contrário
  const { normalizarNomeParte } = await import('./fichaPeloTribunal');
  const { ehParteDoCliente } = await import('../partesProcesso');
  const [ja] = await db.query('SELECT nome, cpf_cnpj FROM case_partes WHERE case_id = ?', [lp.case_id]) as any;
  const dig = (v: any) => String(v || '').replace(/\D/g, '');
  for (const p of partes) {
    if (p.nossa_parte || p.polo === lp.polo || (p.polo !== 'ativo' && p.polo !== 'passivo')) continue;
    if (ehParteDoCliente({ cpf_cnpj: p.documento, nome: p.nome }, { cpf_cnpj: lp.cliente_doc, name: lp.cliente_nome })) continue;
    const repetida = ja.some((x: any) => (p.documento && dig(x.cpf_cnpj) === dig(p.documento)) || normalizarNomeParte(x.nome) === p.nome_norm);
    if (repetida) continue;
    await db.query(
      "INSERT INTO case_partes (case_id, papel, nome, cpf_cnpj, endereco) VALUES (?, 'contraria', ?, ?, ?)",
      [lp.case_id, p.nome, p.documento, p.endereco]
    );
    ja.push({ nome: p.nome, cpf_cnpj: p.documento });
  }
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
    documentos_lidos: r.sistemas.reduce((a, s) => a + s.documentosLidos, 0),
    falhas: falhas.map((s) => `${s.sistema}: ${s.mensagem || s.status}`).join(' | ') || null,
  };
}

export async function statusDosSistemas() {
  const [rows] = await db.query(
    'SELECT sistema, ativo, ultimo_ok_em, ultimo_erro, ultimo_erro_em, avisos_pendentes, atualizado_em FROM mni_credenciais'
  ) as any;
  const porId = new Map<string, any>(rows.map((r: any) => [r.sistema, r]));
  const ponte = ponteEscritorio.situacao();
  return SISTEMAS_MNI.map((s) => {
    const r = porId.get(s.id);
    return {
      id: s.id, nome: s.nome,
      via_escritorio: !!s.viaEscritorio,
      pelo_site: !!s.pjeJt,
      ponte_conectada: s.viaEscritorio ? ponte.conectada : null,
      ponte_ultimo_contato: s.viaEscritorio ? ponte.ultimoContato : null,
      cadastrado: !!r, ativo: !!r?.ativo,
      ultimo_ok_em: r?.ultimo_ok_em ?? null, ultimo_erro: r?.ultimo_erro ?? null, ultimo_erro_em: r?.ultimo_erro_em ?? null,
      avisos_pendentes: r?.avisos_pendentes ?? 0, atualizado_em: r?.atualizado_em ?? null,
    };
  });
}

/** Testa o login (uma tentativa) e só guarda se o tribunal aceitar. */
export async function salvarCredencial(sistemaId: string, cpf: string, senha: string, userId: number | null, chaveAutenticador?: string) {
  const s = sistemaPorId(sistemaId);
  if (!s) return { ok: false, mensagem: 'Sistema desconhecido.' };
  const cpfDig = String(cpf || '').replace(/\D/g, '');
  if (cpfDig.length !== 11) return { ok: false, mensagem: 'CPF deve ter 11 números.' };
  if (!senha) return { ok: false, mensagem: 'Informe a senha.' };
  let totp: string | null = null;
  if (chaveAutenticador && chaveAutenticador.trim()) {
    if (!s.pjeJt) return { ok: false, mensagem: 'Este sistema não usa chave do autenticador.' };
    if (!chaveTotpValida(chaveAutenticador)) {
      return { ok: false, mensagem: 'A chave do autenticador não parece certa: é o texto longo de letras e números que aparece junto do QR code (não o código de 6 dígitos). Nada foi salvo.' };
    }
    totp = normalizarChaveTotp(chaveAutenticador);
  }
  const t = await testarLogin(clienteDo(s, 60_000), { cpf: cpfDig, senha, totp });
  if (!t.ok) {
    return {
      ok: false,
      mensagem: t.loginRecusado
        ? `O tribunal recusou o login: ${t.mensagem}. Nada foi salvo. Atenção: alguns sistemas bloqueiam a senha depois de erros seguidos.`
        : `Não foi possível falar com o tribunal agora: ${t.mensagem}. Nada foi salvo.`,
    };
  }
  await db.query(
    `INSERT INTO mni_credenciais (sistema, cpf_enc, senha_enc, totp_enc, ativo, ultimo_ok_em, ultimo_erro, avisos_pendentes, atualizado_por)
     VALUES (?, ?, ?, ?, 1, NOW(), NULL, ?, ?)
     ON DUPLICATE KEY UPDATE cpf_enc = VALUES(cpf_enc), senha_enc = VALUES(senha_enc), totp_enc = VALUES(totp_enc), ativo = 1, ultimo_ok_em = NOW(),
       ultimo_erro = NULL, ultimo_erro_em = NULL, avisos_pendentes = VALUES(avisos_pendentes), atualizado_por = VALUES(atualizado_por)`,
    [s.id, encrypt(cpfDig), encrypt(senha), totp ? encrypt(totp) : null, t.avisos ?? 0, userId]
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
