# 0028 协议包的 npm 名改用 mote-sync-protocol

- 状态：已接受，替代 0023 的包名部分
- 日期：2026-11-23

## 背景

[ADR 0023](0023-sync-repo-split.md) 定的包名是 `@mote/sync-protocol`，约定"`@mote` 被占用时改成 `mote-sync-protocol`"。

2026-11-23 建立 `mote-sync` 仓库时查了 npm：`@mote/sync-protocol` 和 `mote-sync-protocol` 都没有发布过。`@mote` 这个 scope 没有注册，要用就得先在 npm 建组织；不带 scope 的名字可以直接发布。

## 决定

- 协议包的 npm 名是 `mote-sync-protocol`。
- 其余按 ADR 0023：独立仓库 `mote-sync`，打标签时由 CI 发布，`mote-mac` 依赖它，只做加法式升级。
- 以后想换成带 scope 的名字，先写一篇新 ADR。

## 理由

- 少一步：不用在 npm 建组织、配访问令牌。
- 包是公开的，名字唯一就够了。scope 只是分组，不带来功能。

## 后果

- 文档、`mote-mac` 的依赖和导入路径里写 `mote-sync-protocol`。
- 发布命令是 `npm publish`，在 `protocol/` 目录。
