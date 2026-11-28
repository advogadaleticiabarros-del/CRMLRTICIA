# 28/11/2026: lista de documentos das petições pelo MNI (TJES)

## Pedido
A Jessica perguntou se o CRM, que já acessa o TJES, conseguiria "ler e falar se os prazos já foram cumpridos e baixá-los automático, rodando uma rotina também". Ela aprovou a opção 2: a consulta passa pela ponte do escritório e a senha não sai do servidor.

Contexto da mesma conversa, só planejamento, sem código: a extensão do CRM para o Claude Desktop dos advogados. Eles usam Pro individual e Windows, e o Claude registraria sozinho o protocolo, o prazo cumprido e os casos parecidos. O plano está na memória do perfil (`project_mcp_claude_advogados.md`).

## Feito
- **Achado:** pelo MNI, o PJe do TJES manda o movimento de juntada só como "Petição" (código 85), sem tipo e sem autor. Na base havia 101 movimentos "Petição" vindos do MNI. Por isso a regra da Dra. Paula (`agentePrazos.ts`, `avaliarCumprimento`) quase nunca dá "cumprido": o texto não cita a Dra., a OAB nem o cliente.
- `src/services/mni/cliente.ts`: novos `DocumentoMni`, `lerDocumentos()` e o método opcional `documentosDoProcesso()`. É um `consultarProcesso` com `incluirDocumentos=true` e `movimentos=false`. O `<conteudo>` e a assinatura digital são descartados, o CPF de quem assinou é mascarado e `assinadoPeloLogin` diz se quem assinou foi o dono do login (a Dra.).
- `src/services/mni/monitorMni.ts`: `precisaLerDocumentos()` cobre petições dos últimos 30 dias, mais novas que a última leitura. Na rodada, são no máximo 15 processos. Uma falha não derruba a rodada; login recusado para o sistema, como nas outras consultas.
- `src/services/mni/index.ts`: `documentosLidosAte` e `guardarDocumentos`, gravando em `mni_documentos`.
- `migrations/192_mni_documentos.sql`: tabela `mni_documentos` e a coluna `legal_processes.mni_documentos_ate`.
- Testes: `tests/mniDocumentos.test.mjs` (7 testes).
- Manual: `docs/manual/10-monitoramento.md`, na seção "Lista de documentos das petições" e no changelog.

## Verificado
- `npx tsc --noEmit`: sem erros. `npm run lint`: 0 erros (os avisos já existiam).
- `npm test`: 1714 testes, 1680 passaram, 0 falhas. Os que precisam de banco rodam no CI.
- **Não verificado ainda:** o formato real que o TJES devolve, ou seja, se vem a descrição ("Réplica") e o `signatarioLogin`. Isso só aparece depois da primeira rodada do MNI em produção com o computador do escritório ligado.

## Decisões e porquês
- **Primeira tentativa bloqueada:** abrir a senha do MNI na VPS e enviar o pedido deste computador foi barrado pelo filtro de permissões (risco de vazamento de credencial). A Jessica escolheu o caminho pelo próprio CRM, pela ponte. A senha não sai do servidor e o resultado já serve de base para a baixa automática.
- **Por que dentro da rodada, e não numa rota de teste:** uma rota exigiria forjar uma sessão de administrador para chamá-la. Dentro da rodada não há tela nova nem token.
- **Lista, nunca conteúdo:** pedir a lista de documentos não dá ciência (isso só acontece com `consultarTeorComunicacao`, que continua proibido pelo teste em `mniTribunais.test.mjs`).
- **A regra da Dra. Paula ainda não usa os dados:** baixar errado esconde um prazo aberto, então primeiro é preciso conferir o formato real.

## Pendente
- **Conferir depois da próxima rodada do MNI** (com o computador do escritório ligado): ler `mni_documentos` dos processos 5023912-32.2025.8.08.0012, 5016872-62.2026.8.08.0012 e 5029177-15.2025.8.08.0012.
- Se vierem a descrição e quem assinou: incluir na regra da Dra. Paula "petição de tipo compatível, juntada depois da intimação e assinada pela Dra. → cumprido". Ligar a conferência de prazos ao fim da rodada do MNI.
- Advogados do escritório que não são a Dra.: hoje só o CPF do login é reconhecido. Decidir como reconhecer os outros (Jessica).
- Extensão do Claude Desktop (plano aprovado na conversa): começar pelas fases 0 e 1, protocolo por print com identificação automática do caso. Falta o nome do advogado piloto (Jessica).

## Próxima sessão
1. `SELECT process_id, data_hora, tipo, tipo_local, descricao, assinado_pelo_login, dados_json FROM mni_documentos ORDER BY id DESC LIMIT 30` na VPS. Compare com o que se sabe dos três processos.
2. Com o formato confirmado, aplique TDD em `avaliarCumprimento`, usando a nova prova.

Skills sugeridas: `tdd`, `domain-modeling`, `verification-before-completion`.
