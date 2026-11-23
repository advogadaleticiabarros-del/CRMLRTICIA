# 23/11/2026 — Padrão de segurança SaaS

## Pedido
"Deixe o padrão de segurança para SaaS: aceitar política, segurança de senha, manter as chaves escondidas, tudo! Não dar brecha para invasão nenhuma." (Jessica)

## Brechas encontradas (abertas em produção, sem sinal de uso)
| # | Brecha | Gravidade |
|---|---|---|
| 1 | O passe temporário do 2FA valia como login: só com a senha dava para cadastrar um Face ID e pular o código | alta |
| 2 | Usuário desativado ou com senha trocada seguia entrando para sempre (token antigo + renovação automática) | alta |
| 3 | SSH do servidor aceitava senha, inclusive do root | alta |
| 4 | Socket do WhatsApp aceitava qualquer login, inclusive de cliente do portal | média |
| 5 | `.env` com todas as chaves legível por qualquer usuário do servidor (664), recriado assim a cada deploy | média |
| 6 | `trust proxy true`: `X-Forwarded-For` forjado furava o limite de tentativas de login | média |
| 7 | Senha mínima de 8 caracteres, sem outra regra; senha temporária com `Math.random` | média |
| 8 | Sem HSTS/CSP; `X-Powered-By` e versão do nginx expostos; TLS 1.0/1.1 ligados | baixa |
| 9 | Webhook do Asaas comparava a chave com `!==` (vaza pelo tempo) | baixa |
| 10 | Página pública `/diagnostico` esquecida | baixa |
| 11 | Login respondia mais rápido para e-mail inexistente (revelava quem tem conta) | baixa |

Conferido e já estava certo: nenhuma chave no git (nem no histórico); webhook do WhatsApp confere a chave com comparação segura; links públicos de assinatura e proposta com UUID; firewall, fail2ban, atualizações automáticas; MySQL do CRM fechado; limite de tentativas no login, 2FA e Face ID; formulários públicos com limite por IP.

## O que foi feito
- **Senha:** `src/services/senhaForte.ts` (10+ caracteres, 3 tipos ou frase 16+, sem senha comum, sem sequência, sem nome/e-mail), usada em cadastro, troca, redefinição e admin. bcrypt custo 12. Senha temporária criptográfica de 14 caracteres. A troca de senha pede a senha atual com limite de tentativas e responde 400 (não 401, que deslogava).
- **Sessão:** `src/services/sessaoUsuario.ts` + `users.token_version` (migration 189). O `authenticate` confere usuário ativo e versão; recusa passes com `purpose` e tokens fora de HS256. Troca/redefinição de senha, desativação e mudança de papel derrubam os aparelhos. Rota `POST /api/auth/sair-de-todos`.
- **Termos e Política:** `public/termos.html`, `public/privacidade.html` (LGPD), `src/services/termos.ts`, tabela `termos_aceites`. O servidor recusa as rotas até o aceite (403 `TERMOS_PENDENTES`); a tela de aceite fica por cima de tudo. Links também na tela de login.
- **Cabeçalhos e app:** HSTS, CSP mínima, CORP, sem `X-Powered-By`, `trust proxy 1`, `/diagnostico` removida, Asaas com `timingSafeEqual`, socket só para `WHATSAPP_ROLES` com sessão ativa.
- **Servidor:** SSH só por chave (`05-seguranca.conf`; o SFTP do site segue com senha, preso na pasta), `.env` e `/root/segredos` em 600, deploy com `chmod 600 .env`, nginx `server_tokens off` e TLS 1.2/1.3.
- **Testes:** `tests/segurancaSaas.test.mjs` (11); o teste de ponta a ponta passou a aceitar os termos e confere que a rota libera depois.
- **Documentação:** `docs/manual/12-usuarios.md`, `13-infraestrutura.md`, `14-runbook.md`, `17-decision-log.md`, com cópia no espelho do Obsidian.

## Verificado
- Local: build ok, lint com 0 erros, `npm test` com 1.664 testes (1.630 passaram, 0 falharam, os demais precisam de banco).
- CI no branch `seguranca-saas`: tudo verde (banco do zero com a migration 189, testes com banco, vulnerabilidades, ponta a ponta com o aceite dos termos).
- Servidor: `sshd -t` ok; nova conexão por chave ok; login por senha recusado (`Permission denied (publickey)`); regra do `siteleticia` confere (senha, chroot, só SFTP); `nginx -t` ok; `.env` em 600.
- Produção depois do deploy: ver o ESTADO.md.

## Decisões
- Sessão conferida no banco (token_version, 30 s em memória) em vez de lista negra de tokens. Com o banco fora do ar, a resposta é 503.
- CSP só com o que não quebra a tela (`frame-ancestors`, `object-src`, `base-uri`); restringir scripts exige migrar os `onclick` inline.
- O aceite é exigido no servidor, não só na tela.
- Senhas antigas que não seguem a regra nova continuam valendo até a próxima troca. Forçar a troca de todos é decisão da Jessica ou da Dra.

## Pendente
- **Dra. Letícia:** revisar o texto de `termos.html` e `privacidade.html` (ela é advogada; o texto foi escrito com base na LGPD e no que o sistema faz). Se mudar algo relevante, subir `TERMOS_VERSAO`.
- **Próximas etapas recomendadas:**
  - login em cookie httpOnly com proteção CSRF (hoje o token fica no `localStorage`);
  - CSP de scripts, depois de migrar os `onclick` inline;
  - 2FA obrigatório para admin;
  - forçar a troca de senha de quem tem senha fraca.
- As portas 3310/3311 (MySQL dos outros projetos, para a Vercel) seguem abertas para a internet, com SSL obrigatório. Isso é dos outros projetos, não do CRM.

## Próxima sessão
No primeiro acesso de cada pessoa aparece a tela de aceite. Se alguém disser que "o sistema pediu para aceitar termos", é isso.
