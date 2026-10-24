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

**Yobi** runs automations on your desktop. A flow chains data, AI and actions, and runs on a schedule, a hotkey, a bot command, a new file in a folder or a system event. It runs on your PC, so a flow can use LINE on this PC (Windows), your files, your shell and a real browser. AI steps use the providers' own web pages: no API key, no per-token bill.

<!-- demos:hero:start -->
<p align="center"><img src="assets/demos/en-US/agent.webp" alt="Multi-step tasks with the agent" width="100%" /></p>
<!-- demos:hero:end -->

---

## Why Yobi

| Feature | What it does |
| ------- | ------------ |
| **No-code flows** | 60 kinds of step, chained with `{{variables}}`. Add them from a menu, or describe the automation and let AI build it. |
| **Runs on your PC** | LINE on this PC (Windows), your files, your shell, a browser window and Thunderbird. Nothing to host. |
| **No API key** | AI steps drive the providers' web pages. Add your own key (BYOK) if you prefer. |
| **An agent that acts** | Give `/agent` a goal; it picks its tools and asks before it changes anything. Messages to your bots run as the agent too, with the tools you grant each account. |
| **Connectors** | Notion, GitHub, Figma, Stripe and more, or any MCP server by URL. Built in: LINE, Thunderbird, your mailboxes and X. |
| **Triggers** | Schedule, global hotkey, bot command, in-app slash command, new file in a folder, system event. |
| **AI providers** | Gemini, Claude, ChatGPT and Perplexity. Gemini and Perplexity work signed out. |
| **No middleman** | Yobi has no server. Prompts go straight to the AI site you picked. |
| **Languages** | English, 繁體中文 and 简体中文, plus language packs ([guide](language/README.md)). |

---

<!-- demos:start -->
## See It in Action

<table>
<tr>
<td width="33%" valign="top">
<a href="assets/demos/en-US/flow-build.webp"><img src="assets/demos/en-US/flow-build.webp" alt="Build a flow from a description" width="100%" /></a>
<br /><b>Build a flow from a description</b>
<br /><sub>A one-sentence description becomes a flow that runs as is or can be edited step by step.</sub>
</td>
<td width="33%" valign="top">
<a href="assets/demos/en-US/writing.webp"><img src="assets/demos/en-US/writing.webp" alt="Rewrite a selected passage" width="100%" /></a>
<br /><b>Rewrite a selected passage</b>
<br /><sub>Rewrites only the selected passage of an answer, in place in the Markdown.</sub>
</td>
<td width="33%" valign="top">
<a href="assets/demos/en-US/telegram.webp"><img src="assets/demos/en-US/telegram.webp" alt="Google Maps reviews over Telegram" width="100%" /></a>
<br /><b>Google Maps reviews over Telegram</b>
<br /><sub>A Google Maps link sent to the Telegram bot is analyzed on the desktop, and the review summary is sent back.</sub>
</td>
</tr>
<tr>
<td width="33%" valign="top">
<a href="assets/demos/en-US/downloader.webp"><img src="assets/demos/en-US/downloader.webp" alt="Download video from a post link" width="100%" /></a>
<br /><b>Download video from a post link</b>
<br /><sub>Saves the video from a pasted post link; questions about the post are also supported.</sub>
</td>
<td width="33%" valign="top">
<a href="assets/demos/en-US/notion.webp"><img src="assets/demos/en-US/notion.webp" alt="Import and edit a Notion page" width="100%" /></a>
<br /><b>Import and edit a Notion page</b>
<br /><sub>Imports a Notion page for AI-assisted editing and syncs the changes back to Notion.</sub>
</td>
<td width="33%" valign="top">
<a href="assets/demos/en-US/thunderbird.webp"><img src="assets/demos/en-US/thunderbird.webp" alt="Summarize email in Thunderbird" width="100%" /></a>
<br /><b>Summarize email in Thunderbird</b>
<br /><sub>Summarizes messages from Thunderbird on this PC.</sub>
</td>
</tr>
<tr>
<td width="33%" valign="top">
<a href="assets/demos/en-US/files.webp"><img src="assets/demos/en-US/files.webp" alt="Summarize files on this PC" width="100%" /></a>
<br /><b>Summarize files on this PC</b>
<br /><sub>Reads files on this PC and summarizes them in one place.</sub>
</td>
</tr>
</table>
<!-- demos:end -->

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

Or describe it and AI builds the flow for you; every step stays editable:

> *"Every weekday at 8am, summarize my RSS feed and send it to Telegram."*

There are 28 templates to start from, run on a schedule, by a hotkey on selected text, or as a command in chat or to your bot.

**Steps:**

