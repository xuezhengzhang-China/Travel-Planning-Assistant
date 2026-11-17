import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'coverage/**',
      // liuyan 分支 V1 前端快照，按原样保存，不参与 lint 门禁（见该目录 README）。
      'apps/web/legacy-v1/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/api/migrations/**/*.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
    languageOptions: {
      sourceType: 'commonjs',
      globals: { exports: 'writable' },
    },
  },
  {
    files: ['apps/api/scripts/**/*.cjs', 'apps/api/tests/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        structuredClone: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['apps/web/tests/**/*.mjs'],
    languageOptions: {
      globals: {
        URL: 'readonly',
        Buffer: 'readonly',
        Response: 'readonly',
        structuredClone: 'readonly',
        Blob: 'readonly',
        FormData: 'readonly',
      },
    },
  },
  {
    files: ['packages/shared/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { module: 'readonly' } },
  },
  prettier,
);
