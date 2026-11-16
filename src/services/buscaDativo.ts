// Busca das demandas dativas: um único campo acha pelo nome do assistido ou
// pelo número do processo, digitado com ou sem pontuação (pedido da
// Dra. Letícia, 16/11/2026). O número gravado no banco pode ter pontos,
// traços, barras ou espaços, então a comparação é feita só pelos dígitos.

// Abaixo disso, um número digitado é mais provável parte de um nome/apelido
// do que um trecho útil do processo, e traria resultados demais.
const MIN_DIGITOS_PROCESSO = 4;

const PROCESSO_SO_DIGITOS =
  "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(process_number, '.', ''), '-', ''), '/', ''), ' ', ''), '_', '')";

export function filtroBuscaDativo(termo: unknown): { sql: string; params: string[] } | null {
  const texto = typeof termo === 'string' ? termo.trim() : '';
  if (!texto) return null;
  const condicoes = ['assisted_name LIKE ?'];
  const params = [`%${texto}%`];
  const digitos = texto.replace(/\D/g, '');
  if (digitos.length >= MIN_DIGITOS_PROCESSO) {
    condicoes.push(`${PROCESSO_SO_DIGITOS} LIKE ?`);
    params.push(`%${digitos}%`);
  }
  return { sql: `(${condicoes.join(' OR ')})`, params };
}

// Protocolo do e-Flow (ex.: 2026-C35XPH), pedido da Jessica (16/11/2026). O
// código pode ter sido gravado em minúscula ou com espaço; compara só letras
// e números, em maiúsculas. Qualquer outro caractere digitado (inclusive % e _,
// curingas do LIKE) é descartado.
const PROTOCOLO_NORMALIZADO = "UPPER(REPLACE(REPLACE(eflow_protocolo, '-', ''), ' ', ''))";

export function filtroProtocoloDativo(termo: unknown): { sql: string; params: string[] } | null {
  const codigo = typeof termo === 'string' ? termo.toUpperCase().replace(/[^0-9A-Z]/g, '') : '';
  if (!codigo) return null;
  return { sql: `${PROTOCOLO_NORMALIZADO} LIKE ?`, params: [`%${codigo}%`] };
}
