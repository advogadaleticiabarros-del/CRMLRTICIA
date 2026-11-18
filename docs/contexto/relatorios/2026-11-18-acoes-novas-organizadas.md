# Ações novas de clientes: leitura organizada — 18/11/2026

## Pedido
Print de Andamentos nos tribunais → "Ações novas de clientes (125)", com cartões grandes e o texto da publicação cortado: "quero poder ler de forma organizada aqui".

## Feito
- `public/app.js` (`andamentosAcoesNovas`): a lista passou a ser desenhada no navegador com filtros, sem mudar a API nem o banco.
  - Totais por polo (contra o cliente, polo ativo, não informado) em botões que filtram (clique de novo para tirar).
  - Busca por nome do cliente ou nº do processo (4+ dígitos), filtro por tribunal e contador "X de Y".
  - "Agrupar por cliente" (padrão): um cartão por cliente, com o número de processos; grupos com processo contra o cliente vêm primeiro; dentro do grupo, a publicação mais recente. Opção "Mais recentes primeiro" mostra tudo por data, com o nome do cliente em cada linha.
  - Cada processo: polo, número, data e tipo numa linha; tribunal, classe e órgão em campos rotulados; texto da publicação recolhido em "Ler a publicação" (com "…" quando chegou cortado nos 600 caracteres).
  - Os filtros ficam guardados ao confirmar ou descartar um item.
- Manual `docs/manual/10-monitoramento.md` (seção da ação nova + changelog) e o espelho no Obsidian.

## Verificado
- `node --check public/app.js` e `npm run lint` (0 erros).
- Tela desenhada com dados de exemplo no Chromium (Playwright), em 1300px e 390px: agrupamento, ordem, filtros e "Ler a publicação" funcionando, sem erro no console.

## Decisões
- Visual igual ao resto do CRM (mesmos botões, cartões e selos); só a organização mudou, seguindo a regra de não mudar o uso sem prévia.
- Não entrou "descartar todos deste cliente": é ação em lote; fica para se ela pedir.

## Pendente
- Conferir em produção com os 125 itens reais.

## Próxima sessão
- Se a Dra. achar muitos homônimos do mesmo nome, avaliar o descarte em lote por cliente.
