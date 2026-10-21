/**
 * Atualiza o acervo da Pesquisa de Leis num processo separado do servidor.
 *   node dist/scripts/leisAtualizar.js [--completo]
 * A última linha da saída é o resumo em JSON (lido por leisServico).
 */
import { executarAtualizacao } from '../services/leisSync';

executarAtualizacao({ completo: process.argv.includes('--completo') })
  .then((r) => { console.log(JSON.stringify(r)); process.exit(0); })
  .catch((e) => { console.error(e?.message || String(e)); process.exit(1); });
