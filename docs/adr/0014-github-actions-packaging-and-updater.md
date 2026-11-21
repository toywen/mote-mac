# 0014. GitHub Actions 打包与 Releases 自动更新

- 日期：2026-11-21
- 状态：已实现

## 背景

mote 需要在 Mac 上交付开箱即用的安装包，并支持在发布新版本后无缝检查更新和升级（第 6 步，验收-8 与 验收-9）。

当前约束：

1. 个人开发与开源分发环境下，本地可能未配置付费 Apple 开发者证书（`0 valid identities found`）。
2. Electron 原生 `autoUpdater` (Squirrel.Mac) 在 macOS 上硬性要求应用拥有有效代码签名（Code Signing），未签名或 ad-hoc 签名应用调用 `setFeedURL` 会抛出异常阻断。
3. 需要通过 GitHub Actions CI/CD 在云端统一打包输出 macOS `.dmg` 与 `.zip` 安装包，自动发布到 GitHub Releases。
4. 客户端需要能够：
   - 定期或手动通过 GitHub Releases API 获取最新版本；
   - 比较语义化版本号（semver）；
   - 后台断点下载新版本并向渲染进程广播进度；
   - 下载完成后提示用户重启，通过轻量级守护脚本平滑替换本机的 `mote.app` 并重启。

## 决定

1. **打包系统**：
   - 使用 `electron-builder` 配置 macOS 构建目标为 `dmg` 和 `zip`（同时支持 `arm64` 与 `x64`）；
   - 在 `.github/workflows/release.yml` 中配置 GitHub Actions，在推送版本 Tag（如 `v1.0.1`）时触发自动化测试、构建，并将产物与 Release Notes 自动发布至 GitHub Releases。

2. **更新检测与下载**：
   - 在主进程实现 `Updater` 单例（`src/main/updater.ts`）；
   - 通过 GitHub Releases API（`https://api.github.com/repos/toywen/mote-mac/releases/latest`）获取最新版本元数据；
   - 使用 semver 对比版本号，判断是否有新版本；
   - 优先匹配当前架构（arm64 / x64）的更新资源（`.zip` 或 `.dmg`），下载至 `~/Library/Caches/mote/updates/` 并汇报百分比进度。

3. **平滑安装与重启**：
   - 下载完成后，对于 `.zip` 自动解压得到 `mote.app`，对于 `.dmg` 通过 `hdiutil attach` 挂载提取 `mote.app`；
   - 用户确认重启时，主进程生成并执行独立更新替换脚本：等待当前进程退出 -> 替换目标应用目录（如 `/Applications/mote.app`） -> 打开新版本应用 -> 退出当前进程；
   - 若遇到权限不足或替换异常，安全回退到引导用户通过浏览器打开 GitHub Release 页面下载。

4. **进程边界与状态**：
   - 遵循 Boundary Discipline：所有更新逻辑均在主进程封闭运行，渲染进程只通过 IPC 获取 `UpdateStatus` 状态机并触发操作；
   - 状态机包含 `idle`、`checking`、`available`、`not-available`、`downloading`、`downloaded`、`installing`、`error`。

## 理由

- 绕过 Squirrel.Mac 对付费 Apple 签名的强依赖，同时保证自动化与平滑更新体验。
- 保证构建产物由 GitHub Actions 云端统一构建，确保环境纯净与可复现。
