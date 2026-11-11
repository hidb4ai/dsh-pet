# Control token usage

English · [简体中文](../../zh/guides/token-budget.md) · [Documentation](../README.md)

Use a small recent window for the current exchange. Enable long-term memory when old facts matter, and account for its background work separately.

## Start with bounded recent context

Managed memory setup initially selects **4 recent rounds**, **6,000 bytes of recent text**, and **4,096 bytes of recalled text**. Existing bindings keep their adjusted values. Native chat defaults to 10 rounds.

The recent limit selects complete, consecutive user/assistant rounds. A zero byte budget means “limit by rounds only”, not “send no history”; use zero rounds to omit recent history. These are UTF-8 byte limits, not token limits. Persona, the current message, time/action metadata, images and protocol overhead are outside these two text budgets.

The chat divider shows the actual recent rounds selected after the byte budget. Full local chat remains on disk. Long-term recall is separate from that divider.

## Turn down unnecessary calls

- Disable periodic whispers if you only want replies when you initiate a conversation.
- Check sleep-talk settings: sleeping can still trigger model calls.
- Keep replies short through the persona when that suits your use.
- Check automatic voice, images and reminder options independently; some use additional services.
- Pause memory when you do not need recall or capture. Chat can continue with recent context.

A different voice does not change the character artwork. A remembered promise is not a scheduled reminder: create an actual to-do item when needed.

## Measure the whole bill

Record chat input/output, cached input, memory extraction and maintenance, retries, embeddings and any missing usage. Track completed answers and fact checks alongside cost. Failed requests with missing usage are unknown, not free.

The [PDF experiments](../explanation/memory-and-cost.md) found:

- Reducing native recent context from 10 to 4 rounds lowered chat input by 35.8%, but lost more old facts.
- Adding memory recovered the target facts and added processing overhead.
- With 1,000 initial rounds reused over 100 questions, estimated known cost was 32.3% lower than a full-history control. This was not a saving against native 10-round chat or a matched-quality result.

Use those observations to choose what to measure; they are not a promised saving for your workload.
