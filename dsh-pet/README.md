---
description: Animated pet package with optional PowerContext memory.
kind: package-reference
---

# dsh-pet

English · [简体中文](README.zh.md) · [Full project guide](../README.md)

<a id="overview"></a>

## Overview

An animated desktop companion for DeepSeek Harness and standalone use: chat, configurable personality, voice, animation, reminders and optional per-pet PowerContext 1.5.0 memory. This branch’s memory features may not be in the published upstream package.

<a id="use"></a>

## Use this package

Requires Node.js 22.12+. From this directory, run `pnpm install --frozen-lockfile`, `pnpm build`, then `pnpm standalone --setup`. For a graphical desktop, prepare Electron with `pnpm ensure:electron` and run `pnpm start:app`. DSH installation and external memory configuration are covered in the [project guide](../README.md).

<a id="implementation"></a>

## Understand the implementation

| Source                             | Responsibility                                                         |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `src/host/index.ts`                | Cordis host plugin assembly: `name`, `inject`, `apply`.                |
| `src/client/index.ts`              | Browser plugin and UI registration, exported through `dsh-pet/client`. |
| `src/host/plugin/chat-memory.ts`   | Local chat journal, delivery queue and prompt assembly.                |
| `src/host/powercontext.ts`         | Bounded PowerContext capture and recall client.                        |
| `src/host/powercontext-library.ts` | Memory list, provenance, correction and forgetting.                    |
| `src/standalone/managed-memory.ts` | Local runtime, health checks and persistent service identity.          |

Package exports include the host entry, `./client`, `./src/*`, `./cordis.patch.yml` and `./package.json`. The executable `dsh-pet-standalone` starts standalone mode.

<a id="explore"></a>

## Explore further

[Features](../FEATURES.md) · [Configuration](../CONFIG.md) · [PowerContext](../POWERCONTEXT.md) · [HTTP contract](../openapi.yaml) · [Custom pets](../MAKE-YOUR-OWN-PET.md)

<a id="models"></a>

## Model behavior

Recent chat and retrieved memories have separate limits. Source capture is asynchronous; background model extraction produces recallable facts. Inspect and edit them in **Remembered facts**. See the [memory configuration and lifecycle guide](../POWERCONTEXT.md).

<a id="limits"></a>

## Known limits

Chat needs model credentials. Host-specific features require their DSH services. Memory extraction is not immediate or guaranteed, and forgetting does not physically erase sources or local chat. Model providers receive the text needed for generation and embeddings. Character assets have non-commercial licensing restrictions; code is MIT. See the [full licensing and credits](../README.md#credits-and-licensing).

<a id="development"></a>

## Development notes

Use `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:cycles`, `pnpm check:runtime`, `pnpm check:openapi`, `pnpm test`, `pnpm test:ui` and `pnpm build` before delivery.
