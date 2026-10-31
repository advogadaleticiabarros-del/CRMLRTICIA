# 31/10/2026 — Juntar em uma inicial (tela do cliente)

## Pedido
Jessica, olhando a tela do cliente com 6 ações: "podemos colocar um checkbox e um botão que unifica os processos que eu achar necessário, para criar uma única inicial... manter a regra atual e só junta se eu analisar e achar necessário". Regra dela: "a junção manual pode misturar teses diferentes (empréstimo consignado com cartão RMC/RCC) apenas, não os mesmos réus / parte contrária". Entendido como: tese pode ser outra, o banco tem de ser o mesmo.

## Feito
- `conferirJuncao` (`src/services/loteProducao.ts`): duas ou mais ações, mesmo cliente, antes do protocolo, todas com parte contrária e **contra o mesmo banco** (raiz do CNPJ ou nome do banco). A tese pode ser diferente. A rota `POST /api/mesa/juntar` passou a usar esta regra (vale também para a faixa "processo único" do quadro, que já só sugeria o mesmo banco).
- `familiasDaAcao` (`contratosDoCaso.ts`): as teses do processo são a do título mais as dos pedidos unidos. Usada na conferência "uma peça por banco" (o cartão unido à ação de empréstimo do mesmo banco deixa de aparecer como "sem ação"), na planilha do Calculista e na tela do cliente.
- Tela do cliente (`public/loteCliente.js`): caixinha em cada ação não protocolada, barra "Juntar em uma inicial" (confirma mostrando banco e tese), a linha mostra "Empréstimo consignado + Cartão consignado (RMC/RCC)" e "Na mesma inicial: #N" com "Separar".
- A sugestão automática não mudou: continua só com a mesma tese.

## Verificado
- `tests/juncaoManual.test.mjs`: 7 testes (mesmo banco com teses diferentes junta; raiz do CNPJ; bancos diferentes recusados; sem réu; um caso só, outro cliente, protocolada; conferência por banco com pedido unido; tela do cliente com as duas teses).
- Suíte completa: 1315 testes, 0 falhas; lint sem erros.
- **Não testado no navegador nem em produção.**

## Decisões
- A tela não confere o banco antes de enviar: o servidor é a fonte da regra e devolve o motivo ("cada banco é uma peça").
- A ação mais adiantada vira o card do processo (regra que já existia na rota).
- Trabalho feito num worktree separado porque outra sessão estava mexendo no repositório ao mesmo tempo (documentos repetidos do Drive); as alterações dela não foram incluídas neste commit.

## Pendente
- Testar na tela do cliente: juntar duas ações do mesmo banco e ver a recusa com bancos diferentes.
- Depois de juntar, gerar a peça de novo na mesa e conferir se a redação trata as duas teses (fatos e pedidos de cada uma).

## Próxima sessão
Se a peça com duas teses sair confusa, ajustar o pedido de redação (`esteiraPeca.ts`) para separar fatos e pedidos por tese.
