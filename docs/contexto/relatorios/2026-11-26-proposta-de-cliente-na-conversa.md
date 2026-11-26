# 26/11/2026 — Proposta de quem já é cliente aparece na conversa

## Pedido
"Vinculei a cliente aqui, precisa aparecer o número da proposta." / "Além do processo que já existe, montei uma nova proposta, quero ver o status ali como os demais."

## Feito
- **Causa:** a ficha da conversa (`public/whatsapp.js`) só procurava proposta quando o contato não era cliente. A busca (`GET /chats/:phone/proposta` e `POST /enviar-proposta`) só olhava o telefone da proposta ou do lead, nunca o `client_id`.
- **Servidor** (`src/routes/whatsapp-instance.ts`): uma busca só, `propostaDoContato`, que acha a proposta pelo telefone da proposta, do lead ou da ficha do cliente. `GET /chats/:phone/context` agora devolve `propostas` do cliente (últimas 5).
- **Tela:** "Vínculos no CRM" lista "Proposta nº N — título · status · valor" abaixo dos processos. Para cliente, o selo "analisando proposta" (aberturas/leitura) e o botão *Enviar proposta* agora funcionam. *Gerar proposta* continua pela ficha do cliente.

## Verificado
- `tsc --noEmit` ok, `npm run lint` 0 erros, `npm test` 1672 aprovados e 0 falhas, `node --check public/whatsapp.js` ok.
- Não foi possível conferir a consulta no banco de produção (acesso negado nesta sessão). O CI roda o banco do zero.

## Decisões
- Número da proposta = id da proposta (a tabela não tem campo de numeração própria).
- Lista mostra todos os status (inclusive aceita/recusada), para servir de histórico, já o botão de envio usa só propostas vivas.

## Pendente
- A Dra. conferir na conversa da cliente depois do deploy.

## Próxima sessão
- Se pedirem, clicar na proposta da lista para abri-la.
