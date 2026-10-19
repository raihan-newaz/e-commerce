import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// All application source is linted; the baseline runner rejects new legacy violations.
export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'test-results/**', 'playwright-report/**'] },
  { files: ['server/src/**/*.ts', 'client/src/**/*.{ts,tsx}', 'storefront/src/**/*.{ts,tsx}'], extends: [js.configs.recommended, ...tseslint.configs.recommended], languageOptions: { globals: { window: 'readonly', document: 'readonly', console: 'readonly', process: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', structuredClone: 'readonly', URL: 'readonly', Blob: 'readonly', File: 'readonly', KeyboardEvent: 'readonly' } }, rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }], '@typescript-eslint/no-explicit-any': 'error' } }
);
