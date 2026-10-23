# Relatório — Data de chegada dos e-mails da parceria

**Data:** 23/10/2026

## Pedido
Na fila "Importados do e-mail — aguardando revisão", a Jessica quer ver a data em que o e-mail chegou.

## Feito
- O CRM não guardava essa data, só a da importação. Coluna nova `email_imports.received_at` (migration 170).
- Os dois caminhos de importação do Gmail gravam a data de chegada (`internalDate`).
- `completarDatasDeChegada` preenche os e-mails pendentes que entraram antes, com uma consulta leve ao Gmail feita ao abrir a fila.
- A tela ganhou a coluna "Chegou em" (dia e hora de Brasília), ordenada do mais novo para o mais antigo. Sem data do Gmail, mostra a data da importação com "importado em".

## Verificado
- 3 testes novos (auditoria do SQL, gravação nos dois caminhos, coluna na tela); suíte inteira sem falhas; lint sem erros.
- Não foi testado com o Gmail real localmente: a conferência é no CRM depois do deploy.

## Pendente
- Nenhum.
