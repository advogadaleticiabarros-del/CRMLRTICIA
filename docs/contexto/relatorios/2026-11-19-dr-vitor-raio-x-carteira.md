# 19/11/2026 — Dr. Vítor: raio-x da carteira e conversa com a equipe

## Pedido
Jessica, com print da ficha do Dr. Vítor ("divergentes: 54 · avisos: 5"): "melhore como o Dr Vitor trabalha e entrega os dados, verifique o que colocar para que seja completo e com quem ele deve ter contato [...] um escritório multi agêntico, um ecossistema completo jurídico cheio de interações, humanizadas e naturais".

## Feito
- Regras puras: `src/services/carteiraRaioX.ts`. São 10 tipos de pendência, cada um com gravidade, motivo, o que fazer e o colega responsável. Também comparam o dia com o anterior, fazem o repasse por colega, montam as falas variadas, o aviso à Dra. e a linha do briefing.
- Banco e avisos: `src/services/carteiraRaioXJob.ts`, tabela `carteira_raio_x` (`migrations/188_carteira_raio_x.sql`). A rotina `carteira:raio-x` roda às 6h45 (`src/crons/index.ts`).
- Conversas: `sociedadeAgentes.ts` passou a aceitar destinatário e tema que dependem do texto. Há 3 regras novas do Vítor: o raio-x vai à Clara, o repasse vai a cada colega e as pendências resolvidas viram conversa com a Tereza.
- Entrega à Dra.:
  - linha no briefing (`briefingExtras.ts` e `briefingExtrasRender.ts`, campo opcional `carteira`);
  - aviso no sino só com pendência grave nova ou piorada, e resumo completo às segundas;
  - rota `GET /api/escritorio/carteira` e seção "Raio-x da carteira" na ficha do Vítor (`public/escritorio.js`), com filtros.
- Vítor em `escritorioVirtual.ts`: resumo e descrição novos, e a rotina nova na lista dele. As rotinas antigas (`carteira:vigia` e `processos:fase-divergente`) agora mostram o resultado em texto legível.
- Manual: `10-monitoramento.md` (seção nova com a tabela de pendências), `00-visao-geral.md` e `17-decision-log.md`. Espelho do Obsidian copiado.

## Verificado
- Os 19 testes novos (`tests/carteiraRaioX.test.mjs`) passam. Eles conferem as regras e as conversas, que o aviso não traz o nome completo do cliente e que as consultas SQL batem com as migrations.
- Montei uma cópia limpa do repositório (HEAD) só com estas mudanças: `tsc` e `eslint` sem erro, e `npm test` com as variáveis do CI deu 1.627 testes, 0 falhas e 34 pulados (os que precisam de MySQL, que rodam no CI).
- **Não verificado:** dados de produção (o acesso ao banco foi negado nesta sessão), a tela no navegador e o primeiro raio-x real, que sai em 20/11 às 6h45.

## Decisões e porquês
- Fiz um raio-x único por dia em vez de mais avisos soltos: o sino já recebia muitos e a Dra. não sabia quais eram os 54. Os detalhes estão no decision log de 19/11.
- O Vítor não cria tarefa, prazo nem rascunho para cliente; ele só avisa e repassa. Seguem as regras "monitoramento não cria trabalho" e "nenhuma mensagem a cliente sem consentimento".
- Só o primeiro nome do cliente aparece, porque a sala do escritório também passa na TV.
- Commit seletivo: `escritorioVirtual.ts`, `routes/escritorio.ts` e `public/escritorio.js` tinham trabalho de outra sessão ainda fora do git (ficha do agente, TV). Por isso entrou no commit só o meu trecho, aplicado sobre o HEAD, e o trabalho deles continua intacto na pasta.

## Pendente
- Conferir o primeiro raio-x real em 20/11: quantidade de pendências, conversas no mural e se o aviso no sino ficou no tamanho certo. Se houver muitas pendências "ação não proposta" (casos que não são de processo), é preciso ajustar a regra. Isso é com a Jessica ou a Dra.
- Há trabalho de outra sessão ainda fora do git (ficha do agente, TV). Não foi mexido.

## Próxima sessão
Abrir Escritório virtual → Dr. Vítor e conferir a seção "Raio-x da carteira" e o mural. Se os números parecerem errados, consultar `carteira_raio_x` na VPS. Skills: `diagnosing-bugs` se algo estiver estranho, `tdd` para ajustar regras.
