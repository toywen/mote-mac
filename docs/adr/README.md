# 架构决策记录

ADR（Architecture Decision Record）是架构决策记录。每个文件记一个决策：背景、决定和理由。

规则：

- 写完不再改内容。只能改"状态"一行。
- 推翻一个决策时，新写一篇，状态写"替代 NNNN"。再把旧的那篇状态改成"被 NNNN 替代"。
- 文件名是 `NNNN-短标题.md`，编号递增。
- 状态有三种：已接受、已实现、被 NNNN 替代。"已接受"表示定了但还没写代码。

| 编号                                                                      | 决策                                                      | 状态                         |
| ------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------- |
| [0001](0001-tech-stack.md)                                                | 技术选型                                                  | 已实现                       |
| [0002](0002-one-parser.md)                                                | 编辑器、索引和阅读模式只用一个解析器                      | 已实现                       |
| [0003](0003-link-resolution-matches-obsidian.md)                          | 链接解析以 Obsidian 的结果为准                            | 已实现，导出方法被 0008 替代 |
| [0004](0004-substring-search.md)                                          | 全文搜索用内存子串匹配                                    | 已接受                       |
| [0005](0005-own-sync-service.md)                                          | 同步用 mote 自己的服务，不用 git                          | 被 0021 替代                 |
| [0006](0006-rename-journal.md)                                            | 改名和移动用 journal 保证可以重跑                         | 已接受                       |
| [0007](0007-mote-file-protocol.md)                                        | 图片通过 `mote-file://` 协议读取                          | 已实现                       |
| [0008](0008-isolated-obsidian-export.md)                                  | 用隔离的 Obsidian 自动导出解析结果                        | 已实现，替代 0003 的导出方法 |
| [0009](0009-frontmatter-yaml.md)                                          | 属性用 yaml 包解析，和 Obsidian 同一个库                  | 已实现                       |
| [0010](0010-one-preview-field.md)                                         | 实时预览用一个字段和一张注册表                            | 已实现                       |
| [0011](0011-create-note-on-click.md)                                      | 点击指向不存在笔记的链接时，新建这篇笔记                  | 已实现                       |
| [0012](0012-remote-images.md)                                             | 编辑器加载笔记里的 https 图片                             | 已实现                       |
| [0013](0013-video-playback-and-youtube-embeds.md)                         | 本地视频播放与 YouTube 视频嵌入                           | 已实现                       |
| [0014](0014-github-actions-packaging-and-updater.md)                      | GitHub Actions 打包与 Releases 自动更新                   | 已实现                       |
| [0015](0015-native-application-menu-and-markdown-shortcuts.md)            | 原生应用菜单与 Markdown 格式化快捷键                      | 已实现                       |
| [0016](0016-paste-and-drop-image-attachments.md)                          | 粘贴与拖拽图片按配置自动存入附件文件夹                    | 被 0017 替代（附件存储部分） |
| [0017](0017-mote-vault-spec-and-dot-mote.md)                              | mote 独立笔记库规范与 .mote 目录                          | 已实现                       |
| [0018](0018-sandboxed-html-viewing.md)                                    | 在应用内沙箱安全阅读 HTML 文件                            | 已实现                       |
| [0019](0019-table-cell-editing-math-rendering-and-multi-vault-windows.md) | 表格单元格直接编辑、数学公式渲染与多笔记库多窗口          | 已实现                       |
| [0020](0020-image-and-pdf-in-app-preview.md)                              | 在应用内支持图片与 PDF 格式文件的独立标签页预览           | 已实现                       |
| [0021](0021-own-sync-service-without-claude-connector.md)                 | 同步用 mote 自己的服务，不考虑 Claude 连接器              | 已接受，替代 0005            |
| [0022](0022-sync-service-deployment-and-latency.md)                       | 同步服务部署在自己的阿里云服务器，按文件同步，延迟约 2 秒 | 被 0027 替代（备份部分）     |
| [0023](0023-sync-repo-split.md)                                           | 同步服务和协议独立成 mote-sync 仓库                       | 被 0028 替代（包名部分）     |
| [0024](0024-no-account-system-in-v1.md)                                   | 同步第一版不做账户体系，只用设备令牌                      | 被 0025 替代                 |
| [0025](0025-accounts-in-data-model-from-v1.md)                            | 同步从第一版就按账户建模，登录界面留到以后                | 被 0029 替代（登录部分）     |
| [0026](0026-sync-storage-layout.md)                                       | 同步服务用 SQLite 存元数据，内容按哈希存磁盘              | 已接受                       |
| [0027](0027-no-backup-in-v1.md)                                           | 同步第一版不做自动备份                                    | 已接受，替代 0022 的备份部分 |
| [0028](0028-protocol-package-name.md)                                     | 协议包的 npm 名改用 mote-sync-protocol                    | 已接受，替代 0023 的包名部分 |
| [0029](0029-public-registration-and-login.md)                             | 同步服务公开注册，用户用用户名和密码登录                  | 被 0030 替代（证书部分）     |
| [0030](0030-plain-http-and-address-in-settings-file.md)                   | 现阶段同步走 HTTP，服务器地址放在配置文件                 | 已实现，替代 0029 的证书部分 |
