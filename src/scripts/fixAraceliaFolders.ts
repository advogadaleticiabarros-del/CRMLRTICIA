import { db } from '../config/database';
import { createProductionFolder } from '../services/DriveService';

/**
 * Script manual para reorganizar pastas de Aracelia Gomes no Google Drive
 * Separa casos por banco/partes contrárias
 *
 * Uso: npm run fix:aracelia
 */

interface CaseRecord {
  id: number;
  title: string;
  case_number: string | null;
  legal_area: string;
  description: string | null;
  drive_folder_url: string | null;
  created_at: string;
}

interface ExtractedInfo {
  processType: string;
  bank: string;
  folderName: string;
}

/**
 * Extrai banco e tipo de processo do título/descrição
 */
function extractBankAndType(title: string, description: string, legal_area: string): ExtractedInfo {
  const combined = `${title} ${description || ''}`.toUpperCase();

  // Lista de bancos conhecidos
  const banks: { [key: string]: string } = {
    BRADESCO: 'Bradesco',
    AGIBANKK: 'Agibankk',
    'ATIVA BANCO': 'Ativa Banco',
    ITAU: 'Itaú',
    SANTANDER: 'Santander',
    'BANCO DO BRASIL': 'Banco do Brasil',
    CEF: 'CEF',
    CAIXA: 'Caixa',
    AGIBANCO: 'Agibankk',
  };

  let bank = 'Banco Desconhecido';
  for (const [key, display] of Object.entries(banks)) {
    if (combined.includes(key)) {
      bank = display;
      break;
    }
  }

  // Tipo de processo (legal_area)
  const processType = legal_area.charAt(0).toUpperCase() + legal_area.slice(1).toLowerCase();

  const folderName = `Aracelia Gomes - ${processType} - ${bank}`;
  return { processType, bank, folderName };
}

/**
 * Função principal: reorganiza pastas de Aracelia
 */
async function reorganizeAraceliaFolders() {
  console.log('\n📋 ========================================');
  console.log('   Fix Aracelia — Reorganizar Pastas');
  console.log('   ========================================\n');

  try {
    // 1. Busca o ID de Aracelia (por nome)
    const [clientRows] = await db.query(
      "SELECT id FROM clients WHERE LOWER(name) LIKE LOWER('%aracelia%') LIMIT 1"
    ) as any;

    if (!clientRows.length) {
      console.error('❌ Cliente "Aracelia" não encontrado no banco de dados.');
      return;
    }

    const araceliaId = clientRows[0].id;
    console.log(`✓ Cliente Aracelia encontrado (ID: ${araceliaId})\n`);

    // 2. Lista todos os casos de Aracelia em produção
    console.log('🔍 Buscando casos em produção...');
    const [cases] = await db.query(
      `SELECT id, title, case_number, legal_area, description, drive_folder_url, created_at
       FROM cases
       WHERE client_id = ? AND production_stage IS NOT NULL
       ORDER BY created_at DESC`,
      [araceliaId]
    ) as any;

    if (!cases.length) {
      console.log('✅ Nenhum caso de Aracelia encontrado em produção.\n');
      return;
    }

    console.log(`✓ Encontrados ${cases.length} caso(s) em produção\n`);

    // 3. Agrupa por banco/tipo de processo
    const grouped: { [key: string]: CaseRecord[] } = {};
    for (const c of cases) {
      const info = extractBankAndType(c.title, c.description || '', c.legal_area);
      if (!grouped[info.folderName]) {
        grouped[info.folderName] = [];
      }
      grouped[info.folderName].push(c);
    }

    console.log(`📊 Agrupados em ${Object.keys(grouped).length} tipo(s) de processo:\n`);

    // 4. Para cada grupo, cria/atualiza pasta e casos
    let totalUpdated = 0;
    for (const [folderName, casesInGroup] of Object.entries(grouped)) {
      console.log(`   📁 ${folderName} (${casesInGroup.length} caso${casesInGroup.length > 1 ? 's' : ''})`);

      // Tenta criar/encontrar pasta
      // NOTA: sem auth, retornará null. Isto é esperado se não há token.
      const result = await createProductionFolder(1, 'Aracelia Gomes', casesInGroup[0].legal_area, casesInGroup[0].case_number || '');

      if (result) {
        // Atualiza todos os casos deste grupo com a URL da pasta
        for (const c of casesInGroup) {
          await db.query('UPDATE cases SET drive_folder_url = ? WHERE id = ?', [result.folderUrl, c.id]);
          totalUpdated++;
        }
        console.log(`      ✅ Pasta criada/encontrada: ${result.folderUrl}`);
        console.log(`      ✅ ${casesInGroup.length} caso(s) atualizado(s)`);
      } else {
        console.log(`      ⚠️  Não foi possível criar pasta (sem autenticação Google)`);
        console.log(`         Casos não foram atualizados`);
      }
    }

    console.log(`\n✅ Fix concluído!`);
    console.log(`   Total de casos atualizados: ${totalUpdated}\n`);
  } catch (err) {
    console.error('❌ Erro durante o fix:', err);
  } finally {
    process.exit(0);
  }
}

// Executar
reorganizeAraceliaFolders();
