import { db } from '../config/database';

async function check() {
  console.log('\n🔍 Verificando parcelas de Vinicius...\n');

  // Busca cliente
  const [clients] = await db.query(
    "SELECT id, name FROM clients WHERE LOWER(name) LIKE LOWER('%vinicius%') LIMIT 5"
  ) as any;

  if (!clients.length) {
    console.log('❌ Nenhum cliente chamado Vinicius encontrado\n');
    process.exit(0);
  }

  for (const client of clients) {
    console.log(`\n👤 ${client.name} (ID: ${client.id})`);

    const [insts] = await db.query(
      `SELECT id, numero, valor, due_date, status FROM installments
       WHERE client_id = ? ORDER BY numero ASC`,
      [client.id]
    ) as any;

    if (!insts.length) {
      console.log('  ❌ Nenhuma parcela registrada');
    } else {
      console.log(`  📋 ${insts.length} parcela(s):`);
      for (const i of insts) {
        const icon = i.status === 'pago' ? '✅' : i.status === 'pendente' ? '⏳' : '⚠️';
        console.log(`     ${icon} #${i.numero}: R$ ${Number(i.valor).toFixed(2)} (${i.status}) — venc. ${i.due_date}`);
      }
    }
  }

  console.log();
  process.exit(0);
}

check().catch(console.error);
