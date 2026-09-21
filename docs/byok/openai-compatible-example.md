# BYOK Example: OpenAI-compatible Endpoints

The **OpenAI-compatible** provider type works with any service that speaks the OpenAI chat-completions API — `POST <base URL>/chat/completions` with an `Authorization: Bearer <key>` header, returning `choices[0].message.content`. That's the vast majority of API providers today, plus your own local server. Only the **Base URL** and **Model** differ between them; Yobi's call logic is identical.

## Steps

**Settings → Model Sources → Bring Your Own Key (BYOK) → Add instance**, choose provider **OpenAI-compatible**, then set the Base URL and Model for your service and paste your key.

| Field | Value |
| ----- | ----- |
| Name | anything you like (e.g. `OpenAI · GPT-4o mini`) |
| Provider | `OpenAI-compatible` |
| Base URL | your service's endpoint root (default `https://api.openai.com/v1`) |
| Model | the model id your service expects |
| API key | your key |

Yobi appends `/chat/completions` to the Base URL automatically.

## Common providers

All of these are OpenAI-compatible — pick **OpenAI-compatible** and set the Base URL accordingly:

| Provider | Base URL | Example model |
| -------- | -------- | ------------- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini`, `google/gemini-2.5-flash` |
| Together AI | `https://api.together.xyz/v1` | e.g. a Llama or Qwen id from their catalog |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| Local (Ollama) | `http://localhost:11434/v1` | whatever you've pulled, e.g. `llama3.1` |
| Local (LM Studio / vLLM) | `http://localhost:1234/v1` · `http://localhost:8000/v1` | your loaded model id |
| Any other | the endpoint root from your provider's docs (usually ends in `/v1`) | the model id it lists |

Use the exact model id from your provider's model list — a typo yields an HTTP 400/404.

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
