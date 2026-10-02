/**
 * União de processos duplicados (mesmo número em formatos diferentes) —
 * regras puras. Mantém o cadastro mais antigo; cliente/caso vêm do grupo.
 * Grupo com clientes ou casos diferentes é "conflito": quem escolhe é a
 * advogada (nunca o sistema).
 */

export interface CopiaProcesso { id: number; client_id: number | null; case_id: number | null }

const distintos = (xs: (number | null)[]) => [...new Set(xs.filter((x): x is number => x !== null && x !== undefined))];

export function planoUniao(grupo: CopiaProcesso[]) {
  const ord = [...grupo].sort((a, b) => a.id - b.id);
  const clientes = distintos(ord.map((g) => g.client_id));
  const casos = distintos(ord.map((g) => g.case_id));
  return {
    manter: ord[0].id,
    remover: ord.slice(1).map((g) => g.id),
    client_id: clientes[0] ?? null,
    case_id: casos[0] ?? null,
    conflito: clientes.length > 1 || casos.length > 1,
    clientes, casos,
  };
}

export function escolhaValida(grupo: CopiaProcesso[], clientId: number | null, caseId: number | null): boolean {
  const p = planoUniao(grupo);
  const okCli = clientId === null ? p.clientes.length === 0 : p.clientes.includes(clientId);
  const okCaso = caseId === null || p.casos.includes(caseId);
  return okCli && okCaso;
}
