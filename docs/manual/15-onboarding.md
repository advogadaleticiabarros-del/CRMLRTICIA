# 15 · Onboarding — primeiro dia no sistema

**Área:** Sistema · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 04/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que um perfil de acesso novo for criado, ou o fluxo de primeiro login mudar

## TL;DR

Guia pra quem está entrando no sistema pela primeira vez — a assistente Jessica, um(a) estagiário(a) novo(a), ou um parceiro. O que logar, o que olhar primeiro, e o que cada perfil normalmente faz no dia a dia.

## Contexto

Consulte quando alguém novo entrar no escritório (ou no time de parceiros) e precisar se orientar sozinho no CRM, sem alguém do lado explicando tela por tela.

## Antes de começar

Alguém com perfil `admin` (hoje, a Dra. Letícia) precisa criar o seu usuário primeiro — não existe autocadastro. Você vai receber um e-mail/telefone de acesso e uma senha inicial. Recomendado ativar 2FA (senha + código do celular, ou biometria em dispositivo compatível) assim que entrar — ver [Usuários e acesso](12-usuarios.md).

## Primeiras tarefas por perfil

### Se você é `advogado(a)` ou `estagiario(a)` — atendimento e processos
1. Abra **Clientes** e dê uma olhada em como uma ficha completa se parece (processo, financeiro, documentos, linha do tempo, tudo num lugar).
2. Abra **WhatsApp** — é o canal principal de contato com cliente. Familiarize-se com as 4 abas (Todas/Não lidas/Em atendimento/Finalizadas) e onde ficam as notas internas (painel da direita, nunca visível pro cliente).
3. Veja **Processos e prazos** — note que boa parte aparece sozinha (descoberta automática por OAB), você não precisa cadastrar tudo na mão.
4. Confira se está recebendo o **briefing diário** (e-mail 7h, WhatsApp 8h) — é o resumo do que precisa de atenção naquele dia.

### Se você é `comercial` — funil de leads
1. Abra **Leads** — veja o quadro Kanban e as 12 etapas.
2. Entenda a regra: mover um lead pra "Perdido" **exige** escolher um motivo — não dá pra pular essa etapa.
3. Saiba que mensagens de recusa/despedida saem sozinhas pro lead quando ele é movido pra "Perdido"/"Proposta Recusada" — você não precisa (nem deve) mandar manualmente de novo.

### Se você é `parceiro`/`parceiro_portal`
1. Seu acesso é restrito ao **portal do parceiro** — você só vê seus próprios casos, pendências e valores, nunca dados de outros clientes ou parceiros.
2. Confira seu percentual combinado (êxito, split, sucumbência) na tela `/me` do portal.

### Se você é `admin`
Além de tudo acima, você é quem cria usuário novo, ajusta permissão, e é quem decide sobre ações irreversíveis (excluir cadastro, mudar integração externa). Ver [Usuários e acesso](12-usuarios.md) e [Ferramentas e acessos](16-ferramentas-acessos.md).

## Quem é quem (04/09/2026)

| Pessoa | Papel |
|---|---|
| Dra. Letícia Barros | Advogada titular, `admin`, dona do produto |
| Jessica | Assistente — recebe avisos de alto valor no WhatsApp (nomeação dativa, sentença/acórdão) junto com a Letícia |

## O que NÃO fazer sem perguntar

- Não exclua um cadastro (cliente, processo, demanda dativa) sem certeza — a maioria das exclusões não tem "desfazer".
- Não mexa em integrações externas (Google Calendar, Asaas, WhatsApp/Uazapi) sem saber o que está conectado — ver [Ferramentas e acessos](16-ferramentas-acessos.md) antes.
- Não desative 2FA de outra pessoa sem confirmar com ela antes.

## FAQ

**Esqueci a senha, o que faço?** Fluxo de recuperação existe (ver tela de login) — se envolver 2FA perdido, precisa de um `admin` pra resetar.

**Posso pedir pra IA (Claude) fazer uma mudança direto no sistema?** Sim, é assim que este CRM é mantido — mas mudanças em produção (banco, servidor) sempre passam por confirmação explícita seguindo as regras de segurança do projeto.

## Links relacionados
- [Usuários e acesso](12-usuarios.md)
- [Ferramentas e acessos](16-ferramentas-acessos.md)
- [Runbook](14-runbook.md) — se algo der errado

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 04/09/2026 | Claude | Criação do documento |

---
◀ [Runbook](14-runbook.md) · [Visão geral](00-visao-geral.md) · Próximo: [Ferramentas e acessos](16-ferramentas-acessos.md) ▶
