# Migração CRMLRTICIA: Railway → VPS Hostinger

**Objetivo:** sair do Railway (cobrança por uso) pra uma VPS Hostinger (preço fixo, mais barato), sem perder dados e com o mínimo de tempo fora do ar.

**Por que dá pra fazer com segurança:** o banco de dados está pequeno (~400MB), a aplicação é um único processo Node (sem microsserviços), e o domínio (`crm.advogadaleticiabarros.com.br`) só muda de IP — nenhum código/URL precisa mudar, porque tudo já referencia o domínio próprio, nunca o domínio interno do Railway.

**Janela de corte:** curta, combinada com antecedência (ex.: fim de expediente) — não é zero-downtime, é o suficiente pra ser seguro sem complicar.

---

## Fase 0 — Contratar a VPS (você)

1. Contratar o plano **KVM 2** da Hostinger (2 vCPU / 8GB RAM / 100GB NVMe) — o que você já estava vendo. Sistema operacional: **Ubuntu 24.04 LTS** (peça isso na tela de escolha do SO — não precisa de painel gráfico, é servidor puro).
2. Ao final da contratação, a Hostinger te dá: **IP da VPS**, **senha root** (ou você define uma). Me passe o IP quando tiver — a senha eu não preciso ver, você digita direto quando eu pedir pra conectar.
3. **Não cancele o Railway ainda.** Ele continua rodando em paralelo até confirmarmos que tudo funciona na VPS — é o nosso plano B se algo der errado.

## Fase 1 — Preparar o servidor (eu, via SSH)

Uma vez com o IP:
1. Atualizar o sistema, criar um usuário não-root pra rodar a aplicação (segurança básica).
2. Instalar: Node.js (mesma versão major do `package.json`), MySQL Server, Nginx, PM2 (gerenciador de processo — substitui o "reinicia sozinho se cair" que o Railway faz), Certbot (SSL grátis).
3. Configurar firewall (`ufw`): só portas 22 (SSH), 80 e 443 abertas.

## Fase 2 — Banco de dados

1. Criar o banco e usuário MySQL na VPS.
2. Exportar o banco do Railway (`mysqldump` via `MYSQL_PUBLIC_URL` — já usamos isso antes pra diagnosticar o webhook quebrado).
3. Importar o dump na VPS.
4. Conferir contagem de linhas nas tabelas principais (clients, cases, leads, whatsapp_messages) — bate com o Railway.

## Fase 3 — Aplicação

1. Clonar o repositório GitHub na VPS.
2. Criar o arquivo `.env` com as 26 variáveis que já existem no Railway hoje (chaves de API, `ENCRYPTION_KEY`, `JWT_SECRET`, credenciais do banco local, etc. — os *valores* eu preciso que você copie do painel do Railway pra mim, ou copia direto no servidor).
3. `npm install && npm run build`.
4. Rodar as migrations (`npm run deploy:start` já faz isso automaticamente, como no Railway).
5. Subir com PM2, configurar pra iniciar sozinho se a VPS reiniciar.
6. Nginx como proxy reverso (porta 443 → porta interna do Node) + Certbot pro certificado SSL do domínio.

## Fase 4 — Testar SEM trocar o DNS ainda

1. Testar a aplicação pelo IP da VPS direto (ou editando o `hosts` do seu computador temporariamise pra apontar o domínio pro IP novo, só na sua máquina) — sem afetar ninguém mais.
2. Conferir os fluxos principais: login, cadastro de lead (o bug que acabamos de corrigir), abrir uma conversa de WhatsApp, gerar um documento.
3. Só avança pra Fase 5 quando isso estiver 100%.

## Fase 5 — Corte (janela combinada)

1. Exportar o banco de novo (dump final, pra pegar tudo que mudou desde a Fase 2 — a diferença deve ser pequena).
2. Importar esse dump final na VPS (sobrescreve).
3. Trocar o registro DNS do domínio pra apontar pro IP da VPS.
4. Aguardar propagação (pode levar de minutos a algumas horas — variável, fora do nosso controle).
5. Confirmar que o domínio já está batendo na VPS e tudo funciona.

## Fase 6 — Pós-migração

1. Deixar o Railway pausado (não deletar) por alguns dias, como rede de segurança.
2. Configurar backup automático do banco na VPS (mesma lógica que já existe hoje, adaptada pro ambiente novo).
3. Configurar deploy automático: um workflow simples que, a cada `git push` na `main`, conecta na VPS via SSH e atualiza (pra manter o fluxo que você já usa hoje).
4. Confirmado tudo estável por alguns dias → aí sim cancela o Railway.

---

**O que eu preciso de você, na ordem:**
1. Contratar a VPS e me passar o IP.
2. Acesso SSH (senha root, ou você cria um usuário pra mim).
3. Copiar os valores das 26 variáveis do painel do Railway quando eu pedir (nomes já sei, valores são segredo — só você tem acesso).
