import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/api/migrations/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { exports: 'writable' },
    },
  },
  prettier,
);
