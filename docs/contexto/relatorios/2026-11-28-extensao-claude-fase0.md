# 28/11/2026: extensão do CRM para o Claude Desktop (fase 0)

## Pedido
A Jessica quer um MCP do CRM "para que cada usuário possa usar dentro do Claude, produzir lá dentro e ir para o CRM", sem criar atividades novas para os advogados ("advogado é acomodado"). Piloto: **a Dra. Letícia**. Contexto completo na memória do perfil (`project_mcp_claude_advogados`).

## Feito (branch `feat/extensao-claude`)
- **Chaves por pessoa:** `src/services/chavesClaude.ts` (regra) e `chavesClaudeMysql.ts`; tabela `claude_chaves` (migration 195). A chave aparece uma vez, o banco guarda só o sha256. São no máximo 5 ativas por pessoa, revogáveis; parceiro e cliente não geram chave.
- **API do Claude:** `src/routes/claude.ts` em `/api/claude` (autenticação só pela chave): `GET /eu`, `/semana`, `/identificar?texto=&nome=` e `/casos/:id`. Consultas em `src/services/claudeConsultasMysql.ts`, sem CPF, telefone ou endereço. Regras puras em `claudeConsultas.ts`: extração do número do processo e do CPF, e o grau de certeza.
- **Gestão das chaves:** `src/routes/claudeChaves.ts` em `/api/claude-chaves` (cada um vê e revoga só as suas); cartão "🤖 Claude (extensão)" em Configurações (`public/app.js`, `loadClaudePanel`).
- **Extensão:** pasta `extensao-claude/` com o manifesto MCPB 0.2, o servidor MCP (stdio, SDK 1.32.2), 4 ferramentas só leitura e as instruções do escritório (identificar o caso sozinho, não inventar, nunca enviar mensagem a cliente). Guia em `extensao-claude/README.md`.
- Manual: `16-ferramentas-acessos.md` (nova integração) e `17-decision-log.md` (por que chave, e não OAuth, na fase 0). API em `docs/api/rotas.md`.

## Verificado
- Testes novos: `tests/chavesClaude.test.mjs` (5) e `tests/extensaoClaude.test.mjs` (5). Suíte completa: 1699 passaram, 0 falhas. Tipos e lint sem erros.
- `mcpb validate`: manifesto válido. `mcpb pack`: `crm-juridico.mcpb` com 3,1 MB, gerado no scratchpad (não vai para o git).
- Servidor MCP aberto por stdio: inicializa, envia as instruções e lista as 4 ferramentas. A chamada ao CRM de produção deu "Rota não encontrada", o esperado porque a API ainda não está publicada.
- **Publicado** com autorização da Jessica (merge rápido, commit `2b0f8e4`, CI e deploy aprovados).
- **Teste em produção** com chave temporária criada dentro do servidor e revogada e apagada no fim: sem chave ou com chave falsa → 401; `/eu` 200 (admin); `/semana` 200 (11 prazos, 60 tarefas, que é o limite, e 87 intimações a confirmar); `/identificar` pelo nº 5023912-32.2025 → certeza "certo", 1 caso; `/casos/:id` → 3 processos, 1 prazo, 10 movimentações, nenhum CPF; depois de revogar → 401.
- **Não verificado:** a instalação no Claude Desktop da Dra.

## Decisões e porquês
- **Chave, e não OAuth:** os advogados usam o Claude Desktop no Windows com Pro individual. A extensão local vai precisar ler as pastas do computador nas próximas fases. OAuth fica para o conector web e o celular.
- **Só leitura na fase 0:** primeiro provar que a identificação do caso funciona com casos reais. A escrita (protocolo, cumprido, desfazer) vem na fase 1, com rede de segurança.
- **Admin vê os prazos do escritório todo; os outros veem os seus** (`deadlines.user_id`).

## Pendente
- Depois: a Dra. gera a chave, instala o `.mcpb` e desliga o treino no Claude Pro.
- Fase 1: escrita com identificação automática e "desfazer"; resumo diário à Jessica do que o Claude registrou.
- Mover o cartão das chaves para o perfil de cada usuário quando houver outros advogados (hoje está em Configurações).

## Próxima sessão
1. Instalar com a Dra. e testar com 2 ou 3 casos reais.
2. Fase 1: `POST /api/claude/protocolo`, com TDD.

Skills: `codebase-design`, `tdd`, `security-threat-model`, `verification-before-completion`.
