/**
 * Validação de CPF/CNPJ por dígito verificador (algoritmo público, Receita
 * Federal) — achado da auditoria do módulo Clientes (23/09/2026): o campo
 * `clients.cpf_cnpj` aceitava qualquer texto, sem checar se o número digitado
 * é sequer válido. Não normaliza o valor guardado (mantém a máscara que a
 * usuária digitou) — só valida o dígito e ajuda a comparar CPF/CNPJ vindos
 * com pontuação diferente (`normalizarDigitos`).
 */

export function normalizarDigitos(v: string | null | undefined): string {
  return String(v || '').replace(/\D/g, '');
}

function validarCpf(digits: string): boolean {
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const calc = (len: number) => {
    let soma = 0;
    for (let i = 0; i < len; i++) soma += Number(digits[i]) * (len + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10]);
}

function validarCnpj(digits: string): boolean {
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;
  const calc = (len: number) => {
    const pesos = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < len; i++) soma += Number(digits[i]) * pesos[i];
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return calc(12) === Number(digits[12]) && calc(13) === Number(digits[13]);
}

/** Vazio é sempre válido (campo opcional) — só valida o que foi preenchido. */
export function cpfCnpjValido(valor: string | null | undefined): boolean {
  const digits = normalizarDigitos(valor);
  if (!digits) return true;
  if (digits.length === 11) return validarCpf(digits);
  if (digits.length === 14) return validarCnpj(digits);
  return false; // nem CPF (11) nem CNPJ (14) — formato incompleto/errado
}
