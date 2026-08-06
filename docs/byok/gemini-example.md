# BYOK Example: Gemini API

Google offers the Gemini API free of charge at a limited usage tier, and exposes an [OpenAI-compatible endpoint](https://ai.google.dev/gemini-api/docs/openai) — which is what Yobi's BYOK mode uses. What the free tier covers, and the rate limits that come with it, change over time: check Google's own [pricing](https://ai.google.dev/gemini-api/docs/pricing) and [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) pages for the current terms.

> Not to be confused with the built-in **Gemini browser provider** — that one automates the gemini.google.com web page and needs no key. This page is about calling the official API with your own key.

## 1. Get a key

1. Open [Google AI Studio](https://aistudio.google.com/).
2. Click **Get API key** and create one for your project.

## 2. Add the instance in Yobi

**Settings → Accounts → Bring Your Own Key (BYOK) → Add instance**, then:

| Field | Value |
| ----- | ----- |
| Name | `Gemini API` (anything you like) |
| Provider | `Gemini API` |
| Base URL | `https://generativelanguage.googleapis.com/v1beta/openai` (pre-filled) |
| Model | `models/gemini-3.1-flash-lite` |
| API key | your Gemini API key |

Yobi appends `/chat/completions` to the Base URL automatically. Any current model id from the [Gemini model list](https://ai.google.dev/gemini-api/docs/models) works — a `flash-lite` model is the cheapest and fastest, and a `pro` model is the one to reach for on harder tasks. Model ids come and go, so take the exact id from that list rather than copying an old one.

## 3. Use it

Pick the instance in the chat model menu or in a flow LLM step — see [Switching providers](switch-provider.md).

## Troubleshooting

| Error | Likely cause |
| ----- | ------------ |
| `HTTP 400` | Model id misspelled or not available on the OpenAI-compat endpoint |
| `HTTP 401` / `403` | Key invalid, or the API isn't enabled for your project |
| `HTTP 429` | Free-tier rate limit hit — wait a minute or upgrade the quota |
