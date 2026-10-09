# BYOK Example: OpenAI-compatible Endpoints

The **OpenAI-compatible** provider type works with any service that speaks the OpenAI chat-completions API — `POST <base URL>/chat/completions` with an `Authorization: Bearer <key>` header. Yobi asks for a streamed reply (`"stream": true`) and also accepts a plain `choices[0].message.content` reply. That's the vast majority of API providers today, plus your own local server. Only the **Base URL** and **Model** differ between them; Yobi's call logic is identical.

## Steps

**Settings → AI Models → Your Own API Keys (BYOK) → Add key**. If your service is in the **Provider** list, pick it and the Base URL is filled in for you; otherwise pick **OpenAI-compatible** and enter the Base URL yourself. Then set the Model and paste your key.

| Field | Value |
| ----- | ----- |
| Name | anything you like (e.g. `OpenAI · GPT-4o mini`) |
| Provider | the matching preset, or `OpenAI-compatible` |
| Base URL | filled in by a preset (e.g. `https://api.openai.com/v1` for ChatGPT (OpenAI)); empty for OpenAI-compatible, so paste your service's endpoint root |
| Model | the model id your service expects |
| API key | your key |

Yobi appends `/chat/completions` to the Base URL automatically.

## Common providers

Providers in the **Provider** list get their Base URL filled in; for the rest, pick **OpenAI-compatible** and paste the Base URL. Besides the ones below, the list also has Claude (Anthropic), Grok (xAI), Mistral, Perplexity, Qwen (DashScope), Kimi (Moonshot), Cerebras, MiniMax and GLM (Z.ai).

| Provider | Pick in the list | Base URL | Example model |
| -------- | ---------------- | -------- | ------------- |
| OpenAI | ChatGPT (OpenAI) | `https://api.openai.com/v1` | `gpt-4o-mini` |
| OpenRouter | OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini`, `google/gemini-2.5-flash` |
| Together AI | OpenAI-compatible | `https://api.together.xyz/v1` | e.g. a Llama or Qwen id from their catalog |
| Groq | Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| DeepSeek | DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Local (Ollama) | OpenAI-compatible | `http://localhost:11434/v1` | whatever you've pulled, e.g. `llama3.1` |
| Local (LM Studio / vLLM) | OpenAI-compatible | `http://localhost:1234/v1` · `http://localhost:8000/v1` | your loaded model id |
| Any other | OpenAI-compatible | the endpoint root from your provider's docs (usually ends in `/v1`) | the model id it lists |

Use the exact model id from your provider's model list — a typo yields an HTTP 400/404. **Load models** fetches that list from `<Base URL>/models` so you can pick instead of typing; **Test** sends a short request and shows the reply before you save.

## Getting a key

Each provider issues keys from its own dashboard. For OpenRouter it's the **Keys** page (`sk-or-v1-…`); for OpenAI it's the API keys page (`sk-…`); local servers usually accept any non-empty string. Whatever the key, paste it into the API key field.

## Troubleshooting

| Error | Likely cause |
| ----- | ------------ |
| `HTTP 401` / `403` | Wrong, revoked, or missing key — re-paste it |
| `HTTP 402` | Out of credits (paid providers) |
| `HTTP 400` / `404` (model) | Model id misspelled or not offered by this endpoint |
| `HTTP 429` | Rate limit — wait, or switch model/tier |
| connection refused | Local server not running, or wrong Base URL/port |
