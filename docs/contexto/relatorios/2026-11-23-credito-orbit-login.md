# Crédito "Orbit Desenvolvimento" na tela de login (23/11/2026)

## Pedido
Jessica: "na tela de login vamos colocar de quem é o desenvolvimento do sistema - coloque Orbit Desenvolvimento, como já tem nos demais".

## Feito
- `public/index.html`: nova linha no fim do cartão de login, "Desenvolvido por **Orbit Desenvolvimento**", abaixo do aviso de Termos e Privacidade.
- `public/styles.css`: classe `.login-credito` (texto pequeno, cor suave, fio dourado claro acima), sem mudar o resto da tela.
- Manual `docs/manual/12-usuarios.md` (+ espelho do Obsidian) e `ESTADO.md` atualizados.

## Complemento: logotipo (pedido "coloque o logotipo")
- `public/orbit-logo.webp` (240×166, 18 KB): recortado de `docs/marca/orbit-logo-referencia.png` da Agenda, só o símbolo e "ORBIT" (sem "Agenda Integrada", que é nome de produto), com o fundo creme tirado para fundir com a tela.
- Fica centralizado acima do texto, com 48 px de altura.

## Verificado
- Print com Playwright em 1366×768 e 390×844: a linha aparece centralizada, sem quebrar o layout e sem rolagem lateral.
- Lint e testes antes do push (ver resposta da tarefa); deploy acompanhado pelo `gh run watch`.

## Decisões
- Não achei o texto pronto nos outros sistemas para copiar, então usei o formato comum "Desenvolvido por …", discreto, para não competir com a marca do escritório.

## Pendente
- Se houver uma versão oficial da logo em SVG ou PNG transparente, trocar `public/orbit-logo.webp` por ela (a atual é um recorte da arte).

## Próxima sessão
- Sem continuação necessária.
