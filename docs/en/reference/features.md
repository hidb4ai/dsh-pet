# Features and controls

English · [简体中文](../../zh/reference/features.md) · [Documentation](../README.md)

## Interaction and appearance

Click the character to play an interaction; drag and release to move or throw it. The context menu provides animation categories, chat, to-dos, sleep/wake and position reset. Size, corner, margins, display target and physics are configurable per the [configuration reference](configuration.md). Extra pet packs can share animation resources across multiple independently identified instances.

A voice selection changes speech output. A persona changes how the model speaks. A different character requires different artwork/animation assets.

## Chat and whispers

Chat and whispers can select their own models. In DSH, an unset model follows the current conversation; a failed explicit choice can fall back to the current conversation model once. Each pet can override the entry's persona.

Use the menu, hover and press `T`, or use `/chat`; `/pet` changes the target pet. Periodic whispers are optional. Images can come from file selection, screen capture, drag/drop or paste where the runtime supports these paths. Replies can select images from the configured image directory and actions from the animation pool.

The recent-round setting controls prompt context, not the lifetime of the local chat archive. The chat divider shows selected recent context after the byte budget. Messages can be deleted by round or cleared. [PowerContext memory](../guides/memory.md) is optional and separate from recent history.

## Voice

Chat replies and manually requested whispers can be spoken. Automatic periodic whispers and to-do notifications have separate speech switches. Per-reply playback lets you replay a message manually even when automatic playback is disabled.

The built-in synthesis uses online Edge voices. Available voices come from `/voice/voices`; volume is a 0–1 multiplier. The speech bubble waits for synthesis/playback, with a muted indicator on failure or timeout. Audio plays on one eligible surface; desktop takes priority when both displays are active, and hidden web pages do not speak.

Speech input records audio and fills recognized text into the composer. Microphone access needs HTTPS or localhost and an available recognition service. DSH can provide recognition; standalone needs a compatible integration. [Cordis extensions](cordis.md) can replace synthesis and recognition independently.

## Balance

Built-in balance sources include OpenCode Zen Go, Command Code and DeepSeek API/account paths. Unsupported providers display an explanation rather than a fabricated zero. Registered providers may supply money, points, usage windows or custom multi-page content.

Balance can refresh periodically or manually through the menu or `/balance`. Animation bands reflect usage, with the final band reserved for exhaustion. Each pet can disable automatic balance behavior independently.

## DSH work status

The pet can react to thinking, working, organizing, waiting, success and error states. Active states loop with a persistent bubble; success/error play once and their bubble expires after ten seconds. Tool details can name a file, command or active task. This depends on DSH session services; standalone does not create a coding-agent session.

## To-dos

Open the menu or hover and press `D`. Add text with an optional due time; completed items can be toggled or deleted. Upcoming items sort before undated ones. The panel follows the pet, and reminders are scheduled by the host rather than by a page timer.

Reminders become more frequent as the deadline approaches (24h, 12h, 4h, 1h, 20m, 5m within the last week). Overdue reminders use 30-minute intervals during the first day, then six-hour intervals for up to a week. A visible surface is required for delivery. Items are stored in the shared user-level `todos.json`, not separately per pet.

A generated sentence such as “I will remind you” does not create a to-do.

## Sleep

Use the menu, hover and press `S`, or click a sleeping pet to wake it. Sleep suspends normal movement and routine interruptions. Each configured sleep set has start/loop/end segments; only waking returns to the normal animation chain.

Sleep talk can still call a model periodically using the persona and sleep prompt. It displays a bubble without changing the sleep animation or reading it aloud. Check this setting when controlling costs.
