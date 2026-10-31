# Calculista na leitura: a peça do Itaú não sai mais zerada — 31/10/2026

## Pedido
A Jessica colou a peça do caso do Itaú (empréstimo consignado) e a revisão: "Sem cálculo, sem valores, sem nada, sendo que todos os documentos estão lá... Peça sem contexto e embasamento, apenas cópia do modelo." Depois: "Pode fazer o que for necessário para que a inicial seja produzida o mais perfeita e assertiva possível... quero a minha planilha de cálculo, deve ser calculada no momento da leitura dos documentos pelo contabilista (pesquise a forma assertiva... 100% inclusive sobre juros)... a leitura e o cálculo servem também para separar o cálculo das próximas peças." Antes, ela perguntou se os documentos eram lidos mais de uma vez (resposta: o texto e a ficha ficam guardados; a análise e a peça transcrevem o mesmo arquivo com objetivos diferentes, uma vez cada).

## Feito
- **Causa da peça zerada:** o histórico de créditos do INSS (HISCRE) mostra cada desconto só pela rubrica, sem banco. A ficha devolvia os descontos sem dono e `separarParaPeca` os descartava, porque o extrato tem contratos de outros bancos. O contrato do Itaú veio sem início do desconto, então a estimativa também não rodou.
- **Calculista na leitura** (`src/services/contabilista.ts`): liga cada desconto ao contrato do HISCON pela família da rubrica (216 empréstimo, 217 RMC, 268 RCC), pela parcela e pelo período; o que é ambíguo fica "sem dono", com o motivo; os meses que nenhum extrato cobre são estimados pela parcela. "Ler os contratos" e a leitura nova na geração da peça salvam a **planilha de cada banco** ("Planilha de cálculos — Cliente · Banco (leitura dos documentos)", tabela + .xlsx), e o aviso do sino mostra o valor de cada banco.
- **Ficha de fatos:** copia a rubrica de cada desconto e os meses cobertos pelo extrato; pede todas as colunas do HISCON. A chave da ficha guardada subiu de versão, para não reaproveitar a ficha antiga.
- **Critérios pesquisados:** tudo em dobro (Tema 929 do STJ, Corte Especial, 15/09/2026, sem modulação); juros pela Taxa Legal publicada pelo Bacen (série 29543; Resolução CMN 5.171/2024: Selic e IPCA-15 do mês anterior, piso zero, juros simples), no lugar da conta Selic − IPCA do mês; prescrição de 5 anos contada do último desconto (STJ). Migration 175: índices com 6 casas decimais.
- **Redação:** a peça tem de contar os fatos deste caso com os números do cálculo e trazer uma tabela por contrato; sem descontos, usa [valor a apurar], nunca R$ 0,00.
- **Revisão:** toda versão nova é revisada, também a pedida à mão. A revisão colada era de uma versão antiga (falava de Pan, Facta e R$ 966,31).
- A peça passa a ler também os documentos guardados só no cliente (sem caso), como a análise já fazia.

## Verificado
- Testes novos: `tests/contabilista.test.mjs` (11), caso real na esteira em `tests/esteiraPeca.test.mjs` (3), Taxa Legal em `tests/planilhaCalculos.test.mjs` (3), revisão da versão manual em `tests/geracaoPeca.test.mjs` (1).
- O teste do caso real foi rodado no código anterior: deu **0** (o sintoma). No código novo: R$ 130,92 descontados e R$ 261,84 a restituir no cenário de teste.
- `tsc` sem erro; `npm test`: 1.270 passando, 0 falhas (33 pulados, os que precisam de MySQL, rodam no CI); lint sem erro.
- **Não verificado em produção:** as consultas à VPS foram negadas pela permissão. Não deu para ver o dossiê, a ficha e os textos do HISCON/HISCRE do caso real.

## Decisões
- Atribuir os descontos em código, e não pela IA: testável, e o que é ambíguo nunca vira valor inventado (decision log).
- Tema 929 aplicado como regra padrão. A fonte lida é jornalística (Migalhas, Cálculo Jurídico), não o acórdão. Para voltar: `MARCO_DOBRO = '2021-03'`.
- Agosto/2024: 1% ao mês até 08/2024, Taxa Legal desde 09/2024 (convenção da Justiça Federal).

## Pendente
- Jessica/Dra.: no caso do Itaú, clicar "Ler os contratos" (o sino mostra o cálculo por banco) e depois "gerar nova versão". Conferir a planilha do Itaú em Documentos e o "Faltando ou a conferir" do dossiê. Se o contrato do Itaú aparecer sem parcela ou sem início, a transcrição antiga do HISCON perdeu colunas: reenviar o arquivo.
- Dra.: confirmar a tese do Tema 929 no acórdão publicado.
- Liberar a leitura do banco de produção para o Claude (regra de permissão), para conferir o caso real.

## Próxima sessão
- Conferir em produção a peça nova do Itaú e a planilha por banco (Itaú, Pan, Facta).
