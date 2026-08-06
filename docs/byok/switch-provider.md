# Switching Providers and BYOK Instances

Once you have [added a BYOK instance](add-instance.md), it appears everywhere a provider can be picked — alongside ChatGPT, Gemini, Perplexity, and Duck.ai. Nothing switches to BYOK unless you select it.

## In chat (and for the global hotkey)

Open the **model menu** in the chat composer — BYOK instances are listed under your chosen names with a key icon. Pick one and send: from then on, prompts go to that API.

The model you pick in chat is the **app-wide default target**, so global-hotkey captures use it too. Switch back to a browser provider from the same menu at any time — browser mode is untouched by BYOK and keeps working exactly as before.

## In Flows

Every **LLM step** has a provider dropdown. BYOK instances appear there next to the browser providers:

- Leaving the dropdown on *current provider* uses the app-wide default — including a BYOK instance if that's what you selected in chat.
- Picking a specific instance pins that step to it, regardless of the chat selection.

BYOK LLM steps behave like any other LLM step (`{{variables}}`, `emitFailFlag`, timeouts), but they **don't need the worker browser window** and don't queue behind browser automations — an API call runs as soon as the step starts.

## In the rewrite menu

The *rewrite with model* button on a saved answer shows the same list — pick a BYOK instance to regenerate the answer through your API key.

## Behavior differences vs. browser mode

| | Browser mode | BYOK |
| --- | --- | --- |
| API key | none needed | your own key |
| Login / CAPTCHA | may require sign-in, may pause on verification | never — direct HTTPS call |
| File attachments | Gemini supports uploads | not supported (text only) |
| Prompt length | trimmed to each site's input limit | sent verbatim |
| Cost | free (your account's web quota) | billed by your API provider |

Two small caveats:

- Hotkey captures of a **YouTube link without subtitles** are still routed to the Gemini *browser* provider on purpose — an API model can't watch a video, while Gemini's web app can.
- Each answer's Markdown file records the instance name as its provider, so your history stays attributable.

## When an instance is deleted

Deleting an instance removes its key immediately. If it was the active chat target, Yobi falls back to the default browser provider. A flow step still pinned to the deleted instance fails with *"BYOK provider not found"* until you edit the step and pick another provider.
