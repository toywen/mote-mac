# 第 5 步实现计划

本计划实现 [功能列表](../features.md#第-5-步视频阅读和性能) 里的第 5 步：视频阅读和性能。

完成标准有三条：

- 验收-10：在笔记中插入本地或库内视频（`![[视频.mp4]]`、`![](路径.mp4)`），在实时预览和阅读模式下均能正常显示播放器并流畅播放视频。
- 验收-11：在笔记中插入 YouTube 视频（`![](https://www.youtube.com/watch?v=...)`、`![](https://youtu.be/...)` 或 `<iframe>`），在实时预览和阅读模式下均能正常显示并播放 YouTube 视频。
- 验收-6：生成 1 万篇笔记的笔记库，打开、搜索和改名达到性能目标。

本文用到的词：

- **库内视频**：扩展名为 mp4、webm、mov、m4v、ogv 的文件，经 `mote-file://` 读取。
- **YouTube 嵌入**：通过标准链接或 `<iframe>` 嵌入的 YouTube 播放器。
- **万篇笔记库**：通过 `tools/gen-vault.mjs` 按照真实笔记库分布生成的测试库。

## 4 个 PR

按合并顺序排列：

| PR  | 内容                                                                   | 功能编号       | 依赖 | 证明                                                        |
| --- | ---------------------------------------------------------------------- | -------------- | ---- | ----------------------------------------------------------- |
| A   | 视频支持与协议扩展：mote-file 范围请求、CSP 放行、播放器渲染与尺寸控制 | 视频-1、视频-2 | 无   | Vitest、E2E 测试（播放器控件、iframe 渲染、尺寸与阅读模式） |
| B   | 性能优化：按需解析链接、候选笔记子串快筛、改名定向改写                 | 规模-1         | 无   | 单元测试与 1 万篇笔记基准测试                               |
| C   | 测试库生成器与基准测试工具：tools/gen-vault.mjs 与 bench-step5.mjs     | 规模-1、验收-6 | A、B | 1 万篇笔记库全指标实测数据                                  |
| D   | 全流程验收走查与文档归档                                               | 验收-6、10、11 | 全部 | verify-step5.mjs 实测，更新 features.md 与 ADR 0013         |

```
main ── A 视频渲染与协议 ── B 性能与索引优化 ── C 万篇测试生成与基准 ── D 全流程验收
```

---

## PR A：视频支持与协议扩展

- 目标：支持本地视频与 YouTube 视频在实时预览和阅读模式下正常渲染与播放。
- 协议与安全：
  - `src/core/fileUrl.ts`：增加 `videoType` 与 `mediaType`，覆盖 mp4、webm、mov、m4v、ogv。
  - `src/main/fileProtocol.ts`：放行视频 MIME 类型，支持 HTTP Range（206 Partial Content），保证大视频流式读取与进度拖动。
  - `src/renderer/index.html`：CSP 增加 `media-src 'self' mote-file: https:`，增加 `frame-src https://www.youtube.com https://www.youtube-nocookie.com`。
- 编辑器渲染：
  - 新建 `src/renderer/src/editor/videos.ts` 与 `videos.css`。
  - 支持 `WikiEmbed`（`![[视频.mp4]]`、`![[视频.mp4|400x300]]`）与 `Image`（`![](视频.mp4)`）。
  - 支持 YouTube 链接解析（`watch?v=`、`youtu.be/`、`embed/`），渲染 `iframe`。
  - 支持 HTML 原生 `<iframe src="https://www.youtube.com/embed/...">`（`HTMLBlock` 与 `HTMLTag` 渲染）。
  - 实时预览下光标在当前行时显示源码，移开时显示播放器；阅读模式下始终显示播放器。

---

## PR B：性能优化与万篇笔记索引

- 目标：将 1 万篇笔记库打开时间控制在 2 秒内，改名一篇有 100 个反向链接的笔记控制在 1 秒内。
- 优化点：
  1. `NoteIndex` 延迟提取链接：启动时只加载文本，访问 `note.links` 时按需提取，消除启动时 1 万次 lezer 完整语法树解析开销。
  2. `NoteIndex.backlinks(target)` 过滤：利用笔记文本子串匹配（忽略大小写包含目标文件名）快筛候选笔记，仅对命中候选执行链接解析。
  3. `Vault.renameOrMove()` 定向改写：仅对包含旧路径的候选笔记执行磁盘读取与链接改写，避免全库 1 万次无意义的磁盘扫描。
  4. 优化 `readNoteFiles`：去除冗余的 `stat()` 调用，直接利用 `open` 与 `readFile`。

---

## PR C：测试库生成器与基准测试工具

- 目标：编写 `tools/gen-vault.mjs` 与基准测试脚本。
- `tools/gen-vault.mjs`：
  - 根据 `Downloads/workspace` 的特征分布生成 1 万篇笔记。
  - 包含目录层级、frontmatter、双链、callout、表格与任务。
  - 构造一篇特定的中心笔记（Hub Note），由全库 100 篇分散笔记引用，专门用于压测改名耗时。
- `tools/bench-step5.mjs`：
  - 打开时间（从调用 `open` 到 `info()` 返回）。
  - 全文搜索耗时（50 次查询取中位数）。
  - 快速打开建议匹配耗时。
  - 改名有 100 个反向链接的笔记耗时。
  - 外部修改响应耗时。

---

## PR D：全流程验收走查

- 运行 `tools/verify-step5.mjs` 与 E2E 测试，验证验收-6、验收-10、验收-11。
- 记录实测数据至 `docs/features.md` 与 ADR 0013。

---

## 验收结果（2026-11-21 实测）

通过 `node tools/verify-step5.mjs` 执行全套自动化验证：

1. **单元测试**：`src/core/fileUrl.test.ts` 与 `src/renderer/src/editor/videos.test.ts` 共 20 项测试全部通过（414ms）。
2. **端到端测试**：`tests/e2e/videos.spec.ts` 2 项测试全部通过（5.7s）。
   - 验证本地视频控件、YouTube iframe 嵌入在实时预览与阅读模式下的双向渲染。
   - 验证视频尺寸指定（`|480x270`、`|320`）与时间戳跳转（`t=42`）。
   - 验证 `mote-file://` 协议越界路径安全拦截（禁止跳出笔记库根目录）。
3. **1 万篇笔记库性能基准**（`/tmp/mote-vault-10k`）：
   - 打开笔记库到可编辑：中位数 **839.2ms**（目标 < 2000ms）✓
   - 全文搜索：中位数 **52.6ms**（目标 < 200ms）✓
   - 快速打开建议（60fps 帧率预算）：中位数 **8.55ms**（目标 < 16ms）✓
   - 改名带 100 篇入链笔记并重写链接：**238.2ms**（目标 < 1000ms）✓
   - 外部修改到 watcher 回调延迟：**10.2ms**（目标 < 100ms）✓
