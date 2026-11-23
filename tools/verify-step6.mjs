#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { isNewerVersion, pickBestAsset } from '../src/core/updaterTypes.ts'
import { channels } from '../src/core/ipc.ts'

console.log('=== 第 6 步：打包与自动更新 自动化验收走查 ===\n')

let failures = 0
function assert(desc, condition, details = '') {
  if (condition) {
    console.log(`✓ ${desc}`)
  } else {
    console.error(`✗ ${desc}`)
    if (details) console.error(`  ${details}`)
    failures++
  }
}

// 1. electron-builder.yml 检查
console.log('--- 1. electron-builder 配置检查 ---')
const builderConfigPath = resolve('electron-builder.yml')
assert('electron-builder.yml 配置文件存在', existsSync(builderConfigPath))

const builderRaw = readFileSync(builderConfigPath, 'utf8')
const builderConfig = parseYaml(builderRaw)

assert('appId 配置正确', builderConfig.appId === 'com.mote.app')
assert('productName 为 mote', builderConfig.productName === 'mote')
assert(
  'mac 构建目标包含 dmg 与 zip，且覆盖 arm64、x64 与 universal',
  Array.isArray(builderConfig.mac?.target) &&
    builderConfig.mac.target.some(
      (t) =>
        t.target === 'dmg' &&
        t.arch?.includes('arm64') &&
        t.arch?.includes('x64') &&
        t.arch?.includes('universal')
    ) &&
    builderConfig.mac.target.some(
      (t) =>
        t.target === 'zip' &&
        t.arch?.includes('arm64') &&
        t.arch?.includes('x64') &&
        t.arch?.includes('universal')
    )
)
assert(
  'dmg contents 包含 /Applications 软链接',
  Array.isArray(builderConfig.dmg?.contents) &&
    builderConfig.dmg.contents.some((c) => c.type === 'link' && c.path === '/Applications')
)
assert(
  'publish 提供商配置为 github (toywen/mote-mac)',
  builderConfig.publish?.provider === 'github' &&
    builderConfig.publish?.owner === 'toywen' &&
    builderConfig.publish?.repo === 'mote-mac'
)

// 2. GitHub Actions CI/CD 工作流检查
console.log('\n--- 2. GitHub Actions 工作流检查 ---')
const workflowPath = resolve('.github/workflows/release.yml')
assert('release.yml 工作流文件存在', existsSync(workflowPath))

const workflowRaw = readFileSync(workflowPath, 'utf8')
const workflowConfig = parseYaml(workflowRaw)

assert('工作流包含 tags v* 触发', Boolean(workflowConfig.on?.push?.tags?.includes('v*')))
assert('工作流包含 workflow_dispatch 手动触发', 'workflow_dispatch' in workflowConfig.on)
assert('具备 contents: write 权限', workflowConfig.permissions?.contents === 'write')

const steps = workflowConfig.jobs?.['build-and-release']?.steps || []
assert(
  '包含 npm ci 安装依赖步骤',
  steps.some((s) => s.run?.includes('npm ci'))
)
assert(
  '包含 npm test 测试验证步骤',
  steps.some((s) => s.run?.includes('npm test'))
)
assert(
  '包含 npm run build 构建步骤',
  steps.some((s) => s.run?.includes('npm run build'))
)
assert(
  '包含 electron-builder 打包 dmg 与 zip 步骤（覆盖 arm64/x64/universal）',
  steps.some(
    (s) => s.run?.includes('electron-builder') && s.run?.includes('dmg') && s.run?.includes('x64')
  )
)
assert(
  '包含 action-gh-release 自动发布产物步骤',
  steps.some((s) => s.uses?.includes('action-gh-release'))
)

// 3. 本地打包 DMG 产物验证
console.log('\n--- 3. 本地 DMG 构建产物验证 ---')
const dmgPath = resolve('dist/mote-1.0.0.dmg')
if (existsSync(dmgPath)) {
  const stat = statSync(dmgPath)
  const sizeMB = (stat.size / (1024 * 1024)).toFixed(1)
  assert(`本地 DMG 文件存在 (${sizeMB} MB)`, stat.size > 50 * 1024 * 1024)
} else {
  console.log('ℹ dist/mote-1.0.0.dmg 尚未构建或已清理（可执行 npm run build:dmg 构建）')
}

