# 0013 本地视频播放与 YouTube 视频嵌入

- 状态：已实现
- 日期：2026-11-21

## 背景

笔记中经常包含多媒体内容，包括存放于笔记库内的本地视频录像（如 mp4、webm、mov 等格式）以及来自 YouTube 的视频链接或嵌入代码。此前 mote 仅支持图片显示，视频文件被当作普通链接处理，且 CSP 限制了外部 iframe 与媒体流加载。

## 决定

1. 主进程 `mote-file://` 协议支持视频类型（mp4、webm、mov、m4v、ogv），并支持 HTTP 206 范围请求（Range Request），保证媒体流式播放与进度拖动。
2. 渲染进程 CSP 增加 `media-src 'self' mote-file: https:` 与 `frame-src https://www.youtube.com https://www.youtube-nocookie.com`。
3. 编辑器实时预览与阅读模式增加视频与 YouTube 渲染器：
   - 本地视频：`![[视频.mp4]]` 与 `![](视频路径.mp4)` 渲染为原生 `<video controls>`。
   - YouTube 视频：`![](https://www.youtube.com/watch?v=...)`、`![](https://youtu.be/...)` 及 `<iframe src="https://www.youtube.com/embed/...">` 提取视频 ID 并渲染安全 iframe 播放器。
   - 支持通过 `|宽x高` 或 `|宽` 指定尺寸。

## 后果

- 库内视频与 YouTube 视频在实时预览与阅读模式下均能正常播放并调整进度。
- 视频播放器原生事件由组件自行处理，点击控件播放时不会意外触发光标定位与源码展开。
- 外部网络访问受严格 CSP 约束，仅允许加载放行的 YouTube 嵌入域与媒体源。
