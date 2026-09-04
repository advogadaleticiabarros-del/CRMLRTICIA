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
| `parceiro` | Advogado/escritório parceiro (ver [Repasses e parcerias](09-repasses.md)) |
| `parceiro_portal` | Acesso ao portal do parceiro especificamente |
| `cliente` | Perfil reservado para acesso futuro de cliente (portal do cliente) |

## Login e segurança

- **Senha + 2FA opcional**: quem ativa autenticação de dois fatores precisa confirmar um código TOTP (aplicativo autenticador) depois da senha.
- **Login por biometria (WebAuthn)**: em dispositivos compatíveis, dá pra entrar com Face ID/impressão digital/chave de segurança em vez de senha.
- **Proteção contra força bruta**: 5 tentativas erradas de senha por IP+e-mail em 15 minutos bloqueiam novas tentativas por 15 minutos.

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
| 03/09/2026 | Claude | Criação do documento |

---
◀ [Briefing diário](11-briefing.md) · [Visão geral](00-visao-geral.md) · Próximo: [Onde tudo roda](13-infraestrutura.md) ▶
