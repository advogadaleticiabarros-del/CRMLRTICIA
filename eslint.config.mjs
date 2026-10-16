// Lint do CRM (16/10/2026). Barra só ERRO DE VERDADE (o que quebra em
// produção); estilo fica como aviso para não travar o deploy por vírgula.
// Roda no CI antes do deploy: `npm run lint`.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'public/vendor/**', '**/*.min.js', 'scripts/**', 'tests/**', '.claude/**', 'worktrees/**'] },

  // Backend (TypeScript)
  {
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      // O código usa `any` de propósito nas respostas do MySQL e das APIs externas.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'prefer-const': 'warn',
      'no-useless-escape': 'warn',
      'no-control-regex': 'off',
      'no-misleading-character-class': 'off',
      // Erros de verdade:
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-self-assign': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      'no-constant-binary-expression': 'error',
      'no-unsafe-finally': 'error',
    },
  },

  // Frontend (JS puro no navegador). Os arquivos compartilham funções globais
  // de app.js (api, el, esc, openModal, ROUTES…), por isso no-undef fica desligado.
  {
    files: ['public/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser } },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'no-control-regex': 'off',
      'no-misleading-character-class': 'off',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-self-assign': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      'no-constant-binary-expression': 'error',
      'no-redeclare': 'error',
      'no-func-assign': 'error',
      'no-dupe-else-if': 'error',
    },
  },
);
