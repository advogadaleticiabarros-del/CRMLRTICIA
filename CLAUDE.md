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
