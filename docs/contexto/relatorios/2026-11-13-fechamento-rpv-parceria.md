# Fechamento do caso de parceria com RPV — 13/11/2026

## Pedido
Jessica: "Em parceria, quando sai um RPV naturalmente e a Advogada vai sacar, mas quem faz o pagamento à cliente é a parceira, ela envia um recibo e um vídeo-depoimento falando sobre o recebimento. Precisamos de um local para incluir isso dentro do CRM e colocar o caso como finalizado, com o valor do repasse para a parceria, o valor que foi para a cliente, o valor que ficou para a parceria e o que entra em nosso caixa."

## Feito
- **Tela:** Parcerias → linha do caso → botão "Finalizar (RPV)" (depois "Fechamento"), em `public/app.js` (`fechamentoRpvForm`). Mostra a conta ao vivo. Recibo e vídeo são enviados como arquivo, com barra de progresso, ou como link. A lista mostra "Finalizado" e "falta recibo/vídeo".
- **Regra:** `src/services/fechamentoRpvParceria.ts`: `calcularDivisaoRpv` (em centavos), `conferirDivisaoRpv`, `situacaoFechamento` e `registrarFechamentoRpv`, que recebe o banco injetado.
- **Banco:** `src/services/fechamentoRpvParceriaMysql.ts`; migration `177_parceria_fechamentos.sql` (tabela nova, um fechamento por caso).
- **Rotas** (`src/routes/partners.ts`, só equipe): `GET/POST /api/partners/cases/:id/fechamento`, `POST .../fechamento/arquivo` (corpo cru em fluxo para o Drive) e `POST .../fechamento/link`.
- **Drive:** `enviarArquivoParaPastaDoCaso` em `partnerInboxService.ts`.
- **Servidor:** `server.requestTimeout` passou a 20 min (`src/index.ts`), para vídeos grandes.
- **Documentação:** manual `09-repasses.md` (seção nova e changelog), `17-decision-log.md`, `ESTADO.md` e `docs/api/rotas.md`.

## Verificado
- `tests/fechamentoRpvParceria.test.mjs`: 11 testes passando (conta, centavos, valores ajustados, reaproveitamento do "Êxito" pendente, salvar de novo, recusa sem gravar).
- `tests/fechamentoRpvParceriaBanco.test.mjs`: teste com banco real. **Localmente foi pulado** (não há MySQL nesta máquina); roda no CI.
- A conta da tela e a do servidor deram 0 divergências em 2.000 valores aleatórios.
- `npm run build` ok; lint sem erros novos; `npm test` com 1.377 testes e 0 falhas.
- **Não verificado:** o formulário no navegador e o envio real de vídeo ao Drive em produção.

## Decisões e porquês
- **Receita:** é o honorário inteiro, e o repasse é só a parte da parceria, o mesmo modelo do botão "Êxito". O dinheiro da cliente só passa pela conta e fica em `parceria_fechamentos`; assim não infla o faturamento nem as saídas.
- **"Finalizado":** é `cases.status = encerrado`, com resultado e valor obtido. A etapa "Concluído" da esteira significa peça protocolada e por isso não foi usada. Nenhuma mensagem vai à cliente.
- **Recibo e vídeo vão para o Drive, não para o banco:** o banco vai inteiro no backup diário, que já teve problema de tamanho. Se o Drive falhar, o recibo (até 15 MB) fica no CRM; para o vídeo, cola-se o link.
- **nginx:** o limite geral é de 25 MB. Foi aberta uma exceção de 500 MB, sem buffer, só no endereço `/api/partners/cases/N/fechamento/arquivo`. **Aplicada na VPS em 13/11, com autorização da Jessica.** Cópia de antes: `/root/nginx-crm.bak-20261113`. Conferido: 30 MB nesse endereço passam (o CRM responde 401 sem login); em outra rota continuam barrados (413).

## Pendente
- Jessica: testar com um caso real (valores, recibo e vídeo) e confirmar que a divisão bate com o que a parceira pagou.
- Não feito, pode ser pedido: a parceira ver o fechamento no portal dela; sucumbência em RPV separado (hoje vai nas observações).

## Próxima sessão
Abrir Parcerias, escolher um caso de teste e clicar em "Finalizar (RPV)". Conferir Financeiro (receita paga), Repasses (repassado) e Documentos do caso (pasta Financeiro). Skills: `webapp-testing`, `verification-before-completion`.
