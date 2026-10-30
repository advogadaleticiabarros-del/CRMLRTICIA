# Demonstrativo de descontos (30/10/2026)

## Pedido
Jessica: "os extratos sejam analisados e separados os dados de cada uma das peças, exemplo RCC e RMC, tudo que já foi descontado, o número do contrato citado... uma planilha com os descontos... Planilha com PDF (um demonstrativo do que foi descontado)". Depois ela esclareceu: "o extrato original vai também no protocolo, é só um demonstrativo separado para base de cálculo também do valor da causa, além da demonstração individual do que foi descontado até agora".

## Feito
- **Módulo novo `src/services/demonstrativoDescontos.ts`:** `montarDemonstrativo` agrupa os descontos da peça por contrato (nº, Cartão RMC/RCC/empréstimo, banco, inclusão, meses, período, total) e monta a base do valor da causa. `demonstrativoMarkdown` gera a versão de tela; `demonstrativoPdf` (pdfkit) gera o anexo.
- **`peticaoBuilder.ts`:** a cada versão da peça, salva "Demonstrativo de descontos — Cliente (vN)", com o PDF em `documents.data`, a partir do mesmo `CalculoPeca` e dos contratos que entraram na peça (`r.ficha.contratos`, `r.fora`).
- **`loteProducao.ts`:** o tipo novo `demonstrativo` vai no kit da ação na posição 13, antes da planilha (14); "outro" passou a 15. No kit entra só a versão mais nova.
- **`routes/mesa.ts` + `public/mesa.js`:** botão "Baixar demonstrativo de descontos (PDF)" na aba Cálculos da mesa.
- **`esteiraPecaMysql.ts` e `peticaoReviewer.ts`:** o demonstrativo não é lido como fonte nem revisado como petição.
- **Documentação:** `docs/manual/06-documentos.md` (bloco + Changelog) e `17-decision-log.md`, copiados para o Obsidian.

## Verificado
- Teste novo `tests/demonstrativoDescontos.test.mjs` (9 casos), escrito antes do código.
- `npm run build` ok. `npm test`: 1.166 passaram, 0 falharam, 33 pulados (os de banco, que rodam no CI). ESLint sem avisos nos arquivos alterados.
- Um PDF de exemplo com dados fictícios foi gerado e conferido visualmente (3 páginas, cabeçalho repetido, rodapé com página).
- **Não verificado em produção:** nenhuma peça foi regerada. O demonstrativo aparece na próxima "gerar nova versão".

## Decisões e porquês
- **Documento gerado, não recorte do extrato:** um documento oficial recortado pode ser contestado. O extrato vai inteiro no protocolo (confirmado pela Jessica).
- **Mesmo cálculo da peça:** demonstrativo, planilha e petição não podem divergir.
- **"Ficaram fora" só na tela:** o PDF de protocolo não cita outros bancos.

## Pendente
- **Leitura determinística do HISCON + HISCRE** (rubricas 217 RMC, 268 RCC, 216 consignado, ligadas ao contrato ativo no HISCON): proposta, ainda não feita. Hoje a leitura é pela IA. Precisa de extratos reais de exemplo para os testes, com dados trocados por fictícios.
- **Caso dos 6 bancos / Valmirio:** falta juntar o HISCON (extrato de empréstimos do Meu INSS). Sem ele, os descontos não se ligam ao banco. Quem resolve: Jessica.
- Juros desde cada desconto ou desde a citação: decisão da Dra./Jessica (aberta desde 28/10).

## Próxima sessão
Gerar uma nova versão da peça de um caso com extrato completo e conferir o PDF no kit. Se a Jessica quiser, começar o leitor do HISCON/HISCRE com `tdd` + `codebase-design`.
