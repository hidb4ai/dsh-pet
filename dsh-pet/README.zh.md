---
description: 桌宠插件包，支持可选的 PowerContext 长期记忆。
kind: package-reference
---

# dsh-pet

[English](README.md) · 简体中文 · [项目完整说明](../README.zh.md)

<a id="overview"></a>

## 概述

面向 DeepSeek Harness 和独立运行的动画桌宠：聊天、人设、语音、动画、提醒，以及每只宠物独立的 PowerContext 1.5.0 长期记忆。当前分支的记忆功能不一定已包含在上游发布包中。

<a id="use"></a>

## 使用本包

需要 Node.js 22.12+。在本目录执行 `pnpm install --frozen-lockfile`、`pnpm build`、`pnpm standalone --setup`。需要桌面窗口时，先用 `pnpm ensure:electron` 准备 Electron，再运行 `pnpm start:app`。DSH 安装和已有记忆服务的连接方式见[项目说明](../README.zh.md)。

<a id="implementation"></a>

## 理解实现

| 源码                               | 职责                                                  |
| ---------------------------------- | ----------------------------------------------------- |
| `src/host/index.ts`                | Cordis 宿主插件装配，导出 `name`、`inject`、`apply`。 |
| `src/client/index.ts`              | 浏览器插件与界面注册，通过 `dsh-pet/client` 导出。    |
| `src/host/plugin/chat-memory.ts`   | 本机聊天存档、采集队列与提示词装配。                  |
| `src/host/powercontext.ts`         | 有预算限制的 PowerContext 采集和召回客户端。          |
| `src/host/powercontext-library.ts` | 记忆列表、来源、更正和遗忘。                          |
| `src/standalone/managed-memory.ts` | 本机运行时、健康检查和稳定的服务身份。                |

包导出宿主入口、`./client`、`./src/*`、`./cordis.patch.yml`、`./package.json`。可执行命令 `dsh-pet-standalone` 启动独立模式。

<a id="explore"></a>

## 进一步探索

[功能](../FEATURES.md) · [配置](../CONFIG.md) · [PowerContext](../POWERCONTEXT.md) · [HTTP 契约](../openapi.yaml) · [制作宠物](../MAKE-YOUR-OWN-PET.md)

<a id="models"></a>

## 模型体验

近期对话和召回记忆分别设限。问答异步采集后，由后台模型整理成可召回的事实。打开「记得的事」可以查看和更正。配置和生命周期边界见 [PowerContext 接入指南](../POWERCONTEXT.md)。

<a id="limits"></a>

## 已知限制

聊天需要模型凭据，宿主能力需要对应的 DSH 服务。记忆抽取并非即时，也不保证每次成功；遗忘不会物理删除来源或本机聊天。生成与 Embedding 会把所需文本发送给模型服务商。形象素材受非商业授权约束，代码采用 MIT，详见[完整许可与致谢](../README.zh.md#致谢与许可)。

<a id="development"></a>

## 开发备注

交付前执行 `pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm check:cycles`、`pnpm check:runtime`、`pnpm check:openapi`、`pnpm test`、`pnpm test:ui`、`pnpm build`。
