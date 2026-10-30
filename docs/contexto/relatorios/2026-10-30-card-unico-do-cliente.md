# 30/10/2026 — Card único do cliente na produção

## Pedido
Jessica, com o caso real de um cliente com 6 bancos (Itaú, Pine, Banrisul, C6, PAN e Facta): "preciso de tudo centralizado em um único card, pois está bem bagunçado criar vários cards diferentes, mesmo que vamos fazer vários processos distintos para protocolar... 80% o CRM deve me entregar pronto, organizado, com os documentos renomeados e as peças prontas para que eu revise e protocole um a um". Regra dela: "cada banco (parte contrária) deve ter uma peça dedicada; se for do mesmo banco pode ser RMC e RCC". Depois da análise: "faça como você sugeriu e já suba".

## Diagnóstico (produção, só leitura)
- 6 cards do cliente; todos os 16 documentos estavam no card do Itaú, e os outros 5 estavam vazios, sem parte contrária.
- O "EXTRATO_DE_EMPRESTIMO_CONSIGNADO" e os 6 "historico-creditos" são históricos de créditos: mostram 10 descontos de empréstimo, RMC e cartão sem o banco. Por isso a peça do Itaú saiu com R$ 0,00. Falta o extrato de empréstimos (HISCON).
- O print do PAN/FACTA (margem R$ 89,20) não bate com o histórico (RMC R$ 60,72; cartão R$ 75,65).
- A senha do Meu INSS estava em claro na observação do card.

## Feito
- `src/services/loteProducao.ts`: classificação dos documentos (texto lido primeiro, nome depois), nome padrão, kit por ação (comuns + os que citam o banco do réu, na ordem do protocolo), requisitos (o extrato de empréstimos trava consignado/cartão consignado), situação da ação, etapa do card e agrupamento do quadro.
- `src/services/kitProtocolo.ts`: .zip com a peça em .docx (Times 12, espaçamento 1,5, recuo de 2,5 cm), anexos renomeados, fotos em PDF e LEIA-ME.
- `src/services/loteProducaoMysql.ts` e `src/routes/lote.ts` (`/api/lote`). Migration 173 (`documents.nome_original`).
- Quadro: `production-board` agrupa por cliente; card do cliente em `public/app.js`; tela nova `public/loteCliente.js` e o CSS.
- Senha: `retirarSenhaInss`, aplicada ao salvar a observação e no início do CRM (`guardarSenhasDosCards`).
- Docs: manual 06 (seção nova + changelog), runbook (incidente da senha), decision log, glossário e mapa de rotas.

## Verificado
- `npm test`: 1.146 passam, 0 falhas, 33 pulados (os com banco rodam no CI). 14 testes novos (`loteProducao`, `kitProtocolo`); o caso real está reproduzido com dados fictícios.
- `tsc` e lint sem erro nos arquivos novos.
- Tela renderizada com o `loteCliente.js` real e o resultado de `montarLote` para o caso de 6 bancos: sem erro de JavaScript; computador 1366 px e celular 390 px sem rolagem lateral. O print PAN/FACTA entra só nos kits do PAN e da Facta.
- Ponta a ponta: o teste do processo único foi ajustado (os 3 pedidos são 1 card do cliente), e há um teste novo do card do cliente (trava, kit baixado, nome padrão, protocolar). Rodam no CI.

- **Produção (depois do deploy):** CI com os testes de ponta a ponta e deploy OK; migration 173 aplicada. O card do cliente real mostra 6 ações, todas travadas por falta do extrato de empréstimos do INSS (e do comprovante de residência). O kit de cada ação tem 10 anexos (procuração, declaração, RG e 7 históricos de créditos), e PAN e Facta têm 11, com o print dos cartões. A peça v2 do Itaú aparece.
- **Defeito achado na verificação e corrigido no mesmo dia:** a senha aparecia duas vezes na observação, e a 1ª versão trocava só a primeira. Agora troca todas (teste novo); conferido em produção: a senha não está mais no texto e está na ficha do cliente.

## Decisões e porquês
- Sem tabela de lote: o card do cliente sai dos casos antes do protocolo. Cada ação continua sendo um caso, porque depois do protocolo tem nº e acompanhamento próprios.
- Tipo do documento pelo texto lido antes do nome: os nomes que chegam enganam.
- O kit numera os anexos na ordem do protocolo, e as fotos viram PDF, que é o que o PJe aceita.

## Pendente
- **Equipe:** baixar no Meu INSS do cliente o extrato de empréstimos consignados e o histórico de créditos desde 2022, enviar pela tela do cliente e gerar as peças.
- ~~Jessica: confirmar empréstimo e cartão do mesmo banco~~ → confirmado em 30/10: são peças diferentes (já é assim no sistema).
- **Ideias, não feitas:** planilha em PDF no kit (hoje vai o .xlsx); juntar os 6 históricos de créditos em um PDF só; marcar sozinho como "Pronta" quando a peça final não tem campos em amarelo.

## Próxima sessão
Conferir com `gh run list` se o CI e o deploy passaram, e abrir o card do cliente em produção. Skills: `tdd`, `codebase-design`, `verification-before-completion`.

## Adendo (30/10, noite): versão final enviada pela Dra. e kit com os arquivos do Drive
- **Pedido:** "caso eu faça a revisão e tenha a peça aprimorada, quero incluir a peça como V FINAL... e depois baixar os kits".
- **Feito:** "Enviar a peça revisada (versão final)" (Word ou PDF; `enviarVersaoFinal`, rota `POST /api/lote/:clientId/acao/:caseId/versao-final`); vai no kit como veio. "Marcar a vN como final" na tela do cliente. A ação com versão final fica "Pronta".
- **Achado na produção:** os 11 documentos do caso estão só no Google Drive (o CRM guarda o link), e o kit sairia sem eles. Agora o kit baixa do Drive na hora (`arquivoDoKit`). A leitura da pasta do Drive passou a reconhecer o documento renomeado (`nome_original`), para não importar de novo.
- **Correção de informação:** o histórico de créditos de 2021 a 2026 já estava no caso (6 arquivos, um por ano). O que falta é o extrato de empréstimos consignados (HISCON): o arquivo "EXTRATO_DE_EMPRESTIMO_CONSIGNADO" é um histórico de créditos de 09 e 10/2026 e não cita banco.
- **Verificado:** 5 testes novos (texto do Word, versão final no kit como veio, id do Drive, ação pronta com versão final); suíte inteira sem falhas; teste de ponta a ponta do card do cliente ampliado (envia a peça em Word, fica pronta, protocola).

## Adendo 2 (30/10, noite): colar a peça e sair no papel timbrado
- **Pedido:** "eu só quero colar lá, para que deixe no papel timbrado e deixe na formatação correta para peças".
- **Feito:** "Colar a peça revisada (versão final)" na tela do cliente (folha que lê a formatação colada e manda só a lista de parágrafos); `papelTimbrado.ts` monta o .docx sobre `assets/timbrado/papel-timbrado.docx` (o timbrado da Dra. com o corpo vazio: a peça de cliente que estava nele foi retirada); "Baixar a peça (timbrado)". A peça da equipe no kit também sai no timbrado (a biblioteca `docx` deixou de ser usada no kit).
- **Verificado:** 6 testes novos (`papelTimbrado`); suíte inteira sem falhas. Colagem simulada de uma peça no formato do Word na tela real: 14 parágrafos, com negrito, itálico, citação e alinhamento. O .docx aberto no Word e exportado para PDF: 1 página, timbrado com logo, marca d'água e rodapé, formatação conferida na imagem. Ponta a ponta atualizado (colar, ficar pronta, baixar a peça).
