# dsh-cordis-probe

English · [简体中文](README.zh.md)

A repository development plugin that exercises dsh-pet as a third-party consumer. It contains mock providers and must not be confused with a production model, speech service or memory benchmark.

## Install

Install this directory through DSH plugin management, then restart the selected DSH profile. The client panel reads `petApi7340` in the browser and offers synthesis, recognition and memory toggles. The host registers mock providers and local toggle routes.

## Source map

| File                  | Purpose                                                                         |
| --------------------- | ------------------------------------------------------------------------------- |
| `lib/client.js`       | Service inspection and provider toggle UI                                       |
| `lib/index.js`        | Host registration and toggle route assembly                                     |
| `lib/mock-balance.js` | Five balance providers: windows, money, points and two custom layouts           |
| `lib/mock-adapter.js` | Adds the mock choices to the model selector                                     |
| `lib/mock-voice.js`   | Returns a 0.3-second, 660 Hz tone regardless of text                            |
| `lib/mock-speech.js`  | Returns synthetic text containing the received byte count                       |
| `lib/mock-memory.js`  | Keeps five rounds per pet and injects a prior round for matching recall prompts |
| `lib/toggle-route.js` | Shared GET status / POST toggle handler                                         |

## Toggle behavior

Providers start disabled. Enabling a toggle registers its implementation; disabling it invokes the disposer. Unloading the plugin also disposes registrations.

- Synthesis replaces the built-in output with a tone. It does not test a remote TTS model.
- Recognition returns a byte-count message, proving transport through the base64/HTTP path rather than transcription quality.
- Memory exposes `/cordis-probe-memory`. A captured count increase verifies the capture hook. Matching recall prompts request the marker `[MOCK-RECALL-OK]`; this is a fixture instruction, not proof of real long-term memory.

The three toggle routes belong to this probe, not the pet's public API. The browser/host boundary is crossed through HTTP even though direct browser service reads are in-process.

## Balance fixtures

| Provider ID         | Shape                                                 |
| ------------------- | ----------------------------------------------------- |
| `mock-windows`      | Rolling, weekly and monthly windows                   |
| `mock-money`        | Two-currency balances                                 |
| `mock-points`       | 800 / 1000 points                                     |
| `mock-custom-kinds` | Four pages covering the standard shapes and a summary |
| `mock-custom-fancy` | Three pages for models, wallet composition and usage  |

Click a custom bubble to cycle its pages. Its `percent` controls balance-band animations. See [Cordis contracts](../../docs/en/reference/cordis.md).
