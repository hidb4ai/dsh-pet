# Configuration and data paths

English · [简体中文](../../zh/reference/configuration.md) · [Documentation](../README.md)

The settings UI and manual files edit the same user configuration. Start with the UI; use the bundled [config.jsonc](../../../dsh-pet/assets/config.jsonc) as the field reference when editing advanced values.

## Paths

`DSH_HOME` defaults to `~/.dsh`. The existing directory name remains `dsh-pet` after the npm package rename.

| Path under `$DSH_HOME/dsh-pet/` | Purpose                                                     |
| ------------------------------- | ----------------------------------------------------------- |
| `main-config.jsonc`             | Default-entry user configuration                            |
| `memory.json`                   | Local chat, scope bindings and pending delivery             |
| `todos.json`                    | User-level to-dos                                           |
| `powercontext/`                 | Managed memory database, runtime and private settings       |
| `standalone-runtime.json`       | Running standalone endpoints, including a private setup URL |
| `pet/<name>-config.json`        | An additional character pack                                |
| `pet/<name>-animation/`         | That pack's animation assets                                |

The settings page's advanced configuration section reports the paths actually used by the process. Do not copy private runtime URLs or credentials into documentation or bug reports.

## Pet instances

| Field                                  | Meaning                                                             |
| -------------------------------------- | ------------------------------------------------------------------- |
| `id`                                   | Stable instance identity; keep it when retaining that pet's history |
| `name`                                 | Display name                                                        |
| `size`                                 | Frame width in pixels; frame aspect ratio is 16:9                   |
| `sizePercent`                          | Optional screen-relative size cap; pixel size remains a ceiling     |
| `display`                              | `web`, `desktop`, `both` or `none`                                  |
| `position.corner`                      | `top-left`, `top-right`, `bottom-left` or `bottom-right`            |
| `position.marginX`, `position.marginY` | Horizontal/vertical offsets                                         |
| `balanceEnabled`                       | Automatic balance display for this pet                              |

Settings can add instances, edit personality and change switches. Additional packs appear as separate kinds; each kind must retain at least one instance. Pack-level animation and persona configuration is preserved when editing its instances.

```jsonc
{
  "pets": [
    {
      "id": "main",
      "name": "Mingyue",
      "size": 462,
      "balanceEnabled": true,
      "display": "both",
      "position": { "corner": "top-right", "marginX": 24, "marginY": 100 },
    },
  ],
}
```

## Configuration groups

| Group                                                  | Controls                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `animations`                                           | Idle, turns, drag, click, movement, categories, event and sleep pools           |
| `animationWeights`                                     | Relative idle/turn/movement selection weights                                   |
| `eventsRefreshSec`                                     | Balance, whisper and sleep-talk periods in seconds                              |
| `physics`                                              | Gravity, bounce, friction, throw strength, collisions, haptics and motion input |
| `sleepStartTexts`, `sleepEndTexts`, `sleepRefuseTexts` | Configurable sleep/wake response pools                                          |
| `notificationsEnabled`                                 | System notifications                                                            |
| `chatAnimationEnabled`                                 | Let a chat response select an available action                                  |
| `chatMemoryRounds`                                     | Recent complete rounds included in prompt context                               |

Recent and recalled text budgets, backend selection and model settings are covered in [memory](../guides/memory.md) and [models](../guides/models.md). Haptics and device-motion controls depend on browser/platform support; motion permissions need a secure context.

## Save and reset

Saving through the settings UI updates supported fields and takes effect without restarting the whole application. The default synchronization/reset action copies the bundled configuration into the user file, including advanced fields; review it before discarding custom changes.

User overrides replace supplied top-level fields as complete values. For example, an `animations` override replaces that pool rather than deep-merging individual entries. Omitted values use packaged defaults; field validation and normalization remain defined by the loader. Keep a copy before manually editing a complex pool and inspect startup diagnostics for invalid values.

## Additional characters

```text
$DSH_HOME/dsh-pet/
├── main-config.jsonc
└── pet/
    ├── otter-config.json
    └── otter-animation/
        ├── idle.webm
        └── wave.webm
```

The filename stem pairs the configuration with its animation directory; instance IDs need not equal that stem. References inside a pack resolve against its own assets. Use distinct IDs and review memory settings per pack. See [the creation guide](../guides/custom-pets.md).
