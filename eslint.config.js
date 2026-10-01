import js from '@eslint/js';
import globals from 'globals';

export default [
  {ignores: ['node_modules/', 'data/', '.npm-cache/', 'deployment.local/', 'test-results/', '.impeccable/']},
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {ecmaVersion: 'latest', sourceType: 'module', globals: {...globals.node}},
    rules: {'no-unused-vars': ['error', {args: 'none', caughtErrors: 'none'}], 'no-control-regex': 'off'},
  },
  {files: ['public/**/*.js'], languageOptions: {globals: {...globals.browser}}},
  // Browser checks pass callbacks into page.evaluate, which run with browser globals.
  {
    files: ['scripts/**/*.cjs'],
    languageOptions: {sourceType: 'commonjs', globals: {...globals.node, ...globals.browser}},
  },
];
