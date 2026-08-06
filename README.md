<div align="center">

# 🤖 Yobi

**Use ChatGPT, Gemini, Perplexity & Duck.ai from a single hotkey — and automate them with no code. No API key.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-blue)](#-get-started)
[![Microsoft Store](https://img.shields.io/badge/Microsoft%20Store-Download-0067b8)](https://apps.microsoft.com/detail/9nnx8prfstc9)
[![Electron](https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-brightgreen.svg)](https://github.com/WellWells/yobi/pulls)

**[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md)**

</div>

---

**Yobi** turns the AI sites you already use — **ChatGPT, Gemini, Perplexity, and Duck.ai** — into a desktop assistant you trigger from a global hotkey, and a no-code automation engine you can put on a schedule or run from Telegram or LINE. No API key and no extra fee: it drives the providers' own web pages in a built-in browser, exactly the way you would yourself.

> ℹ️ Good to know: automating these sites isn't officially supported by the providers and falls outside their terms of service. Yobi bypasses nothing — if a site shows a CAPTCHA, it pauses and hands control back to you. Just use it responsibly. [How it works →](#-how-yobi-works)

---

## ✨ Why Yobi

|     | Feature              | What it means for you                                                                               |
| --- | -------------------- | -------------------------------------------------------------------------------------------------- |
| ⌨️   | **One hotkey**       | Select text anywhere, press `Alt+G` (`⌘G` on macOS), get an answer — saved automatically            |
| 🔑   | **No API key**       | Uses the providers' web pages, not paid APIs — nothing to sign up or pay for. Have a key anyway? An optional BYOK mode supports it |
| 🤖   | **Every major AI**   | ChatGPT · Gemini · Perplexity · Duck.ai, switchable in one click                                    |
| 🧠   | **Agent & search**   | `/agent` takes a goal and works at it until it's done; `/search` answers from the web with clickable sources |
| 🔁   | **No-code automation** | Build workflows by dragging steps — or just describe one and let AI assemble it                   |
| 📱   | **Telegram & LINE**  | Fire your AI and your automations from your phone                                                  |
| 🎨   | **Share-ready output** | Export any answer as a styled PNG, WebP, or PDF — or an encrypted share link                      |
| 🔒   | **No middleman**     | Yobi runs no server of its own: prompts go straight to the AI site you picked, everything else stays on your disk |
| 🌍   | **Multilingual**      | English · 繁體中文 · 简体中文 built in — add any language yourself with a drop-in pack ([guide](language/README.md)) |

---

## 🚀 Get Started

**1. Download** the latest release for your OS:

| Platform    | Download                                                                                    | Notes                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Windows** | [**Microsoft Store**](https://apps.microsoft.com/detail/9nnx8prfstc9) **(Recommended)**     | Installs and updates automatically.                                                               |
| **Windows** | [GitHub Releases](https://github.com/WellWells/yobi/releases) — NSIS installer (x64)        | Unsigned, so Windows prompts on first launch — choose **More info → Run anyway** to open.         |
| **macOS**   | [GitHub Releases](https://github.com/WellWells/yobi/releases) — DMG (Intel & Apple Silicon) | Unsigned, so macOS Gatekeeper blocks the first launch — the [release notes](https://github.com/WellWells/yobi/releases) explain how to open it. |

**2. Get your first answer in 30 seconds:**

1. (Optional) Open the in-app browser and sign in to ChatGPT / Gemini / Perplexity.
2. Highlight any text, in any app.
3. Press **`Alt+G`** — Yobi sends it to your chosen AI and saves the reply as a timestamped Markdown file.

> The hotkey, AI provider, and tray behavior are all configurable in **Settings**.

<details>
<summary><b>Run from source instead</b> (Node.js 20+)</summary>

```bash
git clone https://github.com/WellWells/yobi.git
cd yobi
npm install
npm run dev
```
</details>

---

## 📸 Screenshots

|                      Main Chat Interface                      |                        Model Selection                         |
| :-----------------------------------------------------------: | :------------------------------------------------------------: |
| <img src="assets/screenshots/main-chat-interface.png" width="400" /> | <img src="assets/screenshots/model-selection-menu.png" width="400" /> |
|            Chat with AI through its web interface             |     Switch between ChatGPT · Gemini · Perplexity · Duck.ai     |

|                        Chat History & Summary                         |                          Export Options                          |
| :-------------------------------------------------------------------: | :--------------------------------------------------------------: |
| <img src="assets/screenshots/chat-history-summary-result.png" width="400" /> | <img src="assets/screenshots/export-options-preview.png" width="400" /> |
|                 Auto-saved responses with timestamps                  |          Export as PNG, WebP, or PDF with custom styles          |

<div align="center">

![Flow editor with RSS step](assets/screenshots/flow-editor-rss-step.png)

**Flows** — fetch, summarize with AI, and send to Telegram, on a schedule — no code

</div>

---

## 💬 Ask, Search, or Hand Over the Whole Job

Type `/` in the chat box to pick a mode — or just talk:

| Mode        | What it does                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| **Chat**    | A normal multi-turn conversation. Each one is a Markdown file you can close, reopen, and carry on.        |
| `/agent`    | Give it a goal. It plans, reads pages, calls tools, checks its own work, and can build you a flow.        |
| `/search`   | Researches the web and answers with numbered sources you can click.                                       |
| `/yours`    | Any flow you built, as your own slash command.                                                            |

Answers render as they arrive — **Mermaid diagrams**, math, and code included — and each conversation tracks its token usage. Turn any of them into a **PNG, PDF, or an end-to-end encrypted share link** in one click.

---

## 🔗 Flows — Automate Without Code

Chain AI, data, and actions into automations that run on a **hotkey, a schedule, a Telegram command, or an in-app `/command`** — and one flow can use several at once.

**Never built an automation before? You don't need to.** Just describe what you want in plain language, and AI builds the whole flow for you:

> *"Every weekday at 8am, summarize my RSS feed and send it to Telegram."* → 🪄 a complete, ready-to-run flow, generated for you.

Want to fine-tune it? Every step is editable — or drag your own together from scratch.

**What you can wire together:**

- 📥 **Pull data** — web pages, RSS, HTTP APIs, YouTube transcripts, web search, Google Maps reviews, even live stock / forex / weather / air quality — no API key
- 🕸️ **Scrape a list** — click one headline on the real page and Yobi works out the selectors for the whole list
- 🌐 **Drive a browser** — open tabs, click, fill forms, take screenshots
- 🧠 **Ask AI** — ChatGPT · Gemini · Perplexity · Duck.ai — or your own API key via BYOK
- 🔌 **Bring your own tools** — connect remote MCP servers and let `/agent` call them
- 📤 **Send results** — Telegram, LINE, email, a file, a share link, or the clipboard
- 🛠️ **Run anything** — programs, JavaScript, shell, plus system & power controls
- 🔀 **Control flow** — loops, conditions, scheduling, and "only tell me when it changes"

…**46 skills and growing**, all wired together with simple `{{variables}}` — each step's output feeds the next.

**Start from a template** and customize:

| Template                                  | What it does                                                          |
| ----------------------------------------- | -------------------------------------------------------------------- |
| 📰 **RSS → Telegram**                      | Summarize a feed with AI and send it to Telegram                     |
| 🕵️ **Web Monitor → Telegram**             | Watch any site for new items, analyze, and push to Telegram          |
| ▶️ **YouTube Subscriptions → Telegram**   | Summarize new videos from channels you follow, with thumbnails       |

Flows are plain `.json` — export, share, and import them in a click.

---

## 📱 Run It From Telegram or LINE

Want to use your AI from your phone? Connect a bot — about two minutes:

1. **Create a bot** — message [@BotFather](https://t.me/BotFather) and copy the token it gives you. (For LINE, create a Messaging API channel instead.)
2. **Paste the token** in **Settings → Telegram** (or **LINE**).
3. **Say `/start`** to your bot and follow the pairing prompt. Done.

Now message your bot from anywhere:

| Command            | Does                                                  |
| ------------------ | ---------------------------------------------------- |
| `/gpt` · `/gemini` · `/pplx` · `/duck` | Ask that provider (commands are customizable)  |
| `/agent` · `/search` | Hand it a goal, or search the web — same as in the app |
| `/new`             | Start a fresh conversation                           |
| `/output <mode>`   | Set reply format — `md` · `png` · `webp` · `pdf`     |
| `/status`          | Check the agent                                      |
| `/restart`         | Restart Yobi (admin)                                 |

Prefer no commands at all? Turn on **direct chat** in the bot's settings and plain messages go straight to your AI as a normal conversation.

Build your own commands in Flows with the **Bot trigger** — any message can kick off a flow, on either platform.

---

## ⚙️ Settings & Customization

- **Prompt preferences** — set a default tone and length, and prepend your own instructions to every prompt.
- **Capture & export** — turn any answer into a styled PNG / WebP / PDF (light or dark card, gradient palette, your choice of metadata).
- **Email (SMTP)** — let flows send results by mail; the password is stored in your OS keychain, never in a flow file.
- **MCP servers** — add remote Model Context Protocol servers so `/agent` can use their tools; anything that writes asks you first.
- **Accounts** — sign in or out per provider, and reset a provider's data in one click to fix a stuck session.
- **Bring Your Own Key (BYOK)** — optionally add your own OpenAI-compatible (OpenAI, OpenRouter, Together, Groq, a local server, …) or Gemini API key as an extra provider: choose the type, set the base URL, model, and key, then use **Load models** to pick from what the endpoint offers and **Test** to confirm it works. BYOK instances are selectable in chat and flows like any other; browser mode stays the default, and keys are encrypted with your OS keychain.
- **Appearance & behavior** — 11 themes, stacked or side-by-side layout, launch at startup, close-to-tray, response timeout, text zoom.
- **Backup** — export and import all settings as a single JSON file.

---

## 🔍 How Yobi Works

Yobi automates the **web interfaces** of ChatGPT, Gemini, Perplexity, and Duck.ai. In a built-in browser window it types your prompt into the provider's site and reads the answer back from the page — the same thing you'd do by hand. You sign in there only for providers that require it. By default it uses **no official API and no local model**, which is exactly why it needs no API key and has no fee. (If you *do* have a key, the optional BYOK mode calls any OpenAI-compatible endpoint or the Gemini API directly instead — everything below applies to the default browser mode.)

Since it uses the web pages rather than official APIs, this falls outside the providers' terms of service. Yobi doesn't hide that, though — it bypasses no protections: no solving CAPTCHAs, no evading rate limits, no rotating IPs. So in practice the most you'll run into is an anti-bot check (a Cloudflare-style "verify you're human" page), and when that happens Yobi pauses and hands control back to you to clear it manually.

**Please use Yobi responsibly** — nothing illegal, and no large-scale or abusive automation. Light personal use is usually just the occasional verification prompt; heavy or abusive use is what gets blocked. Whether to use it on this basis is your call — this isn't legal advice, and providers' terms can change, so check them yourself.

---

## 🔒 Security & Privacy

- **Where your prompts go** — to the AI site you picked, typed into its own web page, exactly as if you'd typed them there yourself. That's the one place your text goes, and it's subject to that provider's privacy policy.
- **No middleman, no telemetry** — Yobi has no server and no account: nothing is proxied through us, and there's zero analytics or tracking.
- **Your stuff stays yours** — conversations, flows, and exports are plain files on your disk. The automation logic is auditable in `src/main/`.
- **Anything else that leaves your machine is opt-in** — share links are encrypted in the app before upload, and the key lives in the link's `#fragment`, which browsers never send to the host (you can delete the paste at any time). MCP talks only to servers you add yourself.
- **Encrypted credentials** — your Telegram/LINE tokens, SMTP password, and BYOK API keys are encrypted with the OS keychain (Electron `safeStorage`) before touching disk.

---

## 🛠️ Development

```bash
npm run dev         # dev server with Electron hot-reload
npm run typecheck   # TypeScript type checking
npm run i18n:check  # i18n key audit
npm run build:win   # build Windows (NSIS installer)
npm run build:mac   # build macOS (DMG)
```

**Stack:** Electron · React + TypeScript · Mantine · Zustand · Vite + electron-builder · grammY · LINE Bot SDK · MCP SDK

---

## 🤝 Contributing

Issues and PRs are welcome! Fork, branch (`git checkout -b feat/my-feature`), make sure `npm run typecheck` passes, and open a PR with a clear description. For big changes, open an issue first to talk it through.

---

## 📜 License

[**MIT**](LICENSE) — free to use, modify, and distribute.

---

<div align="center">

If Yobi saves you time, please ⭐ **Star** the repo — it helps others find it!

**[Report a Bug](https://github.com/WellWells/yobi/issues) · [Request a Feature](https://github.com/WellWells/yobi/issues) · [Discussions](https://github.com/WellWells/yobi/discussions)**

</div>
