# Manage PowerContext memory

English · [简体中文](../../zh/guides/memory.md) · [Documentation](../README.md)

Memory is optional. The pet keeps recent chat locally; PowerContext 1.5.0 captures completed text exchanges, extracts facts in the background and retrieves relevant evidence for later replies. Each pet and server endpoint has its own persisted scope and delivery queue.

## Enable managed local memory

In DSH, open **Settings → Pet Config → Local long-term memory**. Select generation and embedding services, verify dimensions, and choose **Check and enable memory**. DSH continues to own the chat model and credentials; these generation settings are for memory extraction.

In standalone mode, open **Quick Start** (the Chinese UI labels it “开始养鱼”). Reuse a working chat configuration or choose a provider, then enable local long-term memory. You can select separate extraction and embedding providers under advanced settings.

Preparation checks models, downloads and verifies uv 0.9.26, and installs Python 3.12 and PowerContext 1.5.0 in the user directory. It needs network access, `curl` and `tar`, and leaves global Python and PATH unchanged. Linux/macOS are supported; Windows preparation is experimental. The UI shows actual steps and elapsed time. You can cancel before final saving, retry a failed preparation, or start chatting after chat configuration succeeds.

The managed service runs on the DSH/standalone host, not the computer displaying a remote browser. It applies to the default pet entry; custom packs keep independent settings. Each pet instance retains its own scope. Only pet dialogue is captured, not DSH coding-agent sessions.

Data, private model settings, runtime and database live under `$DSH_HOME/dsh-pet/powercontext/`. The server binds to loopback with a generated bearer token. One pet process owns a data directory at a time: stop standalone before resuming that directory from DSH. Enabled memory starts with the pet and stops when its owning process exits; no system startup service is installed.

## Connect an existing server

1. Prepare a PowerContext 1.5.0 server with generation, the embeddings required by its retrieval mode, and background memory extraction enabled.
2. Select the PowerContext backend in pet model/context settings and enter its server URL. Local HTTP is allowed; remote servers require HTTPS.
3. For an authenticated external server, set `DSH_PET_POWERCONTEXT_TOKEN` in the pet host's environment. Do not put the token in the URL or pet config. Managed local memory uses its own private token.
4. Tell the pet a distinctive fact, let it leave the recent window, wait for extraction, then ask about it.

Retrying synchronization resends Source records; it does not run extraction. Old chat is not automatically imported. Image bodies, periodic whispers and sleep talk are outside this capture path.

## Budgets and latency

Managed setup starts with 4 recent rounds, 6,000 recent-text bytes and 4,096 recall-text bytes. Existing bindings retain adjusted values. The default foreground recall/single-delivery timeout is 1,500 ms; background generation has a separate 120-second timeout. These are limits, not completion-time guarantees.

Retrieval uses the current question and up to two budgeted recent rounds to understand follow-ups. Recalled content is historical evidence; current user corrections take priority. When PowerContext is explicitly selected, it owns recall/capture instead of a registered third-party Cordis memory backend.

See [token budgeting](token-budget.md) for the difference between bytes, tokens and local storage.

## Read synchronization status

| Status                  | Meaning                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| Pending                 | A completed exchange is saved locally and awaiting delivery       |
| Synced                  | PowerContext accepted the Source; extraction may still be pending |
| Not captured            | Serialized exchange exceeded 65,536 bytes; local chat is retained |
| No relevant memory      | No result was found for this request                              |
| Temporarily unavailable | Recall failed or timed out; chat uses recent context              |

Visible chat pages refresh status about every five seconds. Delivery retries run every 15 seconds, at most two records per batch. Background extraction checks every 30 seconds, but may take longer or decide there is nothing to retain.

Scope identities, source IDs and exact payloads persist across restarts. Changing server URLs does not forward an old queue to a new server. Returning to the old URL allows its queue to continue. A 409 identity conflict stops that binding's delivery: compare local/server data instead of deleting the memory file. Corrupt or unreadable chat files are not overwritten as a recovery shortcut.

## Inspect, correct and forget

Open **Remembered facts** from chat. Active memories are loaded in pages of ten. A detail view shows the current revision and up to three source excerpts, each capped at 2,000 characters. Sources can be raw dialogue JSON; editing a fact does not rewrite its old evidence.

Corrections check the content revision; forgetting checks content and state versions. Refresh an outdated page before retrying. A disconnected request is not evidence of success.

Forgetting marks the atomic memory as `forgotten` and excludes it from long-term recall. It retains sources and old revisions. Recent chat or a new conversation can still contain the same fact. Remove corresponding local messages as well if you want it out of recent context; server retention needs separate management for physical erasure.

## Pause and recover

Use **Pause memory** to stop managed memory and disable automatic startup while keeping data. Use **Resume memory** to restart it. Chat continues with recent history. Changing only the advanced backend selection does not immediately stop an already-running managed process.

A failed new setup retains the old working configuration and attempts to restore the previous service. Port conflicts are reported; the app does not silently choose a new database identity. Embedding endpoint/model/dimensions remain locked for an existing store; see [model migration](models.md#change-an-existing-embedding-model).

## Deletion and disabling

Deleting local chat cancels matching unsent records. It does not retract sent or in-flight data, delete remote memories, or remove the scope binding. Manage a pet's memories before removing the pet, while its UI remains accessible.

Selecting native context stops new PowerContext recall/delivery after saving; in-flight requests may finish. Local chat, bindings and remote data remain. Configured remote model services still receive generation/embedding inputs and may charge for them.

## API boundaries

The [HTTP reference](../reference/http-api.md) and [OpenAPI](../../../openapi.yaml) describe plugin routes under `/dsh-pet-7340/`. Memory includes `/powercontext/setup`, `/chat/powercontext` and `/chat/powercontext/memories`.

Standalone additionally provides `/standalone-ai/setup`, outside the plugin prefix. It requires the local process capability and trusted Host/Origin. GET returns readiness, actual preparation stage, progress and redacted settings. POST accepts start/retry/stop/cancel; accepted asynchronous operations return 202, busy or non-cancellable operations return 409. Invalid input returns 400, missing capability/untrusted origin 403, unsupported media type 415 and unsupported method 405.

DSH setup follows plugin business responses (`200` with `ok`/`reason`) rather than the standalone status-code contract. It does not read or echo DSH chat credentials. Both interfaces reject unknown setup fields and avoid returning raw provider/process errors or secrets.
