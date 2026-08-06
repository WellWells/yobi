# Adding a BYOK Instance

Yobi's default mode drives the providers' web pages and needs **no API key**. If you *do* have your own key — for any **OpenAI-compatible** endpoint (OpenAI, OpenRouter, Together, Groq, DeepSeek, a local vLLM/Ollama server, …) or Google's [Gemini API](https://ai.google.dev/) — you can add it as an extra provider option (**Bring Your Own Key**). Prompts sent to a BYOK instance go straight to that API over HTTPS instead of through the built-in browser window.

BYOK is an *addition*, not a replacement: browser mode stays the default, and nothing changes unless you actively select a BYOK instance.

## Steps

1. Open **Settings → Accounts → Bring Your Own Key (BYOK)**.
2. Click **Add instance**.
3. Fill in the fields:

   | Field | What to enter |
   | ----- | ------------- |
   | **Name** | Any label you like — this is what appears in the model menus (e.g. `OpenAI · GPT-4o mini`) |
   | **Provider** | `OpenAI-compatible` (the generic type for OpenAI, OpenRouter, Together, Groq, local servers, …) or `Gemini API` — picking one pre-fills a default Base URL you can override |
   | **Base URL** | The endpoint root. Yobi sends requests to `<Base URL>/chat/completions` |
   | **Model** | The model id the API expects (e.g. `gpt-4o-mini`, `google/gemini-2.5-flash` on OpenRouter, `gemini-2.5-flash` on the Gemini API) |
   | **API key** | Your key. Required when creating an instance |

4. Click **Save**. The instance immediately shows up in the chat model menu and in flow LLM steps — see [Switching providers](switch-provider.md).

For copy-paste examples, see the [OpenAI-compatible example](openai-compatible-example.md) (with a base-URL table for OpenAI, OpenRouter, Together, Groq, DeepSeek, local, and more) and the [Gemini API example](gemini-example.md).

## Multiple instances

You can add as many instances as you like and mix providers freely — for example one OpenRouter instance per favorite model, plus a Gemini API instance. Each instance keeps its own key, base URL, and model, and they never interfere with each other.

## How your key is stored

- Keys are encrypted with your **OS keychain** (Electron `safeStorage`) before touching disk — the same treatment as the Telegram bot token and SMTP password. One honest caveat: on systems where the OS keychain is unavailable (e.g. Linux without `libsecret`), Electron cannot encrypt and the key is stored in plaintext in the config file, with a console warning.
- The UI only ever shows a masked preview (`sk-o...f3a9`); the full key is never sent back to the interface.
- Keys are stored in the app's global config only — they are **never written into flow files** (`flows.json`), so exported/shared flows can't leak them.
- A settings backup (Settings → Backup) contains only the encrypted blob, which cannot be decrypted on another machine — after importing a backup elsewhere, re-enter the key.

## Editing and deleting

- **Edit** (pencil icon): change any field. Leave the API key blank to keep the current key.
- **Delete** (trash icon): removes the instance *and* its stored key. If it was your active chat provider, Yobi falls back to the default browser provider; flows still pointing at it will fail with a clear error until you re-point them.

## How the provider type works

The provider type is only a convenience — it pre-fills a default Base URL and a model-id example. It does **not** change how the call is made: every instance is called with the identical OpenAI-compatible request (`POST <Base URL>/chat/completions`, `Bearer` key). So to use any service not listed, pick **OpenAI-compatible** and just set its Base URL and Model. `Gemini API` exists as a separate type only because its Base URL is distinctive and worth pre-filling.
