import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.turbo/**',
      'infrastructure/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  security.configs.recommended,
  {
    files: ['packages/backend/src/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['packages/frontend/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['packages/shared/src/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    rules: {
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-require': 'error',
      'security/detect-non-literal-fs-filename': 'error',
      'security/detect-child-process': 'error',
      'security/detect-possible-timing-attacks': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
