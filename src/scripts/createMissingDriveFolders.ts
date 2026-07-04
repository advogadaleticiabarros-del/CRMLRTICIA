import { db } from '../config/database';
import { createProductionFolder } from '../services/DriveService';

/**
 * Script para criar pastas Drive de todos os casos em produção
 * que estão em "separacao_documentos" e não têm pasta ainda
 *
 * Uso: npm run create:drive-folders
 */

async function createMissingDriveFolders() {
  console.log('\n📁 ========================================');
  console.log('   Criar Pastas Drive Faltantes');
  console.log('   ========================================\n');

  try {
    // Busca TODOS os casos em produção SEM pasta Drive
    console.log('🔍 Buscando casos em produção sem pasta Drive...\n');
    const [cases] = await db.query(
      `SELECT c.id, c.title, c.legal_area, c.description, c.case_number,
              cl.name AS client_name, c.client_id, c.user_id,
              c.production_stage, c.drive_folder_url, c.created_at
       FROM cases c
       LEFT JOIN clients cl ON cl.id = c.client_id
       WHERE c.production_stage IS NOT NULL AND c.drive_folder_url IS NULL
       ORDER BY c.created_at DESC`
    ) as any;

    if (!cases.length) {
      console.log('✅ Nenhum caso faltando pasta Drive.\n');
      return;
    }

    console.log(`📊 Encontrados ${cases.length} caso(s) sem pasta Drive\n`);

    // Cria pasta para cada caso
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const index = i + 1;

      process.stdout.write(`[${index}/${cases.length}] ${c.client_name} - ${c.title.substring(0, 40)}... `);

      try {
        const description = (c.legal_area || c.title || c.description || '').substring(0, 50);

        // Cria pasta (usa user_id do caso para auth)
        const result = await createProductionFolder(
          c.user_id || 1,
          c.client_name || 'Cliente Desconhecido',
          c.legal_area || 'Geral',
          description
        );

        if (result) {
          // Atualiza DB
          await db.query('UPDATE cases SET drive_folder_url = ? WHERE id = ?', [result.folderUrl, c.id]);
          console.log(`✅`);
          successCount++;
        } else {
          console.log(`⚠️  (sem auth)`);
          failCount++;
        }
      } catch (err) {
        console.log(`❌ (erro)`);
        failCount++;
      }
    }

    console.log(`\n✅ Concluído!`);
    console.log(`   ✅ ${successCount} pasta(s) criada(s)`);
    console.log(`   ⚠️  ${failCount} caso(s) com falha\n`);
  } catch (err) {
    console.error('❌ Erro:', err);
  } finally {
    process.exit(0);
  }
}

// Executar
createMissingDriveFolders();
