# Conferência do acervo do PJe (TJES) com o CRM — 17/11/2026

## Pedido
"Analise se todos os processos estão cadastrados no CRM" (prints do Acervo do PJe, 107 processos). Depois: "cadastre apenas esses dois então que não estão em lugar nenhum".

## Feito
- Cruzamento dos 107 números do acervo com `legal_processes`, `dative_cases`, `cases` (número, título, descrição), `agreements` e `correspondent_hearings` (produção, só leitura).
- Resultado: 97 já em `legal_processes`; 5 só como dativo (Alto Rio Novo 5000277-59.2026, Castelo 0003600-06.2014, Itapemirim 5002664-31.2026, Mantenópolis 5000194-12.2026, Muqui 5000663-43.2026); 2 só citados em casos sem o número gravado (Edivaldo 5031136-15.2026 ↔ caso 36; Rosana 5049528-37.2025, extinto, citado na descrição do caso 55).
- Cadastrados em produção:
  - dativo nº 43: 5000043-16.2026.8.08.0041 (Itapemirim, 2º JEC), ficha existente (cliente 22); nascimento completado na ficha.
  - `legal_processes` 177: 0014344-76.2019.8.08.0048 (Serra, 1ª Vara de Família, arquivado → fase encerrado), cliente 154.
  - `legal_processes` 178: 5043510-33.2025.8.08.0024 (Vitória, 2ª Vara de Família), cliente 133.
  - Depois, com autorização: caso 36 (Edivaldo) recebeu o nº 5031136-15.2026.8.08.0035 e o processo 179 ligado a ele; processo 180 (Rosana, 5049528-37.2025, extinto → fase encerrado) ligado ao caso 55.
  - Todos com monitoramento ligado (o sync preenche movimentos).

## Verificado
- SELECT após cada INSERT confirmou as linhas e a ficha ligada. Inserts com `WHERE NOT EXISTS` (sem duplicar).

## Pendente (decisão da equipe)
- Dativo 32 (Alto Rio Novo) está com área "criminal"; o certo é cível (carta precatória cível). A alteração foi bloqueada pela permissão da sessão.
- Achados de qualidade: ~10 processos de família/criminal ligados à ficha genérica "EM SEGREDO DE JUSTIÇA" (cliente 15) ou "E. S. D. J."; 3 sem cliente (5029969-66.2025, 5021178-11.2025, 5035441-12.2025); 5000902-56.2025 ligado à ré Matricon como cliente (o certo é o Wilton, cliente 129).
- Data de nomeação do dativo 43 em branco.

## Próxima sessão
Se a Jessica autorizar, corrigir as ligações acima.
