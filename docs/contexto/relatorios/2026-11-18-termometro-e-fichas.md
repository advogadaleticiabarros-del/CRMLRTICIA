# Termômetro dos casos, fichas e duplicados — 18/11/2026

## Pedido
"Agora com os logins cadastrados, você vai completar todos os cadastros dos clientes que temos, ajustar os casos, não deixar duplicado, verificar os processos, me mostrar quais estão parados há mais de 100 dias, quais fases estão e qual login e senha ainda falta [...] Vamos fazer um termômetro dos casos, dias parados etc. e me fale o que mais você consegue fazer com esse login."

## Feito
- **Achado principal:** nenhum login de tribunal está salvo no CRM. `mni_credenciais` está vazia; a rotina de 17/11 às 19h10 rodou com 0 sistemas; o nginx não registra nenhum salvamento em `/api/mni`. Sem login, nada foi consultado direto no tribunal; a análise usou o que já existe (DJEN, DataJud, e-mail).
- **Fichas (produção):** 12 campos vazios completados em 9 fichas (1 CPF, 3 e-mails, 3 telefones, 5 nascimentos). Fontes: lead, proposta, assinatura, atendimento e WhatsApp, sempre ligados ao cliente pelo id ou pelo nome completo idêntico. 1 conflito sem gravar (cliente 6: dois telefones diferentes). Backup: `/root/backups/fichas-antes-1794991065445.json`.
- **Duplicados (produção):** processos com o mesmo número fundidos. Aracelia: 114 → 113, caso 12 unido ao 11 (RMC + RCC do BMG). Ilma: 135 e 136 → 133, caso 35 unido ao 34; 5 movimentações e 5 e-mails de tribunal movidos. Backup: `/root/backups/fusao-processos-1794991120867.json`. Não há fichas de cliente com CPF ou nome repetido. Joata 98/99 são dois processos diferentes (1º e 2º JEC).
- **Termômetro:** aba nova em Andamentos nos tribunais. Arquivos: `src/services/termometroCasos.ts`, `GET /api/andamentos/termometro`, `andamentosTermometro` em `public/app.js`.
- **Ficha pelo tribunal:** `lerPartes` em `src/services/mni/cliente.ts`, `src/services/mni/fichaPeloTribunal.ts` e `completarFicha` na rodada do MNI. Liga sozinha quando o login for salvo.
- Manual `10-monitoramento.md` e decision log atualizados.

## Verificado
- Testes novos: `tests/termometroCasos.test.mjs` (3) e `tests/mniPartes.test.mjs` (4). `npm run build` ok; `npm run lint` com 0 erros; `npm test` com 1501 ok, 0 falhas e 34 pulados (sem banco local).
- Termômetro rodado em produção, só leitura, antes do deploy: 111 ativos, 54 encerrados/arquivados, temperatura de 65%, 30 parados há mais de 100 dias, 2 sem movimento e 52 com fase a conferir.
  - Logins: TJES 1º grau (71 processos) e eproc (23) com login faltando; TJES 2º grau com 1 processo; TRT17 (12) depende de credenciamento; TRT9 (2) e TJ de fora (2) sem ligação direta.
- A leitura das partes foi testada só com XML no formato MNI 2.2.2, com dados fictícios. **Não verificado** com resposta real do tribunal: depende do login.

## Decisões
- Fases não foram trocadas: no eproc, "baixa definitiva" costuma ser só a volta do recurso. Aparecem como "conferir".
- Ficha só recebe dado em campo vazio, com nome exato e documento válido (decision log de 18/11).

## Pendente
- **Dra.:** salvar os logins do TJES 1º grau e do eproc em Configurações → Ligação com os tribunais. A senha do 2º grau continua pendente, e o TRT17 depende de credenciamento.
- Conferir as 52 fases sugeridas, filtrando "só fase a conferir".
- Cliente 6: escolher o telefone certo. Ainda faltam dados em muitas fichas (CPF 35, endereço 57, e-mail 104, nascimento 100); o MNI deve completar boa parte.
- Os pendentes do acervo de 17/11 continuam: ficha genérica "EM SEGREDO DE JUSTIÇA" (7 processos) e 4 processos sem cliente.

## Próxima sessão
Depois do login salvo, ver `job_runs` (job `monitoramento:tribunais-mni`): `campos_de_ficha_completados` e `falhas`. Conferir também se a resposta real traz `polo/parte/pessoa`. Skills: `diagnosing-bugs` se não vier, `verification-before-completion`.
