# 31/10/2026 — "Sobre o caso" do card do cliente pelo que foi lido

## Pedido
Jessica, com print do card do Valmirio: "busque contexto para fazer esse sobre o caso, não é só banco Itaú, está errado... aja como um desenvolvedor com base em advocacia profissional". O bloco mostrava "Descontos indevidos... pelo Banco Itaú S.A. · Tipo: empréstimo consignado" num caso com 6 bancos.

## Causa
A 1ª versão do bloco (commit 07f9482, mais cedo no mesmo dia) usava a descrição da primeira ação. Essa descrição foi gerada pela IA a partir do e-mail do parceiro, uma por banco, e descreve só aquela ação.

## Feito
- **Síntese do cliente inteiro** (`src/services/sinteseCaso.ts`, regra pura; `sinteseCasoMysql.ts`, banco), montada no `carregarLote`:
  - parágrafo de síntese: contratos e instituições do extrato de empréstimos do INSS, por tipo; ações; instituição sem ação; parceria e data de chegada;
  - relato do cliente no atendimento (lead, sem a senha do Meu INSS); a descrição das ações nunca é usada;
  - por instituição: ação e situação, cada contrato (nº, inclusão, parcela × quantidade, início/fim do desconto, situação) e os descontos lidos no benefício (total, meses, período), ligados pelo Calculista (`apurarFicha`); estimados à parte;
  - pontos de fato da triagem, pedidos do cliente, linha do tempo, o que falta apurar, alertas (banco com contrato e sem ação; ação sem contrato no extrato).
- **Defeito achado ao refazer:** `nucleoBanco` reduzia todo "Banco do Estado de ..." a "estado". O contrato do Banrisul (nome jurídico no extrato) não batia com a ação, e Banrisul, Banese e Banpará eram tratados como o mesmo banco na conferência por banco e na escolha dos contratos de cada peça. Agora há uma tabela de nomes jurídicos (Banrisul, Banese, Banpará, Banestes, BRB, BNB, Basa, Caixa, Sicredi, Sicoob).
- Tela (`public/loteCliente.js`, `styles.css`): bloco "Sobre o caso" refeito com essas partes.

## Verificado
- `npm run build` OK; lint com 0 erros; `npm test`: 1.298 passando, 0 falhas (33 pulados, que precisam de banco e rodam no CI).
- Testes novos: `tests/sinteseCaso.test.mjs` (7) e um em `contratosDoCaso` (nomes jurídicos e bancos estaduais que não se confundem).
- Tela conferida com print local (6 bancos fictícios, `montarLote` e `sintetizarCaso` reais), sem erro no console. O print mostrou o defeito do Banrisul antes da correção.
- **Não verificado em produção:** a consulta ao banco da VPS foi negada pela permissão. Não sei se o Valmirio já tem contratos lidos (`cliente_contratos`) e a ficha de fatos guardada; sem eles a síntese diz que os contratos ainda não foram lidos.

## Decisões e porquês
- Síntese pelas regras, sem IA: instantânea, sem custo e sem inventar. O que não foi lido aparece como "ainda não lido".
- O relato só vem do atendimento (lead); a descrição por banco das ações descreve uma parte como se fosse o todo.

## Pendente
- Jessica: abrir o card do Valmirio. Se a síntese disser que os contratos ainda não foram lidos, clicar "Ler os contratos" na mesa de uma das ações e abrir o card de novo.
- Conferir se o nome de cada banco do extrato bate com a ação (alerta "sem ação" / "nenhum contrato deste banco").

## Próxima sessão
- Se aparecer outro banco com nome jurídico diferente do nome da ação, acrescentar em `APELIDOS` (`contratosDoCaso.ts`) com teste. Skills: `diagnosing-bugs`, `tdd`.
