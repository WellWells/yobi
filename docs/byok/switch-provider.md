# Switching to Your Own API Key

Once you have [added a key](add-instance.md), it appears everywhere a model can be picked, next to Gemini, Claude, ChatGPT and Perplexity. Nothing switches to it unless you pick it.

## In chat (and for the global hotkey)

Open the **model menu** in the chat composer. Your keys are listed under **Your Own API Keys (BYOK)** by the names you gave them, with the provider's logo (a key icon for providers without one), and groups under **Key groups (rotation)**. Pick one and send: from then on, prompts go to that API. **Shift+Tab** and `/model` step through them too.

The model you pick in chat is the **app-wide default target**, so global-hotkey captures use it too. Switch back to a browser provider from the same menu at any time — browser mode is untouched by BYOK and keeps working exactly as before.

## In Flows

Every **LLM step** has a **Model** dropdown. Your keys and groups appear there next to the web apps:

- Leaving it on **Use current (from Settings)** uses the model currently picked in chat — including one of your keys if that's what you picked.
- Picking a specific key or group pins that step to it, regardless of the chat selection.

BYOK LLM steps behave like any other LLM step (`{{variables}}`, `emitFailFlag`, timeouts), but they **don't need the worker browser window** and don't queue behind browser automations. Each key runs one request at a time across the whole app, so two steps on the same key take turns; a group runs up to one request per key at once.

## In the rewrite menu

**⋮ → Rewrite with...** in a conversation's header shows the same list — pick one of your keys to send the prompt again through your API key; the answer opens as a new conversation.

## In Telegram and LINE

Each key, and each group that has keys, is also a bot command named after it (a key named `Gemini Flash` is `/gemini_flash`); turn each one on or off under **Settings → Bot Integrations → Bring Your Own Key (BYOK) commands**. A bot's **Default model** can be one of your keys too.

## Behavior differences vs. browser mode

| | Browser mode | BYOK |
| --- | --- | --- |
| API key | none needed | your own key |
| Login / CAPTCHA | may require sign-in, may pause on verification | never — direct API call |
| File attachments | Gemini, Claude and ChatGPT accept up to 10 files; Perplexity none | not supported (text only) |
| Prompt length | trimmed to each site's input limit | your message is sent in full; earlier turns are cut to fit 32,000 characters |
| Follow-up messages | continue the same chat on the provider's site | the earlier turns are sent again with every message (they count toward your bill) |
| Cost | free (your account's web quota) | billed by your API provider |

Two small caveats:

- A **YouTube link without captions**, captured with the hotkey or pasted in chat, still goes to the Gemini *web* provider on purpose, since it can watch the video itself. In a flow, the YouTube step handles the same case with a Gemini key you pick under **When there are no captions** — Google's Gemini API is the only one that reads a YouTube URL, so keys for other services won't do.
- Each answer's Markdown file records the key's name as its provider, so your history stays attributable.

## When a key is removed

Removing a key deletes its stored API key right away and takes it out of its groups. If it was the chat model, chat switches to Gemini (the same happens when the chat model is a group that just lost its last key). A bot whose **Default model** was this key goes back to **Follow the app default**. A flow step still pinned to it fails with *"BYOK provider not found"* until you edit the step and pick another model.
