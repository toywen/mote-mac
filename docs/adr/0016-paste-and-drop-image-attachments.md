# 0016. 粘贴与拖拽图片按配置自动存入附件文件夹

- 状态：被 0017 替代（附件存储规范部分）
- 日期：2026-11-21

## 背景

日常笔记书写中，粘贴截图（如 `Cmd+V`）、从访达拖拽图片入编辑器或通过菜单插入图片是高频的基础需求。此前 mote 仅支持对已有图片语法的渲染显示，用户无法直接在编辑器内粘贴或拖拽图片。同时，Obsidian 用户通常在 `.obsidian/app.json` 中配置了新附件的保存策略（`attachmentFolderPath`，包括根目录、指定目录、当前笔记所在文件夹或其子文件夹）。

另外，在实时预览模式下，标题（H1～H6）具有较大的字号与行高，默认浏览器原生 caret 在混排时会退化为基础正文字号高度，光标高度与标题字体不匹配。

## 决定

1. **读取并遵循笔记库附件配置**：
   - 在 `VaultConfig` 中增加读取 `app.json` 中的 `attachmentFolderPath`。
   - 实现纯函数 `resolveAttachmentFolder(attachmentFolderPath, notePath)`：支持根目录（`""`/`"/"`）、固定目录（如 `"attachments"`）、当前笔记所在目录（`"./"`）以及子目录（`"./assets"`）。
   - 自动重命名与冲突处理：对截图等未命名图片生成 Obsidian 标准的 `Pasted image YYYYMMDDHHmmss.png`；对已有文件名保持原名；遇文件名冲突时依次追加编号（` 1.png`、` 2.png`）。

2. **安全存盘与即时链接生成**：
   - 主进程实现 `saveAttachment`：通过 `constants.O_NOFOLLOW | constants.O_CREAT | constants.O_EXCL` 安全落盘，递归创建所需目录，并同步刷新笔记库索引与 `NoteIndex` 文件集。
   - 使用 `linkText` 与 `formatImageEmbed` 根据当前库的 `useMarkdownLinks` 与 `newLinkFormat`（最短路径、相对路径、绝对路径）即时计算出对应的嵌入链接文本（`![[图片.png]]` 或 `![alt](path)`）并返回渲染进程。

3. **编辑器事件与交互**：
   - 在编辑器中通过 `EditorView.domEventHandlers` 监听 `paste`、`dragover`、`drop`：
     - 检测剪贴板或拖拽数据中的图片文件（`image/*` 或图片后缀扩展名）。
     - 非图片文本粘贴不被拦截，保持默认行为。
     - 拖拽与粘贴完成后在光标或放置位置插入嵌入语法，触发笔记 dirty 状态以供自动或手动保存。
   - 菜单栏“编辑”中加入“插入图片...”（快捷键 `Cmd+Shift+I`），调用系统文件选择弹窗，复用落盘与链接插入逻辑。

4. **编辑器光标与选区渲染**：
   - 引入 CodeMirror 的 `drawSelection()` 扩展，接管光标与选区层绘制。
   - 光标高度根据当前行的实际字体大小与行高动态测量缩放，使光标高度与 H1～H6 标题字号完美契合，并在深浅色主题下适配 `--text` 颜色。

## 理由

- 落盘由主进程统一管控并遵循单写者与安全限制，防止路径穿越。
- 链接格式复用已验证的 `linkText` 逻辑，与 Obsidian 保持 100% 兼容。
- `drawSelection()` 解决了多级标题下原生光标矮小、跳跃的缺陷，提供了专业的编辑器视觉与输入手感。
