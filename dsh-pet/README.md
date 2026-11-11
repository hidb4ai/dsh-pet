---
description: Animated pet package with optional PowerContext memory.
kind: package-reference
---

# dsh-pet-powercontext

English · [简体中文](README.zh.md) · [Full project guide](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/README.md)

<a id="overview"></a>

## Overview

An animated desktop companion for DeepSeek Harness and standalone use: chat, configurable personality, voice, animation, reminders and optional per-pet PowerContext 1.5.0 memory. This branch’s memory features may not be in the published upstream package.

<a id="use"></a>

## Use this package

After publication, install with `dsh plugin --profile web add dsh-pet-powercontext@beta`, or run `npx dsh-pet-powercontext@beta --setup` for standalone mode. The first release is `0.1.0-beta.1`. Disable the upstream `dsh-pet` plugin before enabling this package; both use the existing data directory and routes, so keep your configuration and memories.

Requires Node.js 22.12+ for standalone use, or 24.9+ for the DSH 0.2.2-rc.1 CLI. From this directory, run `pnpm install --frozen-lockfile`, `pnpm build`, then `pnpm standalone --setup`. For a graphical desktop, prepare Electron with `pnpm ensure:electron` and run `pnpm start:app`. In DSH, use **Settings → Pet Config → Local long-term memory** to install, configure, pause or resume PowerContext while retaining your DSH chat model. Choose separate chat, extraction and embedding providers, fetch model suggestions or enter IDs manually. DeepSeek, OpenAI, Qwen, SiliconFlow, Ark, Zhipu, Kimi, Ollama and optional LiteLLM gateways are available as presets. See the [project guide](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/README.md) for installation from source or a `.tgz` archive.

<a id="implementation"></a>

## Understand the implementation

| Source                                | Responsibility                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/host/index.ts`                   | Cordis host plugin assembly: `name`, `inject`, `apply`.                             |
| `src/client/index.ts`                 | Browser plugin and UI registration, exported through `dsh-pet-powercontext/client`. |
| `src/host/plugin/chat-memory.ts`      | Local chat journal, delivery queue and prompt assembly.                             |
| `src/host/powercontext.ts`            | Bounded PowerContext capture and recall client.                                     |
| `src/host/powercontext-library.ts`    | Memory list, provenance, correction and forgetting.                                 |
| `src/standalone/managed-memory.ts`    | Local runtime, health checks and persistent service identity.                       |
| `src/host/plugin/managed-memory.ts`   | Managed memory lifecycle within DSH.                                                |
| `src/client/settings/memory-setup.ts` | DSH memory setup and service controls.                                              |

Package exports include the host entry, `./client`, `./src/*`, `./cordis.patch.yml` and `./package.json`. The executable `dsh-pet-powercontext` starts standalone mode.

<a id="explore"></a>

## Explore further

[Features](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/FEATURES.md) · [Configuration](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/CONFIG.md) · [PowerContext](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/POWERCONTEXT.md) · [HTTP contract](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/openapi.yaml) · [Custom pets](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/MAKE-YOUR-OWN-PET.md)

<a id="models"></a>

## Model behavior

Recent chat and retrieved memories have separate limits. Source capture is asynchronous; background model extraction produces recallable facts. Inspect and edit them in **Remembered facts**. See the [memory configuration and lifecycle guide](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/POWERCONTEXT.md).

<a id="limits"></a>

## Known limits

Chat needs model credentials. Host-specific features require their DSH services. Memory captures pet dialogue, not DSH coding-agent sessions. Memory extraction is not immediate or guaranteed, and forgetting does not physically erase sources or local chat. Model providers receive the text needed for generation and embeddings. Character assets have non-commercial licensing restrictions; code is MIT. See the [full licensing and credits](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/README.md#credits-and-licensing).

<a id="development"></a>

## Development notes

Use `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:cycles`, `pnpm check:runtime`, `pnpm check:openapi`, `pnpm test`, `pnpm test:ui` and `pnpm build` before delivery.

See the [release instructions](https://github.com/ob-labs/dsh-pet-powercontext/blob/master/README.md#publishing-the-npm-package) for workflow setup. Artwork terms and credits ship in [ASSET-LICENSE.md](ASSET-LICENSE.md).
