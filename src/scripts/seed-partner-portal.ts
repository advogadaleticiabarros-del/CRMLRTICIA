import bcrypt from 'bcryptjs';
import { db, closeDatabase } from '../config/database';
import { sendCredentials } from '../services/EmailService';
import { suggestCourtAlias, TRIBUNAIS } from '../services/datajud';

/**
 * Backfill: casos já protocolados (com nº de processo) que ainda não estão no
 * monitoramento DataJud entram agora — as movimentações passam a aparecer
 * no CRM e no portal do parceiro. Idempotente.
 */
async function backfillMonitoring() {
  const [cases] = await db.query(
    `SELECT c.id, c.client_id, c.case_number, c.legal_area
       FROM cases c
      WHERE c.case_number IS NOT NULL AND c.case_number <> ''
        AND c.production_stage IN ('protocolado', 'concluido')
        AND NOT EXISTS (SELECT 1 FROM legal_processes lp WHERE lp.process_number = c.case_number)`
  ) as any;
  for (const c of cases) {
    const alias = suggestCourtAlias(c.legal_area, 'ES');
    const court = alias && (TRIBUNAIS as any)[alias] ? (TRIBUNAIS as any)[alias].nome : null;
    await db.query(
      `INSERT INTO legal_processes (client_id, case_id, process_number, court, court_alias, judicial_area, status, source)
       VALUES (?, ?, ?, ?, ?, ?, 'ativo', 'auto_protocolo')`,
      [c.client_id ?? null, c.id, c.case_number, court, alias, c.legal_area ?? null]
    );
  }
  if (cases.length) console.log(`✅ Monitoramento: ${cases.length} processo(s) protocolado(s) adicionados ao DataJud.`);
}

/**
 * Cria o usuário do PORTAL DO PARCEIRO para a INFINITY LAW, vinculado ao
 * parceiro correspondente. Idempotente: se o e-mail já existe, não recria.
 * Roda no deploy (Railway) para valer no banco de produção.
 *
 * Env opcionais: PARTNER_PORTAL_EMAIL, PARTNER_PORTAL_NAME, PARTNER_NAME_LIKE
 */
async function run() {
  const email = process.env.PARTNER_PORTAL_EMAIL ?? 'infinitylaw@outlook.com.br';
  const name = process.env.PARTNER_PORTAL_NAME ?? 'INFINITY LAW (portal)';
  const partnerLike = process.env.PARTNER_NAME_LIKE ?? '%infinity%';

  await backfillMonitoring().catch((e) => console.warn('Backfill de monitoramento falhou:', e.message));

  const [existing] = await db.query('SELECT id, role, partner_id FROM users WHERE email = ?', [email]) as any;

  // Localiza o parceiro (ex.: INFINITY LAW)
  const [partners] = await db.query(
    'SELECT id, name FROM partners WHERE LOWER(name) LIKE LOWER(?) ORDER BY active DESC, id ASC LIMIT 1',
    [partnerLike]
  ) as any;
  if (!partners.length) {
    console.log(`ℹ️  Nenhum parceiro encontrado com nome parecido com "${partnerLike}" — nada a fazer.`);
    await closeDatabase();
    return;
  }
  const partner = partners[0];

  if (existing.length) {
    // Garante o vínculo correto mesmo se o usuário já existir
    if (existing[0].role !== 'parceiro_portal' || existing[0].partner_id !== partner.id) {
      await db.query("UPDATE users SET role = 'parceiro_portal', partner_id = ? WHERE id = ?", [partner.id, existing[0].id]);
      console.log(`✅ Usuário ${email} atualizado: papel parceiro_portal · vinculado a "${partner.name}" (#${partner.id})`);
    } else {
      console.log(`ℹ️  Portal do parceiro já configurado: ${email} → "${partner.name}" (nada a fazer)`);
    }
    await closeDatabase();
    return;
  }

  // Cria o usuário com senha provisória e envia por e-mail
  const tempPass = 'Inf' + Math.random().toString(36).slice(-5) + Math.random().toString(36).slice(-3).toUpperCase() + '@2';
  const hash = await bcrypt.hash(tempPass, 10);
  await db.query(
    "INSERT INTO users (name, email, password, role, partner_id) VALUES (?, ?, ?, 'parceiro_portal', ?)",
    [name, email, hash, partner.id]
  );

  const r = await sendCredentials(email, name, tempPass).catch(() => ({ ok: false }));
  console.log(`✅ Usuário do portal do parceiro criado: ${email} → "${partner.name}" (#${partner.id})`);
  if ((r as any).ok) {
    console.log('   📧 Credenciais enviadas por e-mail ao parceiro.');
  } else {
    console.log(`   ⚠️  E-mail não configurado/falhou — senha provisória: ${tempPass}`);
    console.log('   Troque no primeiro acesso (menu Trocar senha).');
  }

  await closeDatabase();
}

run().catch((err) => {
  console.error('Erro ao criar usuário do portal do parceiro:', err.message);
  process.exit(1);
});
