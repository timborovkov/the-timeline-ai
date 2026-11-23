import { fileURLToPath } from 'node:url';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/.turbo/**',
      'packages/db/drizzle/**',
      '**/next-env.d.ts',
      'apps/web/src/components/ui/**',
    ],
  },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: fileURLToPath(new URL('.', import.meta.url)),
      },
    },
    rules: {
      // Bun's built-in unused-import cleanup covers unused-imports/*; keep the
      // same ignore patterns the repo used with eslint-plugin-unused-imports.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      // typescript-eslint 8.73+ ships this in strictTypeChecked, but bun lint
      // cannot run type-aware rules implemented in JavaScript yet.
      '@typescript-eslint/no-unsafe-class-instance-assignment': 'off',
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Bun loads the built-in import plugin via bunfig.toml [lint].plugins.
      // Keep the previous import-x/order options under the native import/order
      // name so ranking stays identical without eslint-plugin-import-x.
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          pathGroups: [
            { pattern: 'bun', group: 'external' },
            { pattern: 'bun:**', group: 'external' },
          ],
          // bun:test is a runtime builtin to import, but this repo groups it
          // with third-party imports. Allow pathGroups to rematch that builtin.
          pathGroupsExcludedImportTypes: ['type'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },
  {
    files: ['apps/worker/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/^\\.(?!.*\\.css$)/]',
          message: 'Use the @/ alias for web source imports instead of relative paths.',
        },
        {
          selector: 'ImportDeclaration[source.value="@timeline/shared"]',
          message:
            'apps/web must import @timeline/shared through explicit subpath exports, not the root barrel.',
        },
        {
          selector: 'ExportNamedDeclaration[source.value=/^\\.(?!.*\\.css$)/]',
          message: 'Use the @/ alias for web source exports instead of relative paths.',
        },
        {
          selector: 'ExportNamedDeclaration[source.value="@timeline/shared"]',
          message:
            'apps/web must re-export @timeline/shared through explicit subpath exports, not the root barrel.',
        },
        {
          selector: 'ExportAllDeclaration[source.value=/^\\.(?!.*\\.css$)/]',
          message: 'Use the @/ alias for web source exports instead of relative paths.',
        },
        {
          selector: 'ExportAllDeclaration[source.value="@timeline/shared"]',
          message:
            'apps/web must re-export @timeline/shared through explicit subpath exports, not the root barrel.',
        },
        {
          selector: 'Literal[value="@timeline/shared"]',
          message:
            'apps/web tests must mock/import explicit @timeline/shared subpaths instead of the root barrel.',
        },
      ],
    },
  },
  {
    files: ['apps/worker/src/**/*.ts', 'packages/{db,shared}/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/^\\./]',
          message: 'Use the package-local #src/ alias for internal package source imports.',
        },
        {
          selector: 'ExportNamedDeclaration[source.value=/^\\./]',
          message: 'Use the package-local #src/ alias for internal package source exports.',
        },
        {
          selector: 'ExportAllDeclaration[source.value=/^\\./]',
          message: 'Use the package-local #src/ alias for internal package source exports.',
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/^\\.\\.\\/packages\\//]',
          message:
            'Use exported @timeline/* package subpaths instead of deep relative package imports.',
        },
      ],
    },
  },
  {
    files: ['**/*.config.{js,mjs,ts}', '**/scripts/**'],
    rules: {
      'no-console': 'off',
    },
  },
  prettierConfig,
);
