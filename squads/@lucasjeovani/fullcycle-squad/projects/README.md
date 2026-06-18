# projects/

Contexto por projeto. A squad é genérica — tudo que é específico de um projeto vive aqui.

Na primeira sessão de trabalho em um projeto novo, crie:

```
projects/<nome-do-projeto>/
├── _memory/
│   └── memories.md     ← stack, decisões, trabalho concluído, roadmap
└── (docs opcionais: arquitetura, guias, contratos de API)
```

Regras (ver `squad.yaml` → `projects.rules`):
- A stack declarada pelo projeto sobrepõe a `preferred_stack` da squad.
- Aprendizados reutilizáveis entre projetos sobem para `_memory/memories.md` na raiz da squad; o que é específico fica aqui.
