# Cordis services

English · [简体中文](../../zh/reference/cordis.md) · [Documentation](../README.md)

`ctx.get('petApi7340')` resolves a service in the current container. The browser service and host service have the same name but different members; they are not visible across containers. Use the [HTTP API](http-api.md) to control speech bubbles, animations, movement and configuration.

## Browser service

| Method              | Return value and behavior                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `pose(petId)`       | `{ x, y, facing }` or `null` if absent from this page; center coordinates are normalized to the viewport |
| `progress(petId)`   | `{ playbackId, anim, currentTime, duration, paused, buffering }` or `null`; times are seconds            |
| `getState()`        | Latest `PollState` snapshot, or `null` before the first poll                                             |
| `menuEvents(owner)` | `{ ok: true, events }`, or `{ ok: false, reason: 'unknown-owner' }`                                      |

A native automatic animation has a null `playbackId`; a requested animation can be followed through its receipt. `duration` is zero before metadata is available. `paused` also becomes true after playback ends; buffering means insufficient ready data or a seek in progress.

`getState()` returns a read-only snapshot reference. Each poll replaces the snapshot; do not mutate it. State leaves use `{ counter, data }`, and a changed counter signals an update. This is page-local memory and makes no network request itself.

`menuEvents()` consumes clicks: every visible label maps to the last clicked pet ID or null, then its flags are cleared. Consecutive clicks on the same label retain only the most recent. Owners with no visible items on this page return `unknown-owner`.

```js
const api = ctx.get("petApi7340");
const pose = api.pose("main");
const state = api.getState();
if (state) console.log(state.counter, state.pets.main?.say?.data);
```

## Host service

The host service exposes `balance`, `voice`, `speech` and `memory`. Each group offers `register(definition)` and `list()`. Lists contain `{ builtin, external }` IDs. Registration returns a disposer; collect it with the plugin lifecycle:

```js
export const inject = ["petApi7340"];

export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.get("petApi7340").balance.register({
        id: "my-gateway",
        async fetch({ provider }) {
          const response = await fetch("http://127.0.0.1:8080/v1/credits", {
            signal: AbortSignal.timeout(20_000),
          });
          if (!response.ok) throw new Error("Credit request failed");
          const credit = await response.json();
          return {
            ok: true,
            provider,
            shape: "points",
            data: {
              unit: "credits",
              total: String(credit.remaining),
              full: String(credit.limit),
            },
          };
        },
      }),
    "my-gateway.balance",
  );
}
```

## Balance providers

`balance.register({ id, fetch })` requires a nonempty unique ID and function. Built-in IDs and IDs owned by another external registration cannot be replaced. `fetch` receives `{ provider }`; credential resolution remains the integration's responsibility. It returns a successful result or throws; host diagnostics normalize thrown failures. The host does not add a timeout or retries around your fetch, so bound your own request.

| `shape`   | `data`                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------- |
| `windows` | `monthly`, optional `rolling` / `weekly`, capacities/reset times and optional rolling label        |
| `money`   | `wallets` with currency, total, granted, topped-up and optional full-balance fields; optional tier |
| `points`  | `unit`, `total`, optional `full`                                                                   |
| `custom`  | `views: CustomNode[]`, or `rows` plus optional `detailRows`; optional used `percent`               |

Custom `views` take precedence and support at most four pages. `rows`/`detailRows` form one or two pages. Click a multi-page bubble to cycle. `percent` drives usage-band animations, clamped to 0–100; missing/non-finite values do not trigger a band.

Custom nodes accept `div`, `span`, `i`, `b`, `strong`, `em` or `img`, with `text`, `children`, allowlisted camelCase `style` and HTTP(S) `src` for images. Limits are depth 6, 200 total nodes, 24 children per node, 120 characters per text fragment, 64 characters per style value and 512 characters per image URL. Oversized text is truncated; invalid styles are dropped. An invalid page invalidates the custom result rather than partially rendering it.

See the [probe plugin](../../../tools/cordis-probe/README.md) for built-in-shape and custom-page examples.

## Speech synthesis

`voice.register({ id, name, synthesize })` installs one active external implementation; later registrations replace earlier ones. IDs cannot use the built-in `edge` name. A disposer clears the slot only if it still owns that slot.

`synthesize({ text, rate })` returns MP3 bytes as `Uint8Array`. Voice selection belongs to your implementation; the request's voice is still validated but not forwarded to it. The host enforces a 15-second synthesis limit. Empty bytes, thrown errors and timeouts fail; there is no silent fallback to Edge after an external implementation is selected. `voiceEnabled` controls automatic playback, not the synthesis provider.

## Speech recognition

`speech.register({ id, name, transcribe })` follows the same single-slot ownership rule; `dsh` is reserved. `transcribe({ audio, language }, signal)` receives raw PCM16 mono 16 kHz WAV bytes and returns text. Empty text is a successful “no speech” result; a non-string is a failure.

The host stops waiting after 30 seconds or client cancellation. Implementations should honor the signal and manage their own concurrency. Recognition is not cached and does not fall back to DSH after an external implementation fails.

## Memory providers

`memory.register({ id, recall?, capture? })` requires at least one hook and reserves the ID `native`. It is a single active slot with ownership-aware disposal.

- `recall({ petId, system, history, userText })` may return replacements for `system`, `history` or `userText`; omitted fields remain unchanged. History entries contain `role`, `content` and `ts`. Undefined, failure or timeout leaves the original content available for the reply.
- `capture({ petId, userText, replyText, action?, image?, ts })` runs after local persistence. It receives names/references, not image bodies. The reply does not wait for it; failures are logged.

When a pet explicitly selects PowerContext, the built-in PowerContext path owns recall/capture and bypasses this external slot. Switching to native mode permits registered hooks again. See the source [provider contract](../../../dsh-pet/src/host/chat-memory-provider.ts) for types.
