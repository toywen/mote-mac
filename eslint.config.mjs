import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

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
    ignores: [
      'src/main/vaultFs.ts',
      'src/main/appData.ts',
      'src/main/updater.ts',
      'src/main/notes.ts',
      'src/**/*.test.ts'
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['node:fs', 'node:fs/promises', 'fs', 'fs/promises'].map((name) => ({
            name,
            allowImportNames: ['watch', 'FSWatcher', 'lstat', 'stat', 'realpath', 'readFile'],
            message:
              "Only src/main/vaultFs.ts changes files in the vault, because it refuses a folder that is a symlink. Get an InVault path from locate() or ensureFolder() and call createFile, overwrite or move. Write mote's own files through src/main/appData.ts."
          }))
        }
      ]
    }
  },
  eslintConfigPrettier
)
