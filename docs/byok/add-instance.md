# Adding Your Own API Key (BYOK)

Yobi's default mode drives the providers' web pages and needs **no API key**. If you *do* have your own key, you can add it as an extra model option (**Bring Your Own Key**). The **Provider** list has presets for ChatGPT (OpenAI), Claude (Anthropic), Gemini (Google), OpenRouter, DeepSeek, Grok (xAI), Groq, Mistral, Perplexity, Qwen (DashScope), Kimi (Moonshot), Cerebras, MiniMax and GLM (Z.ai); **OpenAI-compatible** covers any other endpoint that speaks the OpenAI chat-completions API, including a local Ollama, LM Studio or vLLM server. Prompts sent to one of your keys go straight from your computer to that API instead of through the built-in browser window.

BYOK is an *addition*, not a replacement: the web apps stay the default, and nothing changes unless you pick one of your keys.

## Steps

1. Open **Settings → AI Models → Your Own API Keys (BYOK)**.
2. Click **Add key**.
3. Fill in the fields:

   | Field | What to enter |
   | ----- | ------------- |
   | **Name** | Required. Any label you like; it is what the model menus show (e.g. `OpenAI · GPT-4o mini`). It also becomes the key's Telegram/LINE command: lower-cased, spaces and hyphens turned into `_`, and anything other than `a–z`, `0–9` and `_` dropped (so a name with no Latin letters or digits gets no command) |
   | **Provider** | One of 14 presets (ChatGPT (OpenAI), Claude (Anthropic), Gemini (Google), OpenRouter, DeepSeek, …), or **OpenAI-compatible** for anything else. A preset fills in its Base URL (you can change it) and shows an example model id; OpenAI-compatible leaves the Base URL empty |
   | **Base URL** | The endpoint root. Yobi sends requests to `<Base URL>/chat/completions` |
   | **Model** | The model id the API expects. The box shows an example for the chosen provider; click **Load models** to fetch the list from `<Base URL>/models` and pick from it |
   | **API key** | Your key. Required when adding a key |

4. Optionally click **Test**: Yobi sends a short request and shows the model's reply. Then click **Save**. The key shows up right away in the chat model menu, in flow LLM steps and as a bot command — see [Switching providers](switch-provider.md).

For copy-paste examples, see the [OpenAI-compatible example](openai-compatible-example.md) (with a base-URL table for OpenAI, OpenRouter, Together, Groq, DeepSeek, local, and more) and the [Gemini API example](gemini-example.md).

## Multiple keys and key groups

You can add as many keys as you like and mix providers freely — for example one OpenRouter key per favorite model, plus a Gemini key. Each keeps its own Base URL and model. Each key runs one request at a time across the whole app; a second request for the same key waits for the first.

To spread the load over several keys, open **Key groups (rotation)** below the key list, click **Add group** and tick the keys to rotate across. A group appears in the model menus like a single key. Each request starts with the next key in turn, prefers a key that is idle, and moves on to the next key if one fails. A key that answered HTTP 429 or 503 is tried last until its `Retry-After` time passes (60 seconds if the API gives none, at most 5 minutes).

## How your key is stored

- Keys are encrypted with your **OS keychain** (Electron `safeStorage`) before touching disk — the same treatment as the Telegram bot token and SMTP password. One honest caveat: if the OS keychain can't be used, Electron cannot encrypt, and the key is stored in plain text in the config file with a warning in the log.
- The UI only ever shows a masked preview (`sk-o...f3a9`); the full key is never sent back to the interface.
- Keys are stored in the app's global config only — they are **never written into flow files** (`flows.json`), so exported/shared flows can't leak them.
- A backup made in **Settings → Backup & Restore** holds only the encrypted key, which can't be decrypted on another computer: after restoring there, enter the key again.

## Editing and removing

- **Edit** (pencil icon): change any field. Leave the API key blank to keep the current key.
- **Remove** (trash icon): after you confirm, deletes the key and its stored API key and takes it out of any group. If it was the chat model, chat switches to Gemini; a bot whose **Default model** was this key goes back to **Follow the app default**. Flow steps still pointing at it fail with "BYOK provider not found" until you pick another model.
- The switch at the end of each row hides the key from the model menus without deleting it.

## How the provider type works

The provider type is a convenience: it fills in a default Base URL, shows an example model id, and picks the icon shown in the model menus. It does **not** change how answers are requested: every key gets the same OpenAI-compatible streaming request (`POST <Base URL>/chat/completions` with `Authorization: Bearer <key>`). The one exception is **Load models** against `api.anthropic.com`, which sends the key the way Anthropic's `/models` endpoint expects. To use a service that isn't in the list, pick **OpenAI-compatible** and set its Base URL and Model.
