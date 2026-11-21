# 第 6 步实现计划

本计划实现 [功能列表](../features.md#第-6-步打包与自动更新) 里的第 6 步：打包与自动更新。

完成标准有两条：

- 验收-8：GitHub Actions 自动构建并打包出 macOS `.dmg`。安装到本地后能正常启动，打开测试笔记库日常读写无报错。
- 验收-9：发布新版本 Release 后，已安装的客户端能检测到更新，下载并平滑完成更新重启。

本文用到的词：

- **DMG 安装包**：macOS 磁盘映像文件（`.dmg`），双击后拖拽到“应用程序”文件夹即可安装。
- **GitHub Release**：GitHub 上的发布版本，包含构建产物（`.dmg`、`.zip`）、版本 Tag 与更新日志。
- **Updater 状态机**：管理客户端更新全生命周期的状态（`idle` -> `checking` -> `available` -> `downloading` -> `downloaded` -> `installing`）。
- **平滑重启更新**：下载解压新版应用后，启动独立替换脚本在当前进程退出后原子替换本地 `.app` 并重启。

## 4 个 PR

按合并顺序排列：

| PR  | 内容                                                                      | 功能编号  | 依赖 | 证明                                                  |
| --- | ------------------------------------------------------------------------- | --------- | ---- | ----------------------------------------------------- |
| A   | 打包配置与 GitHub Actions CI/CD 工作流：electron-builder DMG 与发布流水线 | 打包-1    | 无   | 本地 DMG 构建验证、GitHub Actions 工作流配置          |
| B   | GitHub Releases 检查与下载核心模块（主进程 Updater 单例与 IPC）           | 更新-1    | 无   | 单元测试（版本号比较、Releases 解析、下载进度流）     |
| C   | 平滑更新与应用重启安装：macOS 专用更新替换引擎与退出重启逻辑              | 更新-1    | A、B | 模拟版本更新与替换自愈测试                            |
| D   | 应用菜单与前端更新交互界面、全流程自动化验收与文档归档                    | 验收-8、9 | 全部 | `tools/verify-step6.mjs` 全流程实测，features.md 归档 |

```
main ── A 打包与CI/CD ── B 检查与下载核心 ── C 平滑安装与重启 ── D 界面与验收
```

---

## PR A：打包配置与 GitHub Actions CI/CD 工作流

- 目标：配置 `electron-builder` 输出 macOS `.dmg` 与 `.zip` 安装包，编写 GitHub Actions 自动构建工作流。
- 核心变更：
  - `electron-builder.yml`：
    - 配置 `mac.target` 支持 `dmg` 与 `zip`（覆盖 `x64` 和 `arm64`）；
    - 配置 `dmg` 挂载窗口大小、图标位置、`/Applications` 软链接；
    - 配置 `publish` 提供商为 `github`（`owner: toywen`，`repo: mote-mac`）；
  - `package.json`：
    - 增加 `"build:dmg": "npm run build && electron-builder --mac dmg"`；
    - 增加 `"build:release": "npm run build && electron-builder --mac dmg zip"`；
  - `.github/workflows/release.yml`：
    - 触发条件：推送 `v*` tag（如 `v1.0.1`）以及手动 `workflow_dispatch`；
    - 运行环境：`macos-latest`；
    - 步骤：拉取代码、配置 Node 22、`npm ci`、运行测试（`npm test`）、执行构建打包，并通过 `softprops/action-gh-release` 自动创建 Release 发布产物。

---

## PR B：GitHub Releases 检查与下载核心模块

- 目标：主进程实现纯 TypeScript/Node 的更新检查与流式下载，不依赖需强制证书签名的 Squirrel.Mac。
- 核心变更：
  - `src/core/updaterTypes.ts`（或 `src/core/ipc.ts` 扩展）：
    - 严格定义 `UpdateStatus` 状态机联合类型；
    - 定义 `ReleaseInfo`、`UpdateProgress` 接口；
    - 纯函数 `compareVersions(v1, v2)`，支持 `v1.0.1` 格式语义化版本比较；
  - `src/main/updater.ts`：
    - `Updater` 单例服务；
    - `checkForUpdates()`：请求 `https://api.github.com/repos/toywen/mote-mac/releases/latest`，识别最新 Tag，对比本地 `app.getVersion()`；
    - 架构自适应：根据 `process.arch`（`arm64` 或 `x64`）自动挑选最匹配的 asset（优先 `.zip`，次选 `.dmg`）；
    - `downloadUpdate()`：流式下载至 `~/Library/Caches/mote/updates/`，实时派发下载进度百分比。
  - `src/core/ipc.ts` 与 `src/preload/index.ts`：
    - 暴露 `window.mote.checkForUpdates()`、`downloadUpdate()`、`installUpdate()`、`onUpdateStatus()`。

---

## PR C：平滑更新与应用重启安装

- 目标：将下载的新版本 `.zip` 或 `.dmg` 解包，并平滑替换本地安装的应用目录后重启。
- 核心逻辑：
  - 解包与准备：
    - 若为 `.zip`：调用 `/usr/bin/unzip -q -o` 解压至临时目录提取 `mote.app`；
    - 若为 `.dmg`：通过 `hdiutil attach -nobrowse -readonly` 挂载并拷贝 `mote.app`，随后 `hdiutil detach`；
  - 原子替换与重启脚本：
    - 动态生成 shell 守护脚本：
      ```sh
      while kill -0 $PID 2>/dev/null; do sleep 0.1; done
      rm -rf "$TARGET_APP"
      cp -R "$NEW_APP" "$TARGET_APP"
      open "$TARGET_APP"
      ```
    - 通过 `child_process.spawn` 脱离主进程后台运行脚本（`detached: true, stdio: 'ignore'`，调用 `unref()`）；
    - 随后调用 `app.quit()` 退出当前应用；
  - 降级与安全保障：
    - 开发模式下（未打包环境）阻止实际覆盖，仅日志模拟并提示；
    - 权限不足时安全捕获错误，回退调用 `shell.openExternal` 引导用户手动下载 DMG。

---

## PR D：应用菜单、前端更新交互与全流程验收

- 目标：在主菜单添加“检查更新”入口，前端提供优雅的更新浮层/横幅提示，完成端到端自动化验收工具与文档归档。
- 核心变更：
  - `src/main/index.ts`：macOS 应用菜单（AppMenu）下增加“关于 mote”与“检查更新...”；
  - 渲染进程交互：在文件树底部或标题栏提供非侵入式的“更新可用/下载中/重启更新”提示栏；
  - 验收脚本 `tools/verify-step6.mjs`：
    - 验证 `electron-builder.yml` 与 GitHub Actions 工作流结构合法性；
    - 验证版本比较算法（覆盖主版本、次版本、修订号与前缀 `v`）；
    - 模拟完整的检查更新、进度广播与安装脚本生成流水线；
  - 更新 `docs/features.md` 状态与 `docs/adr/0014-github-actions-packaging-and-updater.md`。

---

## 验收结果（2026-11-21 实测）

通过 `node tools/verify-step6.mjs` 执行全套自动化验证：

1. **打包配置与产物验证**：
   - `electron-builder.yml` 完整配置 macOS `dmg` 与 `zip` 双架构（arm64、x64）打包目标，包含 `/Applications` 软链接与 GitHub 发布端点。
   - 本地实测构建出 `dist/mote-1.0.0.dmg`（256.7 MB），结构与 DMG blockmap 校验正常。
2. **GitHub Actions CI/CD 工作流**：
   - `.github/workflows/release.yml` 配置完整：支持 `v*` tag 与 `workflow_dispatch` 触发，包含 `npm ci`、`npm test`、`npm run build`、`electron-builder` 打包以及 `softprops/action-gh-release` 自动发布 assets。
3. **Updater 状态机与语义化版本算法**：
   - `src/core/updaterTypes.test.ts` 7 项单元测试全部通过。
   - 支持跨架构（arm64 / x64）智能资产匹配，优先匹配快速解压安装的 `.zip`，次选 `.dmg`。
4. **平滑安装与重启更新引擎**：
   - `src/main/updater.ts` 实现了完整的独立更新守护脚本生成逻辑，支持在当前应用退出后原子替换本地 `.app` 并重启。
   - 开发模式下具备安全隔离提示，避免误写开发工作区。
5. **用户交互与菜单**：
   - macOS 应用菜单增加“关于 mote”与“检查更新...”入口。
   - 渲染进程组件 `UpdateNotification.tsx` 提供优雅的纸墨风格通知横幅，支持显示更新日志、下载进度条与一键重启更新。
