import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

const fsWriters = [
  'src/main/vaultFs.ts',
  'src/main/appData.ts',
  'src/main/updater.ts',
  'src/main/notes.ts'
]
const electronFree = [
  'src/core/**/*.ts',
  'src/main/notes.ts',
  'src/main/vaultFs.ts',
  'src/main/vault.ts'
]
const fsPaths = ['node:fs', 'node:fs/promises', 'fs', 'fs/promises'].map((name) => ({
  name,
  allowImportNames: ['watch', 'FSWatcher', 'lstat', 'stat', 'realpath', 'readFile'],
  message:
    "Only src/main/vaultFs.ts changes files in the vault, because it refuses a folder that is a symlink. Get an InVault path from locate() or ensureFolder() and call createFile, overwrite or move. Write mote's own files through src/main/appData.ts."
}))
const electronPath = {
  name: 'electron',
  message:
    'tools/*.mjs run this file in plain Node, so it cannot import Electron. Take what you need as an argument, as Vault.trash takes moveToTrash.'
}

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out', 'verify-artifacts', '.claude/worktrees'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    files: ['tools/**/*.mjs', '.claude/skills/**/*.mjs'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [...fsWriters, 'src/**/*.test.ts', ...electronFree],
    rules: { 'no-restricted-imports': ['error', { paths: fsPaths }] }
  },
  {
    files: electronFree,
    ignores: [...fsWriters, 'src/**/*.test.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: [...fsPaths, electronPath] }] }
  },
  {
    files: fsWriters.filter((file) => electronFree.includes(file)),
    rules: { 'no-restricted-imports': ['error', { paths: [electronPath] }] }
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/main/vaultFs.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "TSAsExpression > TSTypeReference[typeName.name='InVault']",
          message:
            'Do not cast to InVault. Call locate() or ensureFolder() from src/main/vaultFs.ts, which check that no folder on the way is a symlink.'
        }
      ]
    }
  },
  {
    files: ['tests/e2e/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[
          "CallExpression[callee.property.name='waitForTimeout']",
          "CallExpression[callee.name='setTimeout']",
          "CallExpression[callee.property.name='setTimeout']"
        ].map((selector) => ({
          selector,
          message:
            'A fixed sleep slows the test, and before a negative assertion it proves nothing. Wait for what the sleep stands for: a locator or state (await expect(locator)...), a value (expect.poll), or an event the app emits. To copy a typing gap, use typingPause from ./app.'
        }))
      ]
    }
  },
  eslintConfigPrettier
)
