# HTTP API

English · [简体中文](../../zh/reference/http-api.md) · [Documentation](../README.md)

The plugin registers `/dsh-pet-7340` on its host web server. Browser, desktop and integrations use the same handlers. The [OpenAPI 3.1 document](../../../openapi.yaml) defines parameters, schemas and responses; this page is a route map.

Use the actual host port and deployment authentication. DSH owns its server/authentication; standalone binds locally and protects private routes with Host/Origin checks and a process capability. Do not assume that a plugin route has no authentication because the URL is loopback.

All paths below are relative to `/dsh-pet-7340`.

## State and configuration

| Route               | Purpose                                                                          |
| ------------------- | -------------------------------------------------------------------------------- |
| `GET /state`        | Full state snapshot; paired `since` and `timeout` parameters enable long polling |
| `GET /config`       | Resolved default and user configuration                                          |
| `GET /config/meta`  | Configuration/data/log paths and host profile metadata                           |
| `GET /models`       | Available host providers and models                                              |
| `PUT /config`       | Save supported user settings while preserving advanced fields                    |
| `POST /config`      | Restore the complete packaged default configuration                              |
| `POST /pet-display` | Change an instance's display target                                              |
| `POST /pet-config`  | Save all instances of a character pack                                           |
| `POST /reload`      | Restart the desktop helper using current configuration                           |
| `POST /quit`        | Request plugin shutdown according to the host contract                           |

## Chat and memory

| Route                                        | Purpose                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `GET /chat?pet=`                             | Read local chat; `rounds` selects 0–200 rounds or the configured default |
| `POST /chat?pet=`                            | Generate and persist a reply; optional attachment for this turn          |
| `DELETE /chat?pet=`                          | Delete matching `ts` rounds or all local chat for that pet               |
| `POST /whisper?pet=`                         | Generate a short whisper                                                 |
| `POST /broadcast?pet=`                       | Display supplied text, optional image/action/voice; no generation        |
| `POST /bubble/clear?pet=`                    | Dismiss a speech bubble                                                  |
| `POST /balance`                              | Refresh balance on demand                                                |
| `GET, POST /powercontext/setup`              | Inspect or manage local memory inside DSH                                |
| `GET, POST /chat/powercontext?pet=`          | Inspect synchronization/recall or retry a delivery batch                 |
| `GET, POST /chat/powercontext/memories?pet=` | List facts/sources, correct a revision or request forgetting             |
| `GET, DELETE /chat/memory`                   | Inspect or remove local history left by deleted pets                     |
| `GET /attachment`                            | Read a stored attachment according to the schema                         |

Image attachments may be referenced in local chat but their bodies are not sent through text-memory capture. Local deletion is not remote erasure. See [memory semantics](../guides/memory.md).

## Control and playback

| Route                       | Purpose                                                              |
| --------------------------- | -------------------------------------------------------------------- |
| `POST /lock?pet=`           | Acquire or renew a temporary control lease                           |
| `POST /lock/release?pet=`   | Release a lease; user takeover has its own path                      |
| `POST /anim?pet=`           | Play a named animation or supplied URL, optionally specifying facing |
| `GET /playback/{id}`        | Read or wait for actual playback status                              |
| `POST /position?pet=`       | Move to normalized coordinates using direct/spring/linear mode       |
| `POST /throw?pet=`          | Apply angle and power to native throwing                             |
| `POST /sleep?pet=`          | Select a start/loop/end sleep set                                    |
| `POST /wake?pet=`           | Wake the pet; idempotent if already awake                            |
| `GET /pose?pet=`            | Read desktop pose; browser pose comes from the Cordis client service |
| `POST /focus-session`       | Ask the DSH page to focus a session                                  |
| `POST, DELETE /work-status` | Set or clear the external work-status slot                           |

For coordinated external control, acquire a lease and pass `?lock=<lockId>` to protected actions. Competing ownership returns `lock-required` or `lock-lost`; a user drag/hide can revoke ownership. A missing lease parameter when no lock exists follows the route's normal contract. A stale supplied ID never grants authority. Inspect playback receipts instead of treating accepted requests as completed animations.

Renderer-only reports (`/pose/report`, `/playback/{id}/report`) are not the integration control path.

## Menus, assets, voice and to-dos

| Route                       | Purpose                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| `POST, DELETE /menu/item`   | Replace/remove an owner's menu entries, optionally scoped to web/desktop |
| `GET /menu/events`          | Read and consume click results for an owner                              |
| `POST /menu/click`          | Renderer click report                                                    |
| `GET /character`            | Retrieve a reference character image; does not call an image model       |
| `GET /logo`                 | Retrieve the packaged logo                                               |
| `POST /pet-avatar`          | Upload an additional pack's avatar; built-in `main` is excluded          |
| `POST /voice/speak`         | Synthesize MP3 from text, voice and rate                                 |
| `POST /voice/hear`          | Transcribe base64 PCM16 mono 16 kHz WAV                                  |
| `GET /voice/voices`         | Discover available voice IDs                                             |
| `GET, POST /todos`          | Read or create to-dos                                                    |
| `PATCH, DELETE /todos/{id}` | Update or remove a to-do                                                 |

## State versioning

`GET /state` returns `{ counter, sections, pets }`. Each leaf has `{ counter, data }`; a changed leaf counter is the update signal. Pet IDs are complete keys and can contain dots. Sleep and lock leaves are current state, while animation leaves describe commands.

Long polling requires `since` and `timeout` together and caps the wait at ten seconds. It returns the same snapshot shape on an update or timeout. Consumers keep their own baseline and compare relevant counters.

## Standalone additions

Standalone serves the plugin contract plus root-level `/`, `/health`, `/shutdown` and `/standalone-ai/` setup/chat routes. The setup URL includes a private capability. These root paths are not under the plugin prefix.

Standalone chat works after its model is configured. Balance and DSH session services remain unavailable when the corresponding host capability is absent; failures must be handled explicitly. The [API tester](../../../tools/api-tester.html) is a development consumer, not an authentication bypass.

## Astra Pro 2.0

`GET /dsh-pet-7340/robot` reads cached state; JSON `POST` submits `configure`, `check`, `arm`, `disarm`, `execute`, `speak` or `stop`. Actions require a current session and explicit confirmation; `execute` also consumes one-shot authorization. Business failures use `ok: false`. Standalone requires session authentication for reads and writes. See the [setup and behavior guide](../guides/robot.md) and the `RobotRequest` / `RobotSnapshot` schemas in OpenAPI.
