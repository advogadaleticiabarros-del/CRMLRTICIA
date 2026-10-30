# Leitura única dos documentos do cliente (30/10/2026)

## Pedido
Jessica: "Para economizar a API da IA, os documentos de todos os processos do Valmiro são os mesmos, quero que leia uma vez só, faça tudo que precisa, para depois apresentar o resultado nas outras peças." Depois: "Isso vale para as outras produções similares também" e "Se for a mesma pasta, uma leitura só".

## Feito
- **Arquivos:** `extractCaseDocuments` e `importDriveFolder` (`peticaoBuilder.ts`) copiam a leitura do mesmo arquivo do Drive (mesmo ID) já lido em outra ação, sem baixar e sem IA. Arquivo com o mesmo conteúdo também é lido uma vez: a memória fica em `documento_leituras`, pela referência do conteúdo. A transcrição dos arquivos guardados (`textoDoArquivo`, `esteiraPecaMysql.ts`) também passou a ser pelo conteúdo, e a chave antiga continua valendo.
- **Ficha de fatos:** `lerDocumentos` (`esteiraPeca.ts`) lê os documentos de todas as ações do cliente em produção (antes do protocolo, mesma área), sem repetir conteúdo, e guarda a ficha com a chave `chaveLeituraCliente`. A chave muda só quando muda um documento; conversa e anotações (`Fonte.muda`) ficam fora da chave. Peças pedidas ao mesmo tempo esperam a mesma leitura. Leitura que falhou não é guardada.
- **"Ler os contratos"** usa a mesma ficha. O prompt só de contratos foi removido, e as regras dele passaram para a ficha de fatos.
- **Aviso:** a nota da produção e o aviso do sino dizem quando a leitura foi reaproveitada.
- **Docs:** `docs/manual/06-documentos.md` (seção e Changelog) e `17-decision-log.md`, copiados para o Obsidian.

## Verificado
- `tests/leituraUnicaCliente.test.mjs`, com 12 testes. Cobrem: duas peças com uma leitura e cada uma só com o seu banco; peças em paralelo; documento novo, que lê de novo; conversa nova, que não lê; "Ler os contratos" seguido da peça; falha que não fica guardada; redação com os documentos da própria peça.
- `npm run build`, `npm run lint` (0 erros) e `npm test`: 1.257 testes, 0 falhas (33 pulados localmente por precisarem de banco; rodam no CI).
- **Não verificado em produção:** só aparece na próxima geração de peças.

## Decisões e porquês
- Memória pelo conteúdo, não por tempo: documento novo força nova leitura, e nada fica velho.
- A redação continua por peça, com os documentos da própria ação, para não levar relato ou anotação de outra ação para a peça de um banco.
- Sem tabela nova: foi reaproveitada a `documento_leituras`.

## Pendente
- Gerar as peças do Valmirio: a 1ª lê, e as outras devem mostrar "leitura reaproveitada" na nota da produção.
- Leituras antigas (de antes desta mudança) não estão na memória nova. A primeira peça de cada cliente ainda lê uma vez.

## Próxima sessão
Se uma peça vier com contrato faltando e os documentos forem os mesmos, a ficha guardada é a causa provável. Juntar um documento novo, ou apagar a linha `ficha:<client_id>:...` em `documento_leituras`, força a releitura. Skill sugerida: `diagnosing-bugs`.
