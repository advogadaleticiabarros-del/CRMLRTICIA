import { db } from '../config/database';
import { aiComplete } from './aiAssistant';
import { reprocessContract } from './contractReprocess';
import { promptPessoasDaConversa, parsePessoas, separarPartes, type PessoaConversa } from './partesContrato';

/**
 * Busca na CONVERSA do WhatsApp os dados de todas as pessoas do contrato
 * (titular + cônjuge/familiar) e completa o contrato (regras em partesContrato.ts).
 * Só mexe no RASCUNHO interno do contrato: nada é enviado a ninguém.
 * Nunca apaga o que a equipe já digitou no "Completar informações".
 */

const fim8 = (p: string | null | undefined) => String(p || '').replace(/\D/g, '').slice(-8);

export async function buscarPartesNaConversa(contractId: number) {
  const [[ct]] = await db.query(
    `SELECT ct.id, ct.client_id, ct.lead_id, ct.party_overrides, COALESCE(cl.name, l.name) AS nome, COALESCE(cl.cpf_cnpj, l.cpf_cnpj) AS cpf,
            COALESCE(NULLIF(cl.phone, ''), l.phone) AS phone
       FROM contracts ct LEFT JOIN clients cl ON cl.id = ct.client_id LEFT JOIN leads l ON l.id = ct.lead_id WHERE ct.id = ?`, [contractId]) as any;
  if (!ct) return { ok: false as const, erro: 'Contrato não encontrado' };
  if (fim8(ct.phone).length < 8) return { ok: false as const, erro: 'O cliente não tem telefone cadastrado para ler a conversa.' };
  const [msgs] = await db.query(
    `SELECT body FROM whatsapp_messages WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 8) = ? AND from_me = 0 AND body <> ''
      ORDER BY msg_time DESC LIMIT 150`, [fim8(ct.phone)]) as any;
  if (!msgs.length) return { ok: false as const, erro: 'Nenhuma mensagem do cliente na conversa.' };
  const r = await aiComplete(promptPessoasDaConversa([...msgs].reverse().map((m: any) => String(m.body))), 'openai');
  const pessoas = r.ok && r.text ? parsePessoas(r.text) : [];
  const { titular, outros } = separarPartes({ nome: ct.nome, cpf: ct.cpf }, pessoas);
  return { ok: true as const, ct, titular, outros };
}

const paraOverride = (p: PessoaConversa) => ({
  nome: p.nome, cpf: p.cpf, rg: p.rg, estado_civil: p.estado_civil, profissao: p.profissao, nacionalidade: p.nacionalidade,
  endereco: p.endereco, email: p.email, telefone: p.telefone, relacao: p.relacao, cpf_valido: p.cpfValido, origem: 'conversa',
});

/**
 * Completa o contrato com as pessoas da conversa: os outros contratantes entram em
 * co_contratantes (sem duplicar quem já está lá) e o titular só ganha o que falta.
 * Regenera os documentos e devolve o que foi encontrado.
 */
export async function aplicarPartesDaConversa(contractId: number) {
  const b = await buscarPartesNaConversa(contractId);
  if (!b.ok) return b;
  let ov: any = {};
  try { ov = typeof b.ct.party_overrides === 'string' ? JSON.parse(b.ct.party_overrides) : (b.ct.party_overrides || {}); } catch { ov = {}; }
  const atuais: any[] = Array.isArray(ov.co_contratantes) ? ov.co_contratantes : [];
  const chave = (p: any) => String(p.cpf || '').replace(/\D/g, '') || String(p.nome || '').toLowerCase().trim();
  const novos = b.outros.map(paraOverride).filter((p) => !atuais.some((a) => chave(a) === chave(p)));
  ov.co_contratantes = [...atuais, ...novos];
  // Titular: só preenche o que a equipe ainda não preencheu.
  if (b.titular) {
    if (!ov.profissao && b.titular.profissao) ov.profissao = b.titular.profissao;
    if (!ov.nacionalidade && b.titular.nacionalidade) ov.nacionalidade = b.titular.nacionalidade;
    if (!ov.email && b.titular.email) ov.email = b.titular.email;
    if (!ov.endereco && b.titular.endereco) ov.endereco = b.titular.endereco;
    if (!ov.cpf && b.titular.cpf && b.titular.cpfValido && !b.ct.cpf) ov.cpf = b.titular.cpf;
  }
  await db.query('UPDATE contracts SET party_overrides = ? WHERE id = ?', [JSON.stringify(ov), contractId]);
  await reprocessContract(contractId, undefined, ov);
  return {
    ok: true as const,
    titular: b.titular ? { nome: b.titular.nome, encontrado: true } : null,
    contratantes: ov.co_contratantes.map((p: any) => ({ nome: p.nome, cpf: p.cpf, cpf_valido: p.cpf_valido !== false, faltam: ['profissao', 'endereco'].filter((k) => !p[k]) })),
    novos: novos.length,
  };
}
