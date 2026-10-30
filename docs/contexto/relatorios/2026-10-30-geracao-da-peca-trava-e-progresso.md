# 30/10/2026 — Geração da peça: confirmação, trava e barra de progresso

## Pedido
Jessica: "trave o botão depois do primeiro clique, até chegar a versão, e sempre confirme antes" e "poderia ter uma barra mostrando que a versão está sendo gerada, é muito difícil ficar aguardando sem saber de nada". Informou também que o HISCON estará juntado em todos os casos de consignado/RMC/RCC.

## Feito
- `src/services/travaGeracaoPeca.ts` (novo): trava por peça em memória (`iniciar`, `terminar`, `executar`, `emAndamento`, `marcar`), etapas da geração (`ETAPAS_GERACAO`, 9), solta sozinha em 30 min.
- `esteiraPeca.ts`: `deps.etapa?.()` no início de cada etapa (leitura, cálculos, estratégia, fundamentos, redação, conferência). `peticaoBuilder.ts` liga isso à trava e marca "salvando".
- `routes/cases.ts`: `POST /:id/peticao-inicial` recusa com 409 se já está gerando; `GET /:id/peticao-inicial/status` (novo); o gatilho de "Criação inicial" usa a mesma trava e marca "revisão automática". `routes/mesa.ts`: `gerandoPeca` nos dados da mesa.
- `public/mesa.js`: confirmação sempre, botão travado, barra de progresso (canto inferior direito), volta a verificar a cada 4 s e abre a versão nova ao chegar. `public/app.js`: painel da produção com confirmação e o botão mostrando a etapa. `public/styles.css`: estilo da barra.
- Docs: manual 06 (+ changelog), decision log, `docs/api/rotas.md`, ESTADO; espelho do Obsidian.

## Verificado
- TDD: 9 testes novos (8 da trava, 1 da ordem das etapas na esteira), escritos antes do código e vistos falhando.
- `npm run build` ok; `npm run lint` 0 erros; `npm test`: 1.183 passaram, 0 falhas, 33 pulados (os de banco, que rodam no CI).
- Barra renderizada com o CSS real em 1366 px e 390 px (prints no scratchpad da sessão).
- **Não verificado:** a barra numa geração real em produção (gasta IA e cria versão); o comportamento na tela real foi conferido só pelo código e pela página de teste.

## Decisões
- Trava em memória (processo único do PM2); ver decision log.
- O botão "nova versão" sempre confirma, mesmo na 1ª peça.

## Pendente
- Conferir a barra na próxima geração real.
- Ideia oferecida, não feita: botão "Gerar as peças de todas as ações" na tela do cliente.

## Próxima sessão
Ver o CI/deploy deste commit e, na primeira geração real, se as etapas avançam na barra.
