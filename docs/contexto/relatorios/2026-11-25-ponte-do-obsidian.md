# Ponte do Obsidian — 25/11/2026

## Pedido
A Jessica pediu um fluxograma de como o Obsidian funciona hoje junto do CRM; a página publicada é https://claude.ai/artifact/QyMq4d9XFibEiwR2bwqgHW. Depois perguntou: "E se fosse para deixar tudo automático sem depender de comando!?". Proposta aprovada com "Faça isso".

## Feito
- **Programa do computador:** `scripts/ponte-obsidian/ponte.mjs` (Node puro) + `instalar.ps1` (tarefa do Windows "CRM - ponte do Obsidian", ao fazer logon, sem janela, reinicia sozinha). Roda ao ligar, 30 s depois de mudança no cofre e a cada 10 min.
  - cofre → CRM: notas `.md` para o Cérebro (só o que mudou, por hash em `%LOCALAPPDATA%\crm-ponte-obsidian\estado.json`; nota apagada sai) e fichas `.../Fichas/*.md` + `.docx` para `peca_modelos`.
  - CRM → cofre: `Clientes/`, `Documentação Técnica/`, `Escritório Virtual.md`, `Mapa do cofre.md`.
- **Servidor:** rotas `/api/obsidian-ponte` (`src/routes/obsidianPonte.ts`, chave `OBSIDIAN_PONTE_TOKEN`), regras puras `src/services/obsidianPonte.ts`, banco `obsidianPonteServico.ts`, migration 190 (`obsidian_ponte_sinal`), situação em `GET /api/cerebro/ponte`, rotina `obsidian:ponte-vigia` de hora em hora (24 h sem sinal vira erro do sistema).
- Importação de uma ficha passou para `src/services/pecaModelosImport.ts` (o botão e a ponte usam a mesma).
- Nota de cliente agora reúne **todos os casos** do cliente (o script antigo gravava um caso por cima do outro). `scripts/exportarClientesObsidian.js` removido.
- A ficha do Escritório Virtual passou a viver no repositório: `docs/escritorio-virtual/ficha-escritorio-virtual.md`.
- Tela: linha "Ponte do Obsidian conectada/parada" em Configurações → Biblioteca de modelos de peça.
- Docs: manual 00, 06, 16 e 17; `PROCEDIMENTOS.md` item 3; `LEIA-PRIMEIRO.md`; `CLAUDE.md` (espelho agora automático); `docs/api/rotas.md`.
- Chave `<REMOVIDO>` gravada no `.env` da VPS (crmapp, 600) e em `%USERPROFILE%\.crm-ponte-obsidian.json`.

## Verificado
- `tests/obsidianPonte.test.mjs` (17 testes: nota do cliente, espelho, sinal, caminho fora do cofre, pastas permitidas, trava de "cofre encolheu", plano de `Clientes/`, frontmatter) e `tests/pecaModelosImportObsidian.test.mjs` ajustado.
- `npm run build` ok; `npm run lint` 0 erros; `npm test` 1666 ok, 0 falhas (34 pulados por falta de banco local).
- nginx aceita 25 MB por requisição; o Express, 20 MB (lotes de notas até ~4 MB).
- Deploy e primeira rodada real: ver seção "Produção" abaixo.

## Decisões e porquês
Ver `docs/manual/17-decision-log.md`, entrada de 25/11/2026. Resumo: programa no computador chamando o CRM (sem serviço novo na VPS), chave separada da ponte do TJES, um dono por pasta, manual vindo do servidor (o que está publicado) e travas contra apagar em massa.

## Pendente
- Ficha de modelo apagada no cofre continua na biblioteca (igual ao botão). Se a Dra. quiser que saia, decidir.
- `/anexos/:id` entrega qualquer documento de caso a quem tiver a chave; a chave fica só neste computador, que já guarda esses anexos no cofre.

## Próxima sessão
Conferir em Configurações a linha "Ponte do Obsidian conectada" e o `ponte.log`. Se parar: `Get-ScheduledTask 'CRM - ponte do Obsidian'` e reinstalar com `scripts\ponte-obsidian\instalar.ps1`. Skills: `diagnosing-bugs`, `verification-before-completion`.
