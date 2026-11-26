# 26/11/2026 — Nova proposta encontra o cliente da base

## Pedido
"Quando for produzir uma nova proposta seria interessante já encontrar também clientes da Base, pois às vezes um cliente que já tem processo conosco quer entrar com algum outro distinto."

## Feito
- **Formulário "Produção da Proposta"** (`propostaForm`, `public/app.js`): a lista solta "Vincular a cliente existente" virou a busca **"Já é cliente? Buscar na base"**, que aceita nome, CPF, telefone ou nº do processo e reaproveita a busca da página inicial (`/api/clients/busca-360`).
  - Ao escolher, vincula a ficha (`client_id`), preenche os contatos vazios e mostra um cartão com os processos que a pessoa já tem. "Desvincular" desfaz.
  - Digitar no nome ou no CPF alguém que já é cliente mostra "Parece que já é cliente" e o botão "Usar esta ficha".
  - Proposta em edição já vinculada, ou lead que já virou cliente: o cartão aparece sozinho, sem sobrescrever o formulário.
  - O formulário não baixa mais a lista inteira de clientes (até 2000) a cada abertura.
  - Sem lead e sem cliente, avisa para escolher na busca, em vez de mostrar o erro do servidor.
- **Regra pura** `processosDaBase` (`src/services/visaoCliente.ts`): um item por processo. Caso, processo monitorado e dativo do mesmo número contam uma vez; o caso sem número herda o do processo ligado.
- **Serviço** `resumoClienteParaProposta` (`visaoClienteServico.ts`) + rota `GET /api/clients/:id/resumo-proposta`.
- **Bug corrigido:** `PUT /api/propostas/:id` ignorava `client_id`, então vincular um cliente ao editar não era salvo. Agora aceita id válido ou `null` (desvincular).

## Verificado
- Testes novos: `tests/propostaClienteDaBase.test.mjs` (4), `processosDaBase` em `tests/visaoCliente.test.mjs`, e o resumo no teste com banco `tests/visaoClienteServico.test.mjs`. Este último pula sem banco local e roda no CI.
- `npm run build` ok, `npm run lint` 0 erros, `npm test` 1705 testes e 0 falhas, `node --check public/app.js` ok.
- Não testado no navegador logado (sem banco local). O CI roda o ponta a ponta.

## Decisões
- Reaproveitar a busca 360 em vez de criar outra: mesma tolerância (CPF, telefone, nº do processo) que a equipe já conhece.
- Preencher só os campos vazios, para não apagar o que veio do lead ou já foi digitado. O nome é a exceção: vem sempre da ficha.

## Pendente
- Nada da Dra. Conferir no uso real se a lista de processos do cartão ajuda ou se é melhor mostrar só a quantidade.

## Próxima sessão
- Se pedirem, levar a mesma busca da base para o formulário de novo lead.