- **Pull data** — web pages, RSS, HTTP APIs, YouTube transcripts and new videos, web search and deep research, Google Maps reviews, LINE chats, Telegram groups, X posts, replies and trends, new mail, your calendar, stocks, forex, weather, air quality
- **Use a connector** — any tool of a connector you've added, such as Notion or Jira
- **Scrape a list** — click one headline on the page and Yobi finds the rest
- **Drive a browser** — open tabs, click, fill forms, take screenshots
- **Ask AI** — Gemini, Claude, ChatGPT, Perplexity or BYOK
- **Send results** — Telegram, LINE, Discord, Slack, email, a file, PDF, image or share link, the clipboard, a notification
- **Run anything** — programs, JavaScript, shell, system and power controls
- **Control flow** — loops, conditions, delays, stop early, "only tell me when it changes"

Flows are plain `.json` files. An export leaves out your variable values and bot account IDs; an import shows what the flow will access first.

---

## Connectors

**On this PC:**

- **LINE** (Windows) — list chats, search messages and read conversations from the running LINE desktop app. It sends nothing and marks nothing as read. Flows use the **LINE Messages** step.
- **Thunderbird** — search, read, write, reply, forward and file mail, plus calendar, tasks and contacts. Needs the Thunderbird MCP add-on (linked in **Settings → Connectors**). Flows send mail with the **Send Email** step.

**Mail.** Add mailboxes in **Settings → Connectors → Mail**: Gmail, Yahoo or iCloud with an app password, Outlook, Hotmail or Microsoft 365 with **Sign in with Microsoft**, or any IMAP/SMTP server. The agent searches all of them and can read, save attachments, draft, reply, send, file and trash mail; sending and trashing ask every time. Flows use **Read new mail** and **Send Email**.

**X (Twitter).** Search posts, see trends, read an account's latest posts and the replies to a post. Turn it on and sign in under **Settings → Connectors**; search and trends need the sign-in. Mention X or Twitter in a message and the agent looks there. Flows use **X Accounts**, **X Post & Replies** and **X Trends**. Signed out, you get each account's newest few posts and top replies, and no trends.

**Cloud services.** Connect once (most ask you to sign in, GitHub takes a token, Reference needs nothing):

- **Work** — Notion · Linear · Asana · Atlassian (Jira & Confluence) · Airtable · Dropbox · Zapier
- **Development** — GitHub · Sentry · Vercel · Netlify · Supabase · Neon · Cloudflare
- **Design** — Figma · Webflow · Wix
- **Business** — Stripe · Square · PayPal · Intercom
- **Reference** — Context7 · DeepWiki · Microsoft Learn · Cloudflare Docs · Hugging Face

Any other MCP server works too: paste its URL. Everything is off until you turn it on in **Settings → Connectors**. Anything that writes asks first; **Always allow this server** skips that for edits, never for sending or deleting.

---

## Triggers

| Trigger | For |
| ------- | --- |
| **Schedule** | A digest every weekday morning |
| **Global hotkey** | A key combination in any app; the flow gets the selected text |
| **Bot message** | A `/command` you name, sent to your Telegram, LINE, Discord or Slack bot; you choose which paired accounts may use it |
| **Slash command** | `/yourflow` in the app's chat box |
| **New file** | Each file saved, downloaded or moved into a folder, once it finishes writing |
| **System event** | Yobi starts, the PC wakes, or the screen locks or unlocks (lock and unlock on Windows and macOS only) |

---

## The Agent

