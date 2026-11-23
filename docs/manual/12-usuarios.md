# 12 · Usuários e acesso

**Área:** Sistema · **Autor:** Claude (levantado do código-fonte) · **Última atualização:** 03/09/2026 · **Versão:** 1.0 · **Status:** publicado · **Responsável:** Dra. Letícia Barros (dono do produto) · **Revisão:** atualizar sempre que o módulo mudar de comportamento

## TL;DR

Sete perfis de acesso diferentes, login com senha + 2FA opcional (TOTP ou biometria/Face ID via WebAuthn), proteção contra tentativa de força bruta, e permissões de navegador (câmera/microfone/localização) liberadas só onde o sistema realmente precisa.

## Contexto

Consulte pra entender o que cada perfil de usuário pode ver/fazer, como funciona o login com 2FA, ou por que uma permissão do navegador (câmera, microfone, localização) está ou não disponível numa tela.

## Perfis de acesso

| Perfil | Uso |
|---|---|
| `admin` | Acesso completo — só a Dra. Letícia e quem ela designar |
| `advogado` | Operação normal do escritório |
| `estagiario` | Acesso de apoio, sem as ações mais sensíveis |
| `comercial` | Foco no funil de leads/propostas |
| `parceiro` | Advogado/escritório parceiro (ver [Repasses e parcerias](09-repasses.md)). Sem acesso às conversas de WhatsApp (desde 30/09/2026) |
| `parceiro_portal` | Acesso ao portal do parceiro especificamente |
| `cliente` | Perfil reservado para acesso futuro de cliente (portal do cliente) |

## Login e segurança

- **Senha + 2FA opcional**: quem ativa autenticação de dois fatores precisa confirmar um código TOTP (aplicativo autenticador) depois da senha.
- **Login por biometria (WebAuthn)**: em dispositivos compatíveis, dá pra entrar com Face ID/impressão digital/chave de segurança em vez de senha.
- **Proteção contra força bruta**: 5 tentativas erradas de senha por IP+e-mail em 15 minutos bloqueiam novas tentativas por 15 minutos. Desde 23/11/2026 o IP é o real (vem do nginx). Antes, quem forjasse o cabeçalho `X-Forwarded-For` trocava de IP a cada tentativa. Quando o e-mail não existe, o login demora o mesmo tempo, para não revelar quem tem conta.
- **Política de senha (desde 23/11/2026)**: vale em todo lugar que grava senha (cadastro, troca, redefinição por e-mail, admin). Regras: de 10 a 128 caracteres; 3 dos 4 tipos (minúscula, maiúscula, número, símbolo), ou uma frase com 16 ou mais caracteres; nada de senha comum (nem "Senha@2026"); nada de sequência ou repetição ("1234", "aaaa"); nada do nome ou do e-mail da pessoa. A regra fica em `src/services/senhaForte.ts`. A senha temporária gerada pelo admin ou pelo portal do cliente tem 14 caracteres e sai de um gerador criptográfico (antes era `Math.random`). O hash é bcrypt com custo 12. Senhas antigas continuam valendo até a próxima troca.
- **Sessão que cai na hora (desde 23/11/2026)**: o login dura 24 h e se renova com o uso. Agora, a cada pedido, o servidor confere se o usuário continua ativo e se a sessão não foi encerrada (`users.token_version`, `src/services/sessaoUsuario.ts`, com 30 s em memória). Trocar ou redefinir a senha, ser desativado ou mudar de papel derruba **todos os aparelhos**. Quem trocou a própria senha continua logado só no aparelho em que trocou. Também existe a rota `POST /api/auth/sair-de-todos`. Antes, um usuário desativado seguia entrando com o token antigo, para sempre, por causa da renovação automática.
- **Passes temporários não valem como login**: o passe da 2ª etapa (2FA), o de Face ID e o das conexões Google usam o mesmo segredo do login. Desde 23/11/2026 o servidor recusa esses passes como sessão.
- **Crédito na tela de login (desde 23/11/2026)**: abaixo do aviso dos Termos aparece a logo da Orbit (`public/orbit-logo.webp`, recortada da arte da Agenda, só o símbolo e o nome) e "Desenvolvido por Orbit Desenvolvimento" (`public/index.html`, classe `.login-credito`).
- **Termos de Uso e Política de Privacidade (desde 23/11/2026)**: todo usuário (equipe, cliente, parceiro) aceita a versão vigente no primeiro acesso. Até aceitar, o servidor recusa as rotas (403 `TERMOS_PENDENTES`) e a tela de aceite fica por cima de tudo, sem botão de fechar (só "Sair"). Cada aceite fica em `termos_aceites` (quem, versão, quando, IP, navegador). Textos em `/termos.html` e `/privacidade.html`. Para pedir novo aceite de todos, suba `TERMOS_VERSAO` em `src/services/termos.ts` e a versão escrita nas duas páginas (um teste confere se batem).

## Permissões de navegador

O sistema libera explicitamente, só para o próprio domínio: **microfone** (gravação de áudio no WhatsApp) e **geolocalização** (prova de onde a assinatura eletrônica foi feita — importante juridicamente). Câmera de página (captura ao vivo dentro do navegador) fica bloqueada — o upload de documento "por câmera" no Dativo usa o seletor nativo de câmera do celular, não uma captura ao vivo na página, por isso não depende dessa permissão.

## FAQ

**Um estagiário vê o financeiro do escritório?** Depende da tela específica — o perfil `estagiario` tem acesso de apoio, sem as ações mais sensíveis, mas o detalhe exato de cada tela pode variar; consulte o módulo específico se precisar confirmar.

**Dá pra ter mais de um admin?** Sim, não há limite técnico — é uma decisão de quem a Dra. Letícia autoriza.

**Perder o celular com o autenticador 2FA trava o acesso?** Sim, seria necessário um admin resetar o 2FA da conta — não documentado um fluxo de recuperação de auto-atendimento.

## Links relacionados
- [Repasses e parcerias](09-repasses.md) — perfil parceiro
- [Onde tudo roda](13-infraestrutura.md) — segurança de infraestrutura

## Changelog

| Data | Autor | Mudança |
|---|---|---|
| 23/11/2026 | Claude | Tela de login com a logo da Orbit e o crédito "Desenvolvido por Orbit Desenvolvimento" |
| 23/11/2026 | Claude | Política de senha, sessão derrubável, passes temporários recusados, aceite de Termos e Política de Privacidade |
| 30/09/2026 | Claude | Perfil parceiro sem acesso ao WhatsApp |
| 03/09/2026 | Claude | Criação do documento |

---
◀ [Briefing diário](11-briefing.md) · [Visão geral](00-visao-geral.md) · Próximo: [Onde tudo roda](13-infraestrutura.md) ▶
