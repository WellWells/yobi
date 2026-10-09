<div align="center">

# Yobi

**AI automation for the desktop. Flows run on your own machine, work with the apps installed on it, and need no AI API key.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-blue)](#get-started)
[![Microsoft Store](https://img.shields.io/badge/Microsoft%20Store-Download-0067b8)](https://apps.microsoft.com/detail/9nnx8prfstc9)
[![Electron](https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-brightgreen.svg)](https://github.com/WellWells/yobi/pulls)

**[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md)**

</div>

---

**Yobi** is a flow engine that runs on your desktop. Chain data, AI and actions into an automation, then trigger it on a schedule, from a global hotkey, with a command to your Telegram or LINE bot, from a slash command in the app, or when Yobi starts, the PC wakes, or the screen locks or unlocks. Because it runs on your machine rather than a server, a flow reaches what a hosted tool cannot: LINE on this PC (Windows), your files, your shell, a real browser. The AI steps drive the providers' own web pages, so there is no API key and no per-token bill.

---

## Why Yobi

| Feature | What it does |
| ------- | ------------ |
| **No-code flows** | 50 kinds of step, chained with `{{variables}}`. Add them from a menu and drag to reorder, or describe the automation and let AI build it. |
| **Runs on your PC** | Flows read LINE on this PC (Windows) and use your files, your shell and a browser window; the agent can also work in Thunderbird. Nothing to host. |
| **No API key** | AI steps drive the providers' web pages, not paid APIs. Add your own key only if you want to (BYOK). |
| **An agent that acts** | Switch chat to **Agent** (or type `/agent`) and give it a goal: it picks its own tools and asks before it changes anything. Messages to your Telegram or LINE bot run as the agent too, with the tools you grant each account. |
| **Connectors** | For the agent: Notion, GitHub, Figma, Stripe and more, or any MCP server by URL. Built in: LINE and Thunderbird on this PC, and X. |
| **Five ways to trigger** | Schedule, global hotkey, a command to your Telegram or LINE bot, in-app slash command, system event (Yobi starts, the PC wakes, the screen locks or unlocks). One flow can use several. |
| **Every major AI** | Gemini, Claude, ChatGPT and Perplexity. Pick the model and thinking level for Gemini, Claude and ChatGPT. Gemini and Perplexity work without signing in. |
| **No middleman** | Yobi runs no server of its own. Prompts go to the AI site you picked. Anything else leaves your PC only through a feature that sends it, such as web search, a bot, a share link or a connector. |
| **Multilingual** | English, 繁體中文 and 简体中文 built in, plus drop-in language packs ([guide](language/README.md)). |

---

## Flows

A flow is a chain of steps. Each step's output feeds the next through `{{variables}}`:

```
Schedule   every day at 09:00
    ↓
LINE       → {{chat}}      a group's messages since yesterday
    ↓
Ask AI     → {{summary}}   summarize, pull out decisions and open items
    ↓
Telegram   send {{summary}}
```

You don't have to build one by hand. Describe what you want and AI assembles the whole flow out of the steps below, every one of them still editable afterwards:

> *"Every weekday at 8am, summarize my RSS feed and send it to Telegram."*

The flow above also ships as a template. There are 18 templates to start from: some run on a schedule, some as a command typed in chat or sent to your bot.

**The steps, by kind:**

- **Pull data** — web pages, RSS, HTTP APIs, YouTube transcripts and new videos from your subscriptions, web search and deep research, Google Maps reviews, LINE chats, X posts, replies and trends (trends need an X sign-in), live stock / forex / weather / air quality
- **Scrape a list** — click one headline on the real page; Yobi works out the selectors for the rest
- **Drive a browser** — open tabs, click, fill forms, take screenshots
- **Ask AI** — Gemini, Claude, ChatGPT, Perplexity, or BYOK
- **Send results** — Telegram, LINE, email through your own SMTP account, a file, a PDF, image or share link, the clipboard, a desktop notification
- **Run anything** — programs, JavaScript, shell, plus system and power controls
- **Control flow** — loops, conditions, delays, stopping early, and "only tell me when it changes"

Flows are plain `.json` files. Export one to share it (your variable values and bot account IDs are left out); importing one first shows what it will access.

---

## Connectors

**On this PC.** Both work against an application installed here, not a cloud account:

- **LINE** (Windows) — list chats, search messages, pull a conversation, from the LINE desktop app while it is running. Nothing is sent to LINE and nothing is marked as read. Flows read LINE with the **LINE Messages** step.
- **Thunderbird** — search and read mail, write, reply, forward and file it away, plus calendar, tasks and contacts. Needs the Thunderbird MCP add-on, which **Settings → Connectors** links to. The agent uses it; flows send mail with the **Send Email** step.

**X (Twitter).** Built in: search posts, see what's trending, read an account's latest posts and the replies under a post. Turn it on in **Settings → Connectors** and sign in there (search and trends need it); then mention X or Twitter in a message and the agent looks it up on X. Flows use the **X Accounts**, **X Post & Replies** and **X Trends** steps with the same sign-in. Signed out, they see only each account's newest few posts and a few top replies, and **X Trends** fails.

**Cloud services.** Connect once (most ask you to sign in, GitHub takes a token, the Reference ones need nothing) and the agent can use the connector's tools:

- **Work** — Notion · Linear · Asana · Atlassian (Jira & Confluence) · Airtable · Dropbox · Zapier
- **Development** — GitHub · Sentry · Vercel · Netlify · Supabase · Neon · Cloudflare
- **Design** — Figma · Webflow · Wix
- **Business** — Stripe · Square · PayPal · Intercom
- **Reference** — Context7 · DeepWiki · Microsoft Learn · Cloudflare Docs · Hugging Face

Anything else that speaks MCP works too: paste its URL. Switch any of them on in **Settings → Connectors**, which also walks you through whatever a connector needs. Everything stays off until you do. Anything that writes asks you first. **Always allow this server** skips the question for edits, but sending and deleting are asked every time. From Telegram or LINE, connectors are read-only, and only for the accounts you grant them.

---

## Triggers

| Trigger | For |
| ------- | --- |
| **Schedule** | A digest that arrives every weekday morning |
| **Global hotkey** | A key combination you pick, pressed in any app; the flow can use the text you selected |
| **Telegram or LINE message** | A `/command` you name, sent to your bot from your phone; you choose which paired accounts may run it |
| **Slash command** | `/yourflow`, typed in the app's chat box |
| **System event** | When Yobi starts, after the PC wakes from sleep, or when the screen locks or unlocks (lock and unlock on Windows and macOS only) |

---

## The Agent

Give `/agent` a goal instead of a prompt. It plans, searches, calls its tools, checks its own work, and can save the result as a flow, or change a flow you already have, so it runs on a schedule from then on. A new flow is saved switched off until you turn it on. Reading needs no confirmation. Running a shell command, saving a flow, or using a connector tool that changes something asks you first, and sending or deleting asks every time, even after **Always allow this server**. It reads files only in Yobi's output folder, Documents, Downloads and Desktop, and writes only to the output folder. Anything shaped like a key or token in what its tools read is masked before the model sees it.

In chat, pick **Agent** in the mode menu under the input (or type `/agent`), or turn on **Web** or a connector in the same menu, and the message runs as an agent. In Agent mode it decides for itself whether to go online. With all of them off, it's a normal multi-turn conversation, saved as a Markdown file you can reopen and carry on. A question only a lookup can answer (weather, a stock price, an exchange rate) still goes to the agent, for that one message only. `Shift+Tab` cycles providers and their models, and `Ctrl+G` opens your draft in an external editor. Finished answers render Mermaid diagrams and math. Answers export to PNG, WebP or PDF, and a conversation to an end-to-end encrypted share link.

Personal memory holds short facts about you: your city, what you're working on, how you like your answers. When something worth keeping comes up, the AI saves it and says so under its answer, with **Undo**. You can add, edit or delete facts in **Settings → Personal memory**, where **Tidy up** has the AI suggest merges and deletions, and only the ones you tick are applied.

---

## Get Started

**1. Install:**

On Windows, get it from the [Microsoft Store](https://apps.microsoft.com/detail/9nnx8prfstc9), which installs and updates automatically. Or download the Windows installer or the macOS DMG (Intel & Apple Silicon) from [GitHub Releases](https://github.com/WellWells/yobi/releases). The GitHub builds are unsigned: on Windows, choose **More info → Run anyway** the first time; on macOS, the [release notes](https://github.com/WellWells/yobi/releases) explain how to open it.

**2. Run something in 30 seconds:**

1. (Optional) Gemini (the default) and Perplexity work without an account. To use Claude or ChatGPT, click **Sign in** next to it under **Settings → AI Models**.
2. Highlight any text, in any app.
3. Press **`Alt+G`** (`⌘⌃G` on macOS). Yobi sends it to the AI you picked, copies the answer to your clipboard, and saves the conversation as a Markdown file you can reopen in **Chat**.

From there, open **Flows** and click **Templates**.

<details>
<summary><b>Run from source instead</b> (Node.js 22.12+)</summary>

```bash
git clone https://github.com/WellWells/yobi.git
cd yobi
npm install   # on Windows without Visual Studio: npm install --ignore-scripts
npm run dev
```
</details>

---

## Screenshots

| Flow Editor | `/agent` in Action |
| :---------: | :----------------: |
| <img src="assets/screenshots/flow-editor-rss-step.png" width="400" /> | <img src="assets/screenshots/agent-command-result.png" width="400" /> |
| Fetch, summarize with AI, send to Telegram, on a schedule | Give it a goal; it picks the tools and runs them |

| Main Chat Interface | Model Selection |
| :-----------------: | :-------------: |
| <img src="assets/screenshots/main-chat-interface.png" width="400" /> | <img src="assets/screenshots/model-selection-menu.png" width="400" /> |
| Chat with AI through its web interface | Switch provider, and pick each one's own model |

| Chat History | Export Options |
| :--------------------: | :------------: |
| <img src="assets/screenshots/chat-history-summary-result.png" width="400" /> | <img src="assets/screenshots/export-options-preview.png" width="400" /> |
| Every conversation is saved as a Markdown file you can reopen and continue | Export as PNG, WebP or PDF with custom styles |

---

## Run It From Telegram or LINE

Connect a bot and you can use your AI and your flows from your phone. Telegram takes about two minutes to set up:

1. **Create a bot** — message [@BotFather](https://t.me/BotFather) and copy the token it gives you.
2. **Paste the token**: in **Settings → Bot Integrations**, turn on **Enable Telegram Bot**, paste the token into **Bot Token** and click **Save token**.
3. **Pair your account**: click **Generate Code**, then send `/start <code>` to your bot, or click **Open Telegram**.

LINE needs a few more steps: create a Messaging API channel in the LINE Developers Console, paste its **Channel access token** and **Channel secret** into the LINE card, and open a tunnel so LINE can reach Yobi's local webhook (the card shows the `cloudflared` command). To pair, click **Generate pairing code** and send the person the pairing link; it fills in `/pair <code>` for them.

| Command | Does |
| ------- | ---- |
| `/gemini` · `/claude` · `/gpt` · `/pplx` | Ask with that provider; each BYOK key and key group gets its own command too (names are customizable) |
| `/search` | Search the web and answer with sources (needs the **Web search** permission) |
| `/new` | Start a fresh conversation (also happens on its own after 6 idle hours) |
| `/help` | List the commands you can use (LINE) |
| `/output <mode>` | Set everyone's reply format: `md` · `compact` · `png` · `webp` · `pdf` (Telegram, admin) |
| `/status` | See the work queue (Telegram, admin) |
| `/restart` | Restart Yobi (Telegram, admin) |

Commands are optional: a plain message goes to the bot's **Default model**, and the AI decides on its own whether to look something up or use a tool. Pairing only lets an account chat and use the model commands. Everything else is added per account in the paired list: **Agent**, **Web search**, **Read this computer**, **Run commands** (each command is shown in the chat and runs only after you approve it), connectors, and **Admin** (Telegram only).

A **Bot** trigger in a flow adds a command of your own, such as `/my_cmd`, on both platforms. The text after the command goes into the flow, and you choose who can use it: **Everyone paired** or **Selected people**.

---

## Settings

General · Keyboard shortcuts · Appearance · Export · AI Models · AI Responses · Personal memory · Connectors · Bot Integrations · Statistics · Backup & Restore.

**AI Models** is also where BYOK lives: under **Your Own API Keys (BYOK)**, click **Add key**, pick a provider from the list (OpenAI, Anthropic, Google Gemini, OpenRouter, DeepSeek and more) or **OpenAI-compatible** for any other endpoint, including a local server, and paste your key. It shows up in the chat model menu, in flow LLM steps and as a bot command. **Key groups (rotation)** bundles several keys into one provider that takes turns and moves to the next key when one fails. **Backup & Restore** packs settings (keys and passwords included), flows, saved conversations and memory into a single .zip, and you choose which parts to restore. Keys and passwords restore only on the device that made the backup.

**General → External editor** picks the program that `Ctrl+G` in the message box opens your draft in; each save comes back to the box.

---

## How Yobi Works

By default, every AI request drives the **web interfaces** of Gemini, Claude, ChatGPT and Perplexity. In a built-in browser window Yobi types your prompt into the provider's site and reads the answer back from the page, the same thing you'd do by hand. Gemini and Perplexity work without an account; Claude and ChatGPT need you to sign in once in that window. It uses **no official API and no local model**, which is exactly why it needs no API key and has no fee. (If you add your own API key (BYOK) and pick it, Yobi calls that provider's API directly instead; everything below is about the web interfaces.)

Using the web pages rather than official APIs falls outside the providers' terms of service. Here is exactly what Yobi does. Its browser window presents itself as an ordinary browser, not as Electron: on Windows, Google's sites see Google's own Gemini app for Windows and other sites see Chrome; on macOS, Gemini sees Firefox. When you're signed out of Perplexity, Yobi clears perplexity.ai's cookies and site data before each new conversation (and every 30 minutes), so each new conversation starts as a new visitor. If Perplexity still answers "Sign up and repeat your request", Yobi tries once more as another new visitor. Yobi does not solve CAPTCHAs or rotate IPs. When Claude or Perplexity shows a Cloudflare "verify you're human" page, Yobi stops that request and opens the browser window so you can finish the check, then you send it again. When DuckDuckGo asks for verification, Yobi stops searching for 3 minutes. When Claude says you've reached your usage limit, Yobi tells you what time you can use it again.

**Please use Yobi responsibly**: nothing illegal, and no large-scale or abusive automation. Light personal use is usually just the occasional verification prompt; heavy or abusive use is what gets blocked. Whether to use it on this basis is your call, and providers' terms can change, so check them yourself. This isn't legal advice.

---

## Security & Privacy

- **Where your prompts go** — to the AI you picked: typed into its own web page, or sent to your BYOK endpoint. In chat and agent runs, your personal memory and answer preferences go with them. That text is subject to the provider's privacy policy.
- **No middleman, no telemetry** — Yobi has no server and no account, so nothing is proxied through us and there's zero analytics. Conversations, flows, personal memory and exports are plain files on your disk, and the automation logic is auditable in `src/main/`.
- **What else leaves your machine** — web searches go to DuckDuckGo, and the pages they find are fetched directly. In chat the agent may search on its own unless you switch **Web** off in that conversation; flows search only in their **Web Search** and **Deep Research** steps. A share link carries the whole conversation, encrypted in the app before it's uploaded to a PrivateBin server (privatebin.net unless you set your own); the key lives in the link's `#fragment`, which browsers never send to the host. Connectors talk only to the services you add: the LINE one reads LINE's data on this PC, and the Thunderbird one talks to Thunderbird on this PC. At startup Yobi checks GitHub for a new version (the Microsoft Store build doesn't).
- **The agent asks before it changes things** — reading needs no confirmation. Every shell command, every flow it saves or edits, and every connector tool that changes something needs your confirmation; sending and deleting are asked every time, even after **Always allow this server**. The agent reads files only in Yobi's output folder, Documents, Downloads and Desktop, and writes files only to the output folder, which needs no confirmation. Anything shaped like a key or token in what its tools read is masked before the model sees it.
- **Bots get only what you grant** — pairing lets an account chat and use the model commands. **Agent**, **Web search**, **Read this computer**, **Run commands**, connectors and **Admin** are granted per account under **Settings → Bot Integrations**; marking an account as **Me** grants everything except Run commands and Admin. A command a bot wants to run is shown in the chat and runs only after you pick **Run**. Files, commands and connectors work only in private chats, and a bot can never change connector data.
- **Encrypted credentials** — your Telegram and LINE tokens, SMTP password, BYOK and other API keys, connector sign-ins and the LINE database key are encrypted with the operating system's key store (Electron `safeStorage`) before touching disk.

---

## Guides

Longer walkthroughs, with screenshots:

- [Yobi: AI automation that drives ChatGPT & Gemini through their web interfaces](https://wellstsai.com/en/post/yobi-free-ai-automation/) — what it does and how to set it up
- [Build an AI Telegram news bot from RSS, with no server and no API key](https://wellstsai.com/en/post/telegram-bot-rss-ai-digest/) — one flow, start to finish
- [How to get a free LLM API key: Gemini and OpenRouter quotas, tested](https://wellstsai.com/en/post/free-ai-api-key/) — if you'd rather run BYOK

---

## Development

```bash
npm run dev         # dev mode: the UI reloads live; press Enter to restart Electron after main-process changes
npm run typecheck   # TypeScript type checking
npm run i18n:check  # compare language/*.json with the source; deletes keys the code no longer uses
npm run build:win   # build Windows (NSIS installer)
npm run build:msix  # build Windows (MSIX for the Microsoft Store)
npm run build:mac   # build macOS (DMG)
```

**Stack:** Electron · React + TypeScript · Mantine · Zustand · Vite + electron-builder · grammY · LINE Bot SDK · MCP SDK

---

## Contributing

Issues and PRs are welcome. Fork, branch (`git checkout -b feat/my-feature`), make sure `npm run typecheck` passes, and open a PR with a clear description. Text users see goes in `language/*.json`, in all three built-in languages (en-US, zh-TW, zh-CN); to add another language, see [language/README.md](language/README.md). For big changes, open an issue first to talk it through.

---

## License

[**MIT**](LICENSE) — free to use, modify and distribute.

---

<div align="center">

If Yobi saves you time, please ⭐ **Star** the repo — it helps others find it!

**[Report a Bug](https://github.com/WellWells/yobi/issues) · [Request a Feature](https://github.com/WellWells/yobi/issues) · [Discussions](https://github.com/WellWells/yobi/discussions)**

</div>