Give `/agent` a goal instead of a prompt. It plans, searches, calls tools and checks its work, and it can save the result as a flow, or change one you have, to run on a schedule. New flows are saved switched off. What it asks before acting is under [Security & Privacy](#security--privacy).

In chat, pick **Agent** in the mode menu under the input, or turn on **Web** or a connector there. With all of them off, chat is a normal conversation saved as a Markdown file you can reopen. A question that needs a lookup (weather, a stock price, an exchange rate) still goes to the agent, for that one message.

`Shift+Tab` cycles providers and models; `Ctrl+G` opens your draft in an external editor. Answers render Mermaid and math and export to PNG, WebP or PDF; a conversation can become an end-to-end encrypted share link.

Personal memory keeps short facts about you, such as your city or how you like answers. The AI saves one when it comes up and shows it under the answer with **Undo**. Edit them in **Settings → Personal memory**; **Tidy up** suggests merges and deletions, and only the ones you tick apply.

---

## Get Started

**1. Install:**

```bash
brew install --cask wellwells/tap/yobi   # macOS (Intel & Apple Silicon)
```

Or get it from the [Microsoft Store](https://apps.microsoft.com/detail/9nnx8prfstc9) (Windows, updates automatically) or [GitHub Releases](https://github.com/WellWells/yobi/releases) (Windows installer, macOS DMG). GitHub builds are unsigned: on Windows choose **More info → Run anyway**; for macOS see the [release notes](https://github.com/WellWells/yobi/releases).

**2. Try it:**

1. Gemini (the default) and Perplexity work without an account. For Claude or ChatGPT, click **Sign in** next to it in **Settings → AI Models**.
2. Select some text in any app.
3. Press **`Alt+G`** (`⌘⌃G` on macOS). The answer is copied to your clipboard and the conversation is saved in **Chat**.

**`Alt+J`** (`⌘⌃J` on macOS) does the same for part of the screen: drag a box, then ask about it.

Then open **Flows → Templates**.

<details>
<summary><b>Run from source</b> (Node.js 22.12+)</summary>

```bash
git clone https://github.com/WellWells/yobi.git
cd yobi
npm install   # on Windows without Visual Studio: npm install --ignore-scripts
npm run dev
```
</details>

---

## Screenshots

| Flow Editor | `/agent` |
| :---------: | :------: |
| <img src="assets/screenshots/flow-editor-rss-step.png" width="400" /> | <img src="assets/screenshots/agent-command-result.png" width="400" /> |
| Fetch, summarize with AI, send to Telegram on a schedule | Give it a goal; it picks the tools |

| Chat | Model Selection |
| :--: | :-------------: |
| <img src="assets/screenshots/main-chat-interface.png" width="400" /> | <img src="assets/screenshots/model-selection-menu.png" width="400" /> |
| Chat through the AI's web page | Switch provider and model |

| Chat History | Export |
| :----------: | :----: |
| <img src="assets/screenshots/chat-history-summary-result.png" width="400" /> | <img src="assets/screenshots/export-options-preview.png" width="400" /> |
| Conversations are Markdown files you can reopen | PNG, WebP or PDF, with custom styles |

---

## Run It From Your Phone

Connect a Telegram, LINE, Discord or Slack bot to use your AI and flows from your phone. Telegram takes about two minutes:

1. Message [@BotFather](https://t.me/BotFather) to create a bot and copy its token.
2. In **Settings → Bot Integrations**, turn on **Enable Telegram Bot**, paste the token into **Bot Token** and click **Save token**.
3. Click **Generate Code** and send `/start <code>` to your bot, or click **Open Telegram**.

**LINE:** create a Messaging API channel in the LINE Developers Console, paste its **Channel access token** and **Channel secret** into the LINE card, and open a tunnel to Yobi's local webhook (the card shows the `cloudflared` command). To pair, click **Generate pairing code** and send the person the link.

**Discord and Slack** connect out from this PC, so no tunnel is needed. Discord: create an application in the Developer Portal and paste its bot token. Slack: create the app from the manifest on the Slack card and paste its two tokens. Pairing works like LINE.

An unpaired person who messages the bot privately is asking to join. Allow or block them in **Settings → Bot Integrations**; Telegram and LINE also send you a card with **Allow** and **Block**.

| Command | Does |
| ------- | ---- |
| `/gemini` · `/claude` · `/gpt` · `/pplx` | Ask that provider; each BYOK key and key group gets its own command too (names are customizable) |
| `/search` | Search the web and answer with sources (needs **Web search**) |
| `/new` | Start a new conversation (also happens after 6 idle hours) |
| `/help` | List the commands you can use (LINE) |
| `/output <mode>` | Set everyone's reply format: `md` · `compact` · `png` · `webp` · `pdf` (Telegram, admin) |
| `/status` | See the work queue (Telegram, admin) |
| `/restart` | Restart Yobi (Telegram, admin) |
| `/users` · `/invite` · `/groups` | Handle join requests and permissions, send an invite link that expires, choose which groups may use the bot (Telegram admins; on LINE, only you) |

A plain message goes to the bot's **Default model**, which decides whether to search or use a tool. Pairing only allows chatting and the model commands. Grant more per account: **Agent**, **Web search**, **Read this computer**, **Run commands** (each command waits for your approval), connectors and **Admin** (Telegram only).

You and your admins can ask the bot in a private chat to build or change a flow, such as "every morning at 8, send me the weather". The bot asks you before saving. Flows that run things on your PC, and admin-built flows that read your data or act as you (save files, send mail, open pages in your signed-in browser), are saved switched off for you to check on the desktop.

A **Bot** trigger adds your own command, like `/my_cmd`, on every platform. Text after the command goes into the flow; it's available to **Everyone paired** or **Selected people**.

---

## Settings

AI Models · AI Responses · Personal memory · Connectors · Bot Integrations · General · Appearance · Notifications · Links & downloads · Export · Keyboard shortcuts · Statistics · Backup & Restore.

**BYOK:** in **AI Models → Your Own API Keys (BYOK)**, click **Add key** and pick a provider (OpenAI, Anthropic, Google Gemini, OpenRouter, DeepSeek and more), or **OpenAI-compatible** for any other endpoint, including a local server. The key shows up in the chat model menu, in flow AI steps and as a bot command. **Key groups (rotation)** take turns across several keys and move on when one fails.

**Backup & Restore** saves settings (keys and passwords included), flows, conversations and memory to one .zip, and you choose what to restore. Keys and passwords restore only on the device that made the backup.

---

## How Yobi Works

By default every AI request goes through the provider's **web page**. Yobi types your prompt into Gemini, Claude, ChatGPT or Perplexity in a built-in browser window and reads the answer back. Gemini and Perplexity work signed out; Claude and ChatGPT need one sign-in in that window. No official API and no local model, so no key and no fee. (A BYOK key you pick calls that provider's API instead.)

Using the web pages this way is outside the providers' terms of service. What Yobi does:

- Its browser window identifies as a normal browser, not Electron. On Windows, Google's sites see Google's Gemini app for Windows and other sites see Chrome; on macOS, Gemini sees Firefox.
- Signed out of Perplexity, it clears perplexity.ai's cookies and site data before each new conversation and every 30 minutes. If Perplexity still asks you to sign up, it retries once as a new visitor.
- It does not solve CAPTCHAs or rotate IPs. On a Cloudflare check from Claude or Perplexity, it stops and opens the window so you can finish it. When DuckDuckGo asks for verification, search pauses for 3 minutes. When Claude reports a usage limit, Yobi tells you when it resets.

Use it responsibly: nothing illegal, no large-scale or abusive automation. Light personal use usually means an occasional verification prompt. Providers' terms change, so check them yourself. This isn't legal advice.

---

## Security & Privacy

- **Prompts** go to the AI you picked, through its web page or your BYOK endpoint. Chat and agent runs include your personal memory and answer preferences. The provider's privacy policy applies.
- **No server, no telemetry.** Yobi has no account and no analytics. Conversations, flows, memory and exports are plain files on your disk.
- **What else leaves your PC.** Web searches go to DuckDuckGo, and result pages are fetched directly. In chat the agent may search unless you turn **Web** off; flows search only in the **Web Search** and **Deep Research** steps. A share link is encrypted in the app before it's uploaded to PrivateBin (privatebin.net unless you set your own); the key stays in the link's `#fragment`, which browsers never send. Connectors talk only to the services you add. Yobi checks GitHub for updates at startup (the Store build doesn't).
- **The agent asks first.** Reading needs no confirmation. Shell commands, saving or editing flows, and connector tools that change things need your OK; sending and deleting ask every time, even with **Always allow this server**. It reads files only in Yobi's output folder, Documents, Downloads and Desktop, and writes only to the output folder. Anything that looks like a key or token is masked before the model sees it.
- **Bots get what you grant.** Permissions are set per account in **Settings → Bot Integrations**; marking an account **Me** grants everything except Run commands and Admin. Files, commands and connectors work only in private chats, and a connector change from a bot runs only in your own private chat after you confirm.
- **Encrypted credentials.** Bot tokens, mailbox passwords and Microsoft sign-ins, API keys, connector sign-ins and the LINE database key are encrypted with the OS key store (Electron `safeStorage`).

---

## Guides

- [Yobi: AI automation that drives ChatGPT & Gemini through their web interfaces](https://wellstsai.com/en/post/yobi-free-ai-automation/) — overview and setup
- [Build an AI Telegram news bot from RSS, with no server and no API key](https://wellstsai.com/en/post/telegram-bot-rss-ai-digest/) — one flow, start to finish
- [How to get a free LLM API key: Gemini and OpenRouter quotas, tested](https://wellstsai.com/en/post/free-ai-api-key/) — for BYOK

---

## Development

```bash
npm run dev         # dev mode; press Enter to restart Electron after main-process changes
npm run typecheck   # TypeScript type checking
npm run i18n:check  # compare language/*.json with the source; deletes unused keys
npm run build:win   # Windows (NSIS installer)
npm run build:mac   # macOS (DMG)
```

**Stack:** Electron · React + TypeScript · Mantine · Zustand · Vite + electron-builder · grammY · LINE Bot SDK · MCP SDK

---

## Contributing

Issues and PRs are welcome. Make sure `npm run typecheck` passes. User-facing text goes in `language/*.json`, in en-US, zh-TW and zh-CN; for another language see [language/README.md](language/README.md). For big changes, open an issue first.

---

## License

[MIT](LICENSE)

---

<div align="center">

If Yobi saves you time, please ⭐ **Star** the repo — it helps others find it!

**[Report a Bug](https://github.com/WellWells/yobi/issues) · [Request a Feature](https://github.com/WellWells/yobi/issues) · [Discussions](https://github.com/WellWells/yobi/discussions)**

</div>
