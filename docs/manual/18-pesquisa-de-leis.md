# 18 · Pesquisa de Leis

**Área:** Produção jurídica · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 21/10/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dona do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

Menu **Pesquisa de Leis**: busca na Constituição, em leis e decretos federais, nas leis do ES, em súmulas, OJs e temas (STF, STJ, TST, TNU) e em atos do INSS e do MTE, com o texto oficial e o link da fonte. O mesmo acervo alimenta a produção das peças: a **Dra. Júlia** entrega ao redator só os artigos e súmulas que existem, e a **Dra. Vera** confere cada citação na revisão.

## De onde vêm as leis

- **Fonte:** o repositório público [github.com/ctresb/leis](https://github.com/ctresb/leis), que converte para texto as fontes oficiais (Planalto/normas.leg.br, Assembleia do ES, cadernos do TST, Banco Nacional de Precedentes do CNJ, dados abertos do STJ, Diário Oficial). Os textos de lei não têm direito autoral (Lei 9.610/98, art. 8º, I); os scripts do repositório são MIT.
- **O que o CRM baixa (só isso):**
  - a Constituição;
  - leis ordinárias, complementares e delegadas, decretos-leis e emendas constitucionais federais;
  - os regulamentos consolidados, como o RPS (Decreto 3.048/99);
  - os decretos federais de 1988 em diante;
  - as leis do ES;
  - súmulas, súmulas vinculantes, OJs, temas de repercussão geral e repetitivos, e ações de controle concentrado do STF, STJ, TST e TNU;
  - portarias, instruções normativas e resoluções do INSS e do MTE.

  A lista fica em `PASTAS_DO_ACERVO` (`src/services/leisTexto.ts`).
- **Tamanho (21/10/2026):** 76.142 normas e 442.510 artigos e enunciados. São cerca de 400 MB de texto, e o índice ocupa cerca de 0,7 GB.
- **Súmula ou OJ cancelada:** conta como cancelada mesmo quando o cancelamento só aparece no enunciado ("(cancelada em decorrência…)"), e não no cabeçalho do arquivo. Assim nunca entra como fundamento. Esse caso foi achado no teste real com a OJ SDI1-88 do TST.
- **Aviso que aparece na tela:** são conversões automáticas, algumas feitas por OCR de documento escaneado. Não substituem o Diário Oficial; antes de protocolar, confira na fonte (o link fica em cada lei).

## A tela

Três abas:

1. **Pesquisar**
   - Pesquisa por **palavras** ("justa causa abandono"); acento não importa.
   - Pesquisa por **citação** digitada do jeito rápido: "art 482 clt", "clt 477", "lei 8213/91 art 42", "súmula 331 tst", "tema 1046 stf", "oj 394 sdi-1", "art 10 adct". A citação vem primeiro, marcada "a citação digitada".
   - Filtros: Constituição, Leis federais, Leis do ES, Súmulas/OJs/temas, INSS e MTE, e "Só em vigor".
   - **Atalhos** para abrir direto: CF, CLT, CPC, CC, CDC, Lei de Benefícios, Lei de Custeio, RPS, LOAS, ECA, Lei de Alimentos, Lei do Trabalho Doméstico, Estatuto da Pessoa Idosa, Lei Maria da Penha.
   - **Leitor da lei:** sumário dos artigos (com filtro "ir para o artigo"), texto do artigo, Anterior/Próximo, **Copiar citação** (forma de petição: "art. 482 da CLT (Decreto-Lei nº 5.452/1943)") e **Copiar texto**. Artigos revogados aparecem riscados. Na CF, o ADCT aparece separado.
2. **Conferir citações (Dra. Vera):** cole a peça. Para cada citação aparece:
   - ✓ confere;
   - ✗ artigo revogado, norma revogada ou cancelada, ou artigo que não existe naquela norma;
   - ? fora do acervo (conferir à mão);
   - ⚠ se a IA, lendo o texto oficial ao lado do que a peça afirma, achar que ele não sustenta, ou só sustenta em parte, a afirmação.

   Para a IA vai o trecho citado (o § 6º, o inciso IV), não só o começo do artigo.
3. **Fundamentos para a peça (Dra. Júlia):** descreva o caso (com área e tipo de peça). Sai a lista de artigos, súmulas e temas que se aplicam, só os que existem no acervo, com o texto oficial e os botões de copiar.

Atalho direto para um artigo: `#leis?norma=ID&art=482`.

Acesso: admin, equipe, advogado e estagiário (menu). A API aceita toda a equipe (`requireStaff`).

## No WhatsApp

A Dra. e a Jessica podem escrever ao número do escritório "art 482 clt", "súmula 331 tst" ou "lei 8213 art 42" e recebem na hora o texto oficial, a citação e a fonte, sem IA (ver [WhatsApp](03-whatsapp.md), "Consulta de leis").

## Na produção das peças

| Quem produz | O que muda |
|---|---|
| **Enzo** (minuta da intimação, `runEstagiarioForDeadline`) | Recebe o bloco "FUNDAMENTOS LEGAIS CONFERIDOS NO ACERVO" junto do modelo e das notas do Cérebro |
| **Petição inicial** (`buildPeticaoInicial`) e **Análise do caso** (`analyzeCaseDrive`) | Idem; a análise usa os fundamentos na matriz Fato → Prova → Fundamento → Pedido |
| **Assistente de IA** (petição inicial, contestação, parecer) | Idem |
| **Revisor** (`revisarPeticaoDoCaso`) | O parecer ganha a seção "CONFERÊNCIA DAS CITAÇÕES (Dra. Vera)", e a nota da produção mostra "citações: X/Y conferem" |

**Como a Dra. Júlia monta o bloco:**
1. as citações que já estão no texto (intimação, relato, documentos);
2. os dispositivos que a IA sugere para o caso, **cada um conferido no índice**: o que não existe ou foi revogado é descartado;
3. até 4 súmulas ou temas achados pela busca com os termos que a IA indica.

O bloco termina com a regra: citar o que estiver fora da lista só com **[conferir]**, e nunca inventar número.

Sem IA (sem cota ou fora do ar), a Dra. Júlia entrega só as citações do texto, e a Dra. Vera faz só a conferência por regra. Sem o acervo baixado, as duas ficam quietas e as peças saem como antes.

## Atualização

- **Rotina `leis:atualizar`:** todo domingo às 5h15 e no boot, se o acervo ainda não existe. Roda num **processo separado** (`node dist/scripts/leisAtualizar.js`), porque indexar trava quem indexa.
- **Download:**
  - na 1ª vez: `git clone --depth 1 --filter=blob:none --sparse`, só das pastas acima;
  - depois: `fetch --depth 1` + `reset`, e reindexa só o que o `git diff` mostra.
  - Sem diff possível, ou com o índice fora de sincronia, confere tudo: arquivo sem mudança é pulado pelo hash, e o que sumiu sai do índice.
- **Regras de leitura mudaram?** Suba `VERSAO_REGRAS` em `leisTexto.ts`; a próxima atualização relê o acervo todo.
- **Trava:** `atualizando.lock` impede duas atualizações ao mesmo tempo (vale por 3 horas).
- **Botão "Atualizar agora"** (só admin) na tela, ou `POST /api/leis/atualizar` com `{ "completo": true }` para conferir tudo.
- **1ª indexação:** cerca de 7 minutos no computador de teste; na VPS, conte de 10 a 20 minutos.

## Onde fica

- **Na VPS:** `/home/crmapp/leis/acervo` (clone) e `/home/crmapp/leis/acervo.db` (índice). Muda com `LEIS_DIR`.
- **Fora do MySQL e fora do backup, de propósito:** o acervo se refaz do GitHub (ver decision log).
- **Índice:** SQLite embutido do Node (`node:sqlite`, Node 22.13 ou mais novo), busca FTS5 sem acento, ordenada por relevância. A ordem final sobe Constituição, códigos e jurisprudência, desce o que foi revogado e o artigo que só apareceu pela ementa da lei.

## Código

| Arquivo | Papel |
|---|---|
| `src/services/leisTexto.ts` | Regras puras: ler a norma, quebrar em artigos (partes, ADCT, revogados), achar citações num texto, montar a busca, formatar a citação, avaliar, blocos e relatórios |
| `src/services/leisAcervo.ts` | Índice SQLite: indexar, buscar, abrir norma/artigo, conferir, fundamentos |
| `src/services/leisPesquisa.ts` | Dra. Júlia (`fundamentosParaPeca`) e Dra. Vera (`conferirPeca`), com IA injetada |
| `src/services/leisSync.ts` | Baixar e atualizar pelo git, com trava |
| `src/services/leisServico.ts` | O que o resto do CRM chama; dispara a atualização em processo separado |
| `src/routes/leis.ts` | `GET /api/leis/estado`, `buscar`, `atalhos`, `norma/:id`, `dispositivo/:id`; `POST conferir`, `fundamentos`, `atualizar` |
| `public/leis.js` | A tela |

Testes: `tests/leisTexto`, `leisAcervo`, `leisSync`, `leisPesquisa` e `leisFrontend` (`.test.mjs`).

## Limites conhecidos

- **Nada no acervo:**
  - leis do RJ (a fonte está fora do ar) e decretos federais anteriores a 1988 (ficaram de fora de propósito);
  - jurisprudência dos TRTs, do TRF2 e do TJES: só os tribunais superiores e a TNU.
- **Qualidade do texto:** OCR de lei antiga escaneada pode ter erro. Súmulas do TST vêm do caderno em PDF, com quebras de linha.
- **Citações que a Dra. Vera ainda não lê:**
  - "desta Lei", porque depende do contexto;
  - súmula sem o tribunal ("Súmula 331", sem dizer de qual tribunal), porque é ambígua.
- **A IA da conferência de sentido** pode errar: ela aponta para a Dra. olhar, não decide.

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 21/10/2026 | Claude | Criação do módulo: acervo ctresb/leis, tela com busca, leitor, conferência e fundamentos; Dra. Júlia e Dra. Vera ligadas ao Enzo, à petição inicial, à análise do caso, ao Assistente de IA e ao revisor |

---
◀ [Decision Log](17-decision-log.md)
