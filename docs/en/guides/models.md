# Choose model services

English · [简体中文](../../zh/guides/models.md) · [Documentation](../README.md)

The three model roles are configured separately:

| Role              | DSH plugin                                     | Standalone                                     |
| ----------------- | ---------------------------------------------- | ---------------------------------------------- |
| Chat              | Keep using the DSH model selection             | Configure in Quick Start / AI settings         |
| Memory extraction | Configure under Local long-term memory         | Reuse chat or choose a separate service        |
| Embeddings        | Choose a text embedding service and dimensions | Choose a text embedding service and dimensions |

Presets include DeepSeek, OpenAI, Qwen (Beijing/Singapore), SiliconFlow, Volcengine Ark, Zhipu, Kimi, Ollama, LiteLLM and custom OpenAI-compatible endpoints. Presets describe supported connection shapes; they do not guarantee that your account has a given model. Services without an embedding preset are not offered for that role.

## Connect a provider

1. Choose a preset and check its endpoint. Use the endpoint and API key for your own account and region.
2. Enter the key. Click **Fetch models**, then select a suggestion or enter a model/deployment ID manually.
3. For memory, select generation and embedding settings independently. Match the embedding dimension to the model's actual output.
4. Run the connection check before enabling memory. A discovered model name is not proof that an account can invoke it.

The wizard uses OpenAI-compatible Chat Completions and text Embeddings. A multimodal embedding endpoint is not a drop-in replacement. Fixed-dimension models may need the `dimensions` request parameter omitted; presets handle this while still checking the returned vector length.

Endpoint edits clear the draft key. Saved keys are reused only at the same complete endpoint, including its path. Keys are not echoed back into the browser.

## Local models and gateways

For Ollama, start the service and download the models before selecting them. Enter model names and vector dimensions; an unauthenticated local service can leave the key empty.

LiteLLM is optional and separately deployed. Use its gateway URL, key and model aliases. Selecting the preset does not install a gateway. For a protocol outside the setup wizard, use the standalone model configuration or connect a separately configured PowerContext server.

## Change an existing embedding model

A saved memory store locks the embedding endpoint, model and dimensions. Key rotation remains possible. Equal dimensions do not make two models' vector spaces compatible.

Keep the old store, prepare a separate PowerContext service with a new directory, re-ingest retained source conversations, and verify recall before changing the pet's memory server. There is no automatic vector migration. Switching back to the old URL restores access to the retained store.

Next: [manage memory](memory.md) · [token budget](token-budget.md).
