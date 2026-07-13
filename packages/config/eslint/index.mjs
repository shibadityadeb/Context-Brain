import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/** Shared base rules for all TypeScript packages. */
export const baseConfig = tseslint.config(
  { ignores: ['dist/**', '.next/**', 'coverage/**', 'node_modules/**', 'prisma/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
);

/** Node services (API, worker, shared packages). */
export const nodeConfig = baseConfig;

/** Next.js apps — allows JSX-specific looseness where needed. */
export const nextConfig = tseslint.config(...baseConfig, {
  rules: {
    'no-console': 'off',
  },
});
