import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';

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
    plugins: {
      import: importPlugin,
      'unused-imports': unusedImports,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
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
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
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
          selector: 'ExportNamedDeclaration[source.value=/^\\.(?!.*\\.css$)/]',
          message: 'Use the @/ alias for web source exports instead of relative paths.',
        },
        {
          selector: 'ExportAllDeclaration[source.value=/^\\.(?!.*\\.css$)/]',
          message: 'Use the @/ alias for web source exports instead of relative paths.',
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
