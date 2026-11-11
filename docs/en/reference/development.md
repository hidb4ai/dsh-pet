# Development and validation

English · [简体中文](../../zh/reference/development.md) · [Documentation](../README.md)

## Source map

| Path in `dsh-pet/`     | Responsibility                                                   |
| ---------------------- | ---------------------------------------------------------------- |
| `src/host/`            | Plugin assembly, configuration, routes, queues and host services |
| `src/client/`          | Pet, settings and chat UI                                        |
| `src/shared/`          | Types, animation and interaction rules                           |
| `src/standalone/`      | Standalone server, model setup and managed memory                |
| `src/app/`, `runtime/` | Application and Electron shell                                   |
| `scripts/`             | Build, packaging and browser checks                              |
| `assets/`              | Configuration and character assets                               |

The repository root contains bilingual `docs/`, the OpenAPI contract, release workflows and artwork production tools. The inner package is the npm publishing unit.

## Validate a change

Use Node.js 24 and pnpm 10.34.3 to match the release workflow. Run from `dsh-pet/`:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:cycles
pnpm check:runtime
pnpm check:openapi
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:ui
```

Linux CI may need `playwright install --with-deps chromium`. Unit tests and browser/script tests are separate. Browser tests use local fixtures, not personal DSH settings or a live provider. A passing UI suite does not validate native desktop click-through, display scaling, microphone hardware or actual registry publication.

`npm pack --pack-destination /absolute/path/outside/the/repository` runs the full prepack chain. Install the resulting archive in an isolated user directory to verify distribution behavior, not just source imports.

Keep logs, test homes, raw PDF extraction and temporary screenshots outside the checkout. On this Linux workspace use `/data/codex-tmp/` and set `TMPDIR`. Only reviewed documentation images belong in `docs/assets/`.

## Maintain bilingual docs

English and Chinese pages share the same path under `docs/en/` and `docs/zh/`, with a language switch and a link to their documentation home. Put learning steps in tutorials, task recipes in guides, exact lookups in reference, and reasoning/evidence in explanation.

Write source comments, test descriptions, logs and diagnostic messages in English. Keep explicitly bilingual material and Chinese localization in their designated files.

Update both editions when behavior changes. Keep source IDs, filenames and proper names exact. The original Chinese files in `prompts/` are character-asset generation inputs and remain alongside their original asset names. Preserve localized dictionaries and tests that exercise Chinese/Unicode behavior. Screenshot captions state the runtime, version and whether content is synthetic. Benchmark captions state the comparator, denominator, missing data and pricing date; token savings are not automatically cost savings.

Root documents are navigation entry points for previously shared URLs. Detailed material belongs in docs, avoiding duplicate instructions. The English and Chinese package READMEs link to the same guides.

## Report an issue

Include commit/version, OS, runtime (DSH web/desktop or standalone), expected behavior and reproduction steps. Remove API keys, capability URLs and private conversation content. Distinguish a missing host feature from a failing supported path.
