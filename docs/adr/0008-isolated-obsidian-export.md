# 0008 用隔离的 Obsidian 自动导出解析结果

- 状态：已实现，替代 0003 里的导出方法
- 日期：2026-11-20

## 背景

ADR 0003 要求拿 Obsidian 自己的解析结果做对照，导出方法是在 Obsidian 的控制台里手动粘贴一行命令。5 个副本要做 5 遍，每次规则或测试笔记库变了还要重做。手动导出还要人判断索引是否跑完。

## 决定

- `tools/obsidian-export.mjs` 导出解析结果。它用临时的 `--user-data-dir` 启动 Obsidian，通过调试端口执行导出，再退出并删掉临时目录。
- Obsidian 的加载器会选用户数据目录里版本最新的 `obsidian-*.asar`。脚本把本机装的那个版本复制进临时目录，锁定版本，默认 1.15.1，可用 `OBSIDIAN_VERSION` 改。
- 脚本读 `electron.ipcRenderer.sendSync('version')` 核对实际加载的版本。浏览器标识里的是安装包版本，不能用。
- 脚本等三个条件：元数据缓存初始化完、`onCleanCache` 回调、链接结果连续 2 秒不变。
- 脚本只接受 `~/mote-link-check` 和系统临时目录下的路径，拒绝原始笔记库。

## 后果

- 你本机 Obsidian 的设置和笔记库列表不会被读写。
- Obsidian 会写副本里的 `.obsidian` 文件夹。副本是一次性的，没有关系。
- 本机 Obsidian 升级后，对照要用新版本重新导出，并把 `OBSIDIAN_VERSION` 改成新版本。