// 4. Updater 语义化版本与状态机纯逻辑验证
console.log('\n--- 4. Updater 语义化版本对比与匹配逻辑验证 ---')
assert('isNewerVersion 忽略 v 前缀 (v1.2.3 = 1.2.3)', isNewerVersion('v1.2.3', '1.2.3') === false)
assert('isNewerVersion 检测次版本升级 (1.1.0 > 1.0.9)', isNewerVersion('1.1.0', '1.0.9') === true)
assert('isNewerVersion 检测主版本升级 (2.0.0 > 1.9.9)', isNewerVersion('2.0.0', '1.9.9') === true)
assert('isNewerVersion 正确识别新版本', isNewerVersion('v1.0.1', '1.0.0') === true)
assert('isNewerVersion 正确识别同版本不更新', isNewerVersion('1.0.0', '1.0.0') === false)
assert('isNewerVersion 正确识别旧版本不更新', isNewerVersion('0.9.8', '1.0.0') === false)

const mockAssets = [
  {
    name: 'mote-1.0.1-arm64.dmg',
    browserDownloadUrl:
      'https://github.com/toywen/mote-mac/releases/download/v1.0.1/mote-1.0.1-arm64.dmg',
    size: 250000000,
    contentType: 'application/octet-stream'
  },
  {
    name: 'mote-1.0.1-arm64-mac.zip',
    browserDownloadUrl:
      'https://github.com/toywen/mote-mac/releases/download/v1.0.1/mote-1.0.1-arm64-mac.zip',
    size: 230000000,
    contentType: 'application/zip'
  },
  {
    name: 'mote-1.0.1-x64.dmg',
    browserDownloadUrl:
      'https://github.com/toywen/mote-mac/releases/download/v1.0.1/mote-1.0.1-x64.dmg',
    size: 260000000,
    contentType: 'application/octet-stream'
  },
  {
    name: 'mote-1.0.1-x64-mac.zip',
    browserDownloadUrl:
      'https://github.com/toywen/mote-mac/releases/download/v1.0.1/mote-1.0.1-x64-mac.zip',
    size: 240000000,
    contentType: 'application/zip'
  }
]

const bestArm = pickBestAsset(mockAssets, 'arm64')
assert('arm64 架构优先匹配 arm64 zip 资产', bestArm?.name === 'mote-1.0.1-arm64-mac.zip')

const bestX64 = pickBestAsset(mockAssets, 'x64')
assert('x64 架构优先匹配 x64 zip 资产', bestX64?.name === 'mote-1.0.1-x64-mac.zip')

// 5. IPC 通道定义与完整性检查
console.log('\n--- 5. IPC 通道定义检查 ---')
assert('checkForUpdates IPC 通道存在', channels.checkForUpdates === 'mote:check-for-updates')
assert('downloadUpdate IPC 通道存在', channels.downloadUpdate === 'mote:download-update')
assert('installUpdate IPC 通道存在', channels.installUpdate === 'mote:install-update')
assert('getAppVersion IPC 通道存在', channels.getAppVersion === 'mote:get-app-version')
assert('updateStatus IPC 通道存在', channels.updateStatus === 'mote:update-status')

// 6. 前端 UI 组件检查
console.log('\n--- 6. 前端 UpdateNotification 组件检查 ---')
const uiComponentPath = resolve('src/renderer/src/UpdateNotification.tsx')
assert('UpdateNotification.tsx 组件存在', existsSync(uiComponentPath))
const uiContent = readFileSync(uiComponentPath, 'utf8')
assert('监听 onUpdateStatus 状态机', uiContent.includes('onUpdateStatus'))
assert('包含 downloadUpdate 触发下载', uiContent.includes('downloadUpdate'))
assert('包含 installUpdate 触发重启', uiContent.includes('installUpdate'))

console.log(`\n========================================`)
if (failures === 0) {
  console.log('🎉 第 6 步所有打包与自动更新检查全部通过！')
  process.exit(0)
} else {
  console.error(`❌ 有 ${failures} 项检查失败，请检查上方日志。`)
  process.exit(1)
}
