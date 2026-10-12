import zlib from 'zlib';
import { Readable } from 'stream';
import { DivisorSql } from '../utils/divisorSql';

/**
 * Executa um dump .sql.gz (já decifrado) comando por comando, lendo em fluxo.
 *
 * Antes (até 11/10/2026) o dump era descomprimido inteiro num único texto;
 * com 656 MB de SQL passou do limite do Node (~512 MB) e a restauração falhava.
 * Agora a memória só guarda o comando atual — o tamanho total do backup não
 * importa mais. O limite que sobra é o do MySQL por comando (max_allowed_packet):
 * um registro maior que ele não restauraria, e aqui isso vira erro claro.
 *
 * @param executar roda um comando no banco (injetado: banco real ou teste)
 * @param limiteComando tamanho máximo de um comando, em caracteres
 */
export async function executarDumpEmFluxo(
  gz: Buffer,
  executar: (comando: string) => Promise<unknown>,
  limiteComando = Infinity,
): Promise<{ comandos: number; temCreateTable: boolean }> {
  const divisor = new DivisorSql(limiteComando);
  const descomprimido = Readable.from([gz]).pipe(zlib.createGunzip());
  descomprimido.setEncoding('utf8'); // decodifica acentos partidos entre pedaços

  let comandos = 0;
  let temCreateTable = false;
  const rodar = async (lista: string[]) => {
    for (const c of lista) {
      if (!temCreateTable && /^CREATE TABLE/i.test(c)) temCreateTable = true;
      await executar(c);
      comandos++;
    }
  };
  for await (const pedaco of descomprimido) await rodar(divisor.push(pedaco as string));
  await rodar(divisor.finalizar());
  return { comandos, temCreateTable };
}
