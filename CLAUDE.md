## Uso obrigatório das skills

Antes de iniciar qualquer tarefa, analise quais skills instaladas são realmente aplicáveis. Ative somente as necessárias para a tarefa atual. Não use todas simultaneamente.

### Design e interface

- Use `frontend-design` ao criar ou redesenhar telas, dashboards, kanbans, formulários, tabelas, menus, páginas e componentes visuais. A interface deve ter identidade própria, aparência empresarial e não parecer um template genérico produzido por IA.

- Use `web-design-guidelines` ao criar, revisar ou finalizar qualquer interface. Verifique acessibilidade, contraste, responsividade, hierarquia, espaçamento, formulários, estados de erro, carregamento e interação.

- Use `vercel-react-best-practices` sempre que criar, revisar ou modificar código React, independentemente da hospedagem utilizada. Verifique desempenho, requisições, renderizações desnecessárias, carregamento e tamanho dos componentes.

- Use `vercel-composition-patterns` quando criar ou refatorar componentes React reutilizáveis, especialmente tabelas, filtros, formulários, modais, dashboards e componentes com muitas propriedades ou responsabilidades.

### Arquitetura e regras de negócio

- Use `domain-modeling` ao criar ou alterar entidades, relacionamentos, regras de negócio, bancos de dados ou fluxos envolvendo clientes, processos, contratos, parcelas, receitas, pagamentos, repasses, acordos, dativos, parcerias, correspondentes e usuários. Antes de modificar, identifique a fonte verdadeira de cada informação e evite duplicidade de regras.

- Use `improve-codebase-architecture`, caso esteja instalada, somente quando houver pedido de análise arquitetural, refatoração ampla, módulos excessivamente acoplados, duplicidade de serviços ou dificuldade de manutenção. Não faça grandes refatorações sem explicar impactos e riscos.

### Erros e correções

- Use `diagnosing-bugs` sempre que houver erro, comportamento inesperado, falha de integração, divergência financeira ou funcionalidade que parou de funcionar. Primeiro reproduza e identifique a causa raiz. Não faça alterações por tentativa e erro.

- Antes de corrigir um bug, registre:
  1. comportamento esperado;
  2. comportamento encontrado;
  3. causa provável;
  4. arquivos envolvidos;
  5. risco da alteração;
  6. forma de verificar a correção.

### Testes e validação

- Use `tdd` ao desenvolver regras críticas relacionadas a valores, parcelas, pagamentos, vencimentos, permissões, autenticação, webhooks, integrações, cálculos e movimentações financeiras. Não é obrigatório para pequenos ajustes exclusivamente visuais.

- Use `webapp-testing` quando for necessário testar fluxos reais no navegador, como login, cadastro, edição, filtros, pesquisas, formulários, pagamentos, kanban, responsividade e permissões.

- Use `verification-before-completion` antes de afirmar que qualquer tarefa foi concluída. Execute os testes, build, lint e verificações aplicáveis. Nunca informe que algo funciona sem evidência recente.

### Banco de dados

- Use `supabase-postgres-best-practices` ao criar ou alterar tabelas, migrations, consultas SQL, índices, relacionamentos, políticas de acesso, funções, triggers ou rotinas de banco de dados. A skill deve ser usada para Postgres mesmo que o sistema não esteja hospedado no Supabase.

- Antes de alterar o banco:
  1. verifique a estrutura existente;
  2. analise compatibilidade com dados atuais;
  3. evite perda de dados;
  4. apresente estratégia de migration;
  5. verifique índices, permissões e desempenho;
  6. não execute operação destrutiva sem autorização.

### Segurança

- Use `security-threat-model` ao implementar ou revisar autenticação, permissões, documentos, dados pessoais, dados jurídicos, financeiro, APIs, webhooks, integrações externas, uploads, sessões e acessos administrativos.

- Verifique especialmente:
  - separação de dados entre usuários e organizações;
  - controle de acesso por função;
  - exposição de dados pessoais;
  - LGPD;
  - vazamento de tokens e credenciais;
  - validação de webhooks;
  - uploads maliciosos;
  - SQL injection;
  - XSS;
  - acesso indevido a documentos;
  - registros de auditoria.

### Combinações recomendadas

- Nova tela ou redesign:
  `frontend-design` + `web-design-guidelines` + `vercel-react-best-practices`.

- Componente React complexo:
  `vercel-react-best-practices` + `vercel-composition-patterns`.

- Nova funcionalidade com regras de negócio:
  `domain-modeling` + `tdd` + `verification-before-completion`.

- Erro em produção:
  `diagnosing-bugs` + `verification-before-completion`.

- Alteração financeira:
  `domain-modeling` + `tdd` + `supabase-postgres-best-practices` + `verification-before-completion`.

- Integração com API ou webhook:
  `domain-modeling` + `security-threat-model` + `tdd` + `verification-before-completion`.

- Alteração no banco de dados:
  `supabase-postgres-best-practices` + `security-threat-model` + `verification-before-completion`.

- Revisão completa de uma funcionalidade:
  skill específica da área + `webapp-testing` + `verification-before-completion`.

### Procedimento obrigatório

Ao iniciar uma tarefa, informe brevemente:

"Skills ativadas: [nomes das skills] — Motivo: [justificativa]."

Se nenhuma skill for necessária, informe:

"Nenhuma skill especializada precisa ser ativada para esta tarefa."

Ao finalizar, apresente:
- skills utilizadas;
- arquivos modificados;
- testes executados;
- resultado do build;
- riscos ou pendências existentes.

Não considere uma tarefa concluída se houver erro de build, teste não executado, migration não validada ou comportamento não verificado.

### Documentação obrigatória (auto-manutenção, sem precisar pedir)

A pasta `docs/manual/` é a documentação viva do sistema (13 blocos de módulo + visão geral, fluxograma, runbook, onboarding, ferramentas/acessos, decision log — ver `docs/manual/00-visao-geral.md` pro mapa completo). A partir de 04/09/2026, ela precisa ser mantida em dia **junto** de qualquer alteração real no sistema, na mesma tarefa, sem que a usuária precise pedir ou invocar a skill de documentação — isso vale pra qualquer sessão, humana ou IA, que mexer neste repositório.

Sempre que uma tarefa:
- **mudar comportamento** de um módulo (nova regra, novo campo, fluxo alterado) → atualize o bloco correspondente em `docs/manual/` (conteúdo + linha do Changelog daquele arquivo) na mesma sessão, antes de considerar a tarefa concluída.
- **corrigir um bug ou incidente real** (algo que já estava quebrado em produção, não um ajuste de código ainda não lançado) → registre em `docs/manual/14-runbook.md`: sintoma observado, causa raiz, correção aplicada, e como qualquer pessoa ou IA reconhece e resolve se acontecer de novo. Isso vale mesmo pra correções pequenas — o pedido explícito da usuária foi "qualquer vírgula, erro e correção de erro deve ser documentado".
- **adicionar/remover uma integração, ferramenta ou acesso externo** → atualize `docs/manual/16-ferramentas-acessos.md`.
- **envolver uma decisão de arquitetura/produto não óbvia** (por que X em vez de Y) → adicione uma linha em `docs/manual/17-decision-log.md`.

Isso não é uma skill a mais pra ativar — é parte de terminar a tarefa, igual a rodar teste ou build. Ao apresentar o resumo final da tarefa (linha 106-111 acima), inclua também: **documentação atualizada** (qual arquivo, ou "não se aplicava — mudança sem impacto documentável").
