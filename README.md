<div align="center">

# 🤖 Yobi

**Use ChatGPT, Gemini, Perplexity & Duck.ai from a single hotkey — and automate them with no code. No API key.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-blue)](#-get-started)
[![Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron)](https://www.electronjs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-brightgreen.svg)](https://github.com/WellWells/yobi/pulls)

**[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)**

</div>

---

**Yobi** turns the AI sites you already use — **ChatGPT, Gemini, Perplexity, and Duck.ai** — into a desktop assistant you trigger from a global hotkey, and a no-code automation engine you can put on a schedule or run from Telegram. No API key and no extra fee: it drives the providers' own web pages in a built-in browser, exactly the way you would yourself.

> ℹ️ Good to know: automating these sites isn't officially supported by the providers and falls outside their terms of service. Yobi bypasses nothing — if a site shows a CAPTCHA, it pauses and hands control back to you. Just use it responsibly. [How it works →](#-how-yobi-works)

---

## ✨ Why Yobi

|     | Feature              | What it means for you                                                                               |
| --- | -------------------- | -------------------------------------------------------------------------------------------------- |
| ⌨️   | **One hotkey**       | Select text anywhere, press `Alt+G` (`⌘G` on macOS), get an answer — saved automatically            |
| 🔑   | **No API key**       | Uses the providers' web pages, not paid APIs — nothing to sign up or pay for                        |
| 🤖   | **Every major AI**   | ChatGPT · Gemini · Perplexity · Duck.ai, switchable in one click                                    |
| 🔁   | **No-code automation** | Build workflows by dragging steps — or just describe one and let AI assemble it                   |
| 📱   | **Runs from Telegram** | Fire your AI and your automations from your phone                                                  |
| 🎨   | **Share-ready output** | Export any answer as a styled PNG, WebP, or PDF                                                    |
| 🔒   | **Yours alone**      | Runs entirely on your machine — no telemetry, no tracking, open source                              |
| 🌍   | **9 languages**      | English · 繁中 · 简中 · 日本語 · 한국어 · Deutsch · Español · Français · Português                  |

---

## 🚀 Get Started

**1. Download** the latest release for your OS:

| Platform | Download                        |
| -------- | ------------------------------- |
| Windows  | NSIS Installer (x64)            |
| macOS    | DMG (Intel & Apple Silicon)     |

→ [**Releases page**](https://github.com/WellWells/yobi/releases)

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
| <img src="docs/assets/main-chat-interface.png" width="400" /> | <img src="docs/assets/model-selection-menu.png" width="400" /> |
|            Chat with AI through its web interface             |     Switch between ChatGPT · Gemini · Perplexity · Duck.ai     |

|                        Chat History & Summary                         |                          Export Options                          |
| :-------------------------------------------------------------------: | :--------------------------------------------------------------: |
| <img src="docs/assets/chat-history-summary-result.png" width="400" /> | <img src="docs/assets/export-options-preview.png" width="400" /> |
|                 Auto-saved responses with timestamps                  |          Export as PNG, WebP, or PDF with custom styles          |

<div align="center">

![AgentFlow editor with RSS step](docs/assets/agentflow-editor-rss-step.png)

**AgentFlow** — fetch, summarize with AI, and send to Telegram, on a schedule — no code

</div>

---

## 🔗 AgentFlow — Automate Without Code

Chain AI, data, and actions into automations that run on a **hotkey, a schedule, a Telegram command, or an in-app `/command`** — and one flow can use several at once.

**Never built an automation before? You don't need to.** Just describe what you want in plain language, and AI builds the whole flow for you:

> *"Every weekday at 8am, summarize my RSS feed and send it to Telegram."* → 🪄 a complete, ready-to-run flow, generated for you.

Want to fine-tune it? Every step is editable — or drag your own together from scratch.

**What you can wire together:**

- 📥 **Pull data** — web pages, RSS, HTTP APIs, YouTube transcripts, even live stock / forex / weather — no API key
- 🌐 **Drive a browser** — open tabs, click, fill forms, take screenshots
- 🧠 **Ask AI** — ChatGPT · Gemini · Perplexity · Duck.ai
- 📤 **Send results** — Telegram, email, a file, or the clipboard
- 🛠️ **Run anything** — programs, JavaScript, shell, plus system & power controls
- 🔀 **Control flow** — loops, conditions, scheduling

…**35+ skills and growing**, all wired together with simple `{{variables}}` — each step's output feeds the next.

**Start from a template** and customize:

| Template                                  | What it does                                                          |
| ----------------------------------------- | -------------------------------------------------------------------- |
| 📰 **RSS → Telegram**                      | Summarize a feed with AI and send it to Telegram                     |
| 🕵️ **Web Monitor → Telegram**             | Watch any site for new items, analyze, and push to Telegram          |
| ▶️ **YouTube Subscriptions → Telegram**   | Summarize new videos from channels you follow, with thumbnails       |

Flows are plain `.json` — export, share, and import them in a click.

---

## 📱 Run It From Telegram

Want to use your AI from your phone? Connect a Telegram bot — about two minutes:

1. **Create a bot** — message [@BotFather](https://t.me/BotFather) and copy the token it gives you.
2. **Paste the token** in **Settings → Telegram**.
3. **Say `/start`** to your bot and follow the pairing prompt. Done.

Now message your bot from anywhere:

| Command            | Does                                                  |
| ------------------ | ---------------------------------------------------- |
| `/gpt` · `/gemini` · `/pplx` · `/duck` | Ask that provider (commands are customizable)  |
| `/output <mode>`   | Set reply format — `md` · `png` · `webp` · `pdf`     |
| `/status`          | Check the agent                                      |
| `/restart`         | Restart Yobi (admin)                                 |

Build your own commands in AgentFlow with the **Telegram trigger** — any message can kick off a flow.

---

## ⚙️ Settings & Customization

- **Prompt preferences** — set a default tone and length, and prepend your own instructions to every prompt.
- **Capture & export** — turn any answer into a styled PNG / WebP / PDF (light or dark card, gradient palette, your choice of metadata).
- **Email (SMTP)** — let flows send results by mail; the password is stored in your OS keychain, never in a flow file.
- **Accounts** — sign in or out per provider, and reset a provider's data in one click to fix a stuck session.
- **Appearance & behavior** — 11 themes, stacked or side-by-side layout, launch at startup, close-to-tray, response timeout, text zoom.
- **Backup** — export and import all settings as a single JSON file.

---

## 🔍 How Yobi Works

Yobi automates the **web interfaces** of ChatGPT, Gemini, Perplexity, and Duck.ai. In a built-in browser window it types your prompt into the provider's site and reads the answer back from the page — the same thing you'd do by hand. You sign in there only for providers that require it. It uses **no official API and no local model**, which is exactly why it needs no API key and has no fee.

Since it uses the web pages rather than official APIs, this falls outside the providers' terms of service. Yobi doesn't hide that, though — it bypasses no protections: no solving CAPTCHAs, no evading rate limits, no rotating IPs. So in practice the most you'll run into is an anti-bot check (a Cloudflare-style "verify you're human" page), and when that happens Yobi pauses and hands control back to you to clear it manually.

**Please use Yobi responsibly** — nothing illegal, and no large-scale or abusive automation. Light personal use is usually just the occasional verification prompt; heavy or abusive use is what gets blocked. Whether to use it on this basis is your call — this isn't legal advice, and providers' terms can change, so check them yourself.

---

## 🔒 Security & Privacy

- **No telemetry** — zero analytics or tracking; your queries go only to the AI providers you pick (subject to their own privacy policies).
- **Local & open source** — every bit of automation logic runs on your machine and is auditable in `src/main/`.
- **Encrypted credentials** — your Telegram token and SMTP password are encrypted with the OS keychain (Electron `safeStorage`) before touching disk.

---

## 🛠️ Development

```bash
npm run dev         # dev server with Electron hot-reload
npm run typecheck   # TypeScript type checking
npm run i18n:check  # i18n key audit
npm run build:win   # build Windows (NSIS installer)
npm run build:mac   # build macOS (DMG)
```

**Stack:** Electron 42 · React 19 + TypeScript · Mantine 9 · Zustand 5 · Vite 8 + electron-builder · GrammY · node-cron

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
