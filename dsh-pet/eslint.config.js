// ESLint flat configuration: recommended JavaScript and TypeScript rules, plus React hooks checks.
// Ignore generated lib output, packaging scripts and assets. TypeScript owns type and global-name checks; disable
// no-undef for TS to avoid false positives for window/fetch.
import js from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['lib/**', 'scripts/**', 'assets/**', 'runtime/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // TypeScript checks types and globals; disable no-undef here to avoid false positives for window/fetch.
    files: ['**/*.ts'],
    rules: {
      'no-undef': 'off',
    },
  },
  {
    // Client code uses React hooks and h() elements. Enforce stable hook order and warn about missing effect
    // dependencies.
    files: ['src/client/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Warn about formatting and parameter names in existing JSDoc without requiring comments on every symbol. Register
    // the TSDoc tags @typeParam, @remarks, @internal and @module explicitly.
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    plugins: { jsdoc },
    settings: {
      jsdoc: { definedTags: ['typeParam', 'remarks', 'internal', 'module'] },
    },
    rules: {
      'jsdoc/check-tag-names': 'warn',
      // Do not expand destructured parameters into separate names; that produces false positives.
      'jsdoc/check-param-names': ['warn', { checkDestructured: false, checkRestProperty: false }],
      'jsdoc/require-param-description': 'warn',
      'jsdoc/require-returns-description': 'warn',
    },
  },
  {
    // This configuration uses ESM imports and no browser globals; enable no-undef.
    files: ['eslint.config.js'],
    rules: {
      'no-undef': 'off',
    },
  },
);
