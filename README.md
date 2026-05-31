<div align="center">

# 🤖 Desktop Agent Center

**The free, no-API-key AI automation desktop app**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-blue)](#-quick-start)
[![Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron)](https://www.electronjs.org/)
[![No API Key](https://img.shields.io/badge/API%20Key-Not%20Required-brightgreen)](#-highlights)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-brightgreen.svg)](https://github.com/WellWells/desktop-agent-center/pulls)

**[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)**

</div>

---

**Desktop Agent Center (DAC)** is a local-first, open-source AI automation tool that runs on your desktop. It bridges your clipboard and global hotkeys directly to leading AI providers — **ChatGPT, Gemini, Perplexity, and Duck.ai** — with no API keys, no subscription fees, and no credit card required.

Unlike paid automation platforms (e.g., OpenClaw, Zapier AI, n8n cloud) that charge from day one, DAC is **completely free** and uses the same AI web interfaces you already have open in your browser. Just install, press a hotkey, and your clipboard content is already being processed by AI.

---

## Table of Contents

- [🤖 Desktop Agent Center](#-desktop-agent-center)
  - [Table of Contents](#table-of-contents)
  - [✨ Highlights](#-highlights)
  - [🚀 Quick Start](#-quick-start)
    - [Prerequisites](#prerequisites)
    - [Install \& Run](#install--run)
    - [First Use (4 Steps)](#first-use-4-steps)
  - [📸 Screenshots](#-screenshots)
  - [📦 Pre-built Downloads](#-pre-built-downloads)
  - [🔗 AgentFlow — Visual Workflow Automation](#-agentflow--visual-workflow-automation)
    - [Triggers](#triggers)
    - [Skills](#skills)
    - [Variable System](#variable-system)
    - [Ready-to-use Templates](#ready-to-use-templates)
  - [📱 Telegram Bot Integration](#-telegram-bot-integration)
    - [Built-in Bot Commands](#built-in-bot-commands)
  - [⚙️ Settings \& Customization](#️-settings--customization)
    - [Prompt Preferences](#prompt-preferences)
    - [Capture \& Export](#capture--export)
    - [General Settings](#general-settings)
    - [Config Backup](#config-backup)
  - [⚖️ Why DAC vs. Paid Tools?](#️-why-dac-vs-paid-tools)
  - [🔒 Security \& Privacy](#-security--privacy)
  - [🛠️ Development](#️-development)
    - [Tech Stack](#tech-stack)
  - [🤝 Contributing](#-contributing)
  - [📜 License](#-license)

---

## ✨ Highlights

|     | Feature              | Details                                                                                            |
| --- | -------------------- | -------------------------------------------------------------------------------------------------- |
| 🆓   | **Zero Cost**        | No API key, no credit card, no subscription — ever                                                 |
| ⌨️   | **Global Hotkey**    | `Alt+G` (Windows) / `Command+G` (macOS) captures selected text or clipboard, sends to AI instantly |
| 🤖   | **Multi-Provider**   | ChatGPT · Gemini · Perplexity · Duck.ai                                                            |
| 🔁   | **AgentFlow**        | Visual no-code workflow builder with 12 automation skills                                          |
| 📱   | **Telegram Bridge**  | Control your AI agent from your phone via Telegram Bot                                             |
| 💾   | **Auto-save**        | Results saved as Markdown files with timestamps                                                    |
| 🎨   | **Capture & Export** | Export AI responses as styled PNG, WebP, or PDF                                                    |
| 🔒   | **Local-first**      | All logic runs on your machine — no telemetry, no tracking                                         |
| 🌍   | **9 UI Languages**   | English, 繁中, 简中, 日本語, 한국어, Deutsch, Español, Français, Português                         |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 20+** ([download](https://nodejs.org/))

### Install & Run

```bash
git clone https://github.com/WellWells/desktop-agent-center.git
cd desktop-agent-center
npm install
npm run dev
```

### First Use (4 Steps)

1. **Login** (optional) — Open the in-app browser and sign in to ChatGPT / Gemini / Perplexity.
2. **Enable tray** — Go to **Settings → General → System Tray** to keep DAC running in the background.
3. **Select text** — Highlight any text in any application.
4. **Press `Alt+G`** — DAC sends it to your chosen AI, writes the result back to your clipboard, and auto-saves the response.

> **Tip:** The hotkey is fully customizable in **Settings → General → Hotkey**. On macOS the default is `Command+G`.

---

## 📸 Screenshots

|                      Main Chat Interface                      |                        Model Selection                         |
| :-----------------------------------------------------------: | :------------------------------------------------------------: |
| <img src="docs/assets/main-chat-interface.png" width="400" /> | <img src="docs/assets/model-selection-menu.png" width="400" /> |
|              Chat with AI — no API key required               |     Switch between ChatGPT · Gemini · Perplexity · Duck.ai     |

|                        Chat History & Summary                         |                          Export Options                          |
| :-------------------------------------------------------------------: | :--------------------------------------------------------------: |
| <img src="docs/assets/chat-history-summary-result.png" width="400" /> | <img src="docs/assets/export-options-preview.png" width="400" /> |
|                 Auto-saved responses with timestamps                  |          Export as PNG, WebP, or PDF with custom styles          |

|                           Custom Prompt Settings                            |                       Telegram Bot Configuration                       |
| :-------------------------------------------------------------------------: | :--------------------------------------------------------------------: |
| <img src="docs/assets/settings-custom-your-own-response.png" width="400" /> | <img src="docs/assets/settings-telegram-bot-config.png" width="400" /> |
|                   Set tone, length & custom instructions                    |                  Connect your Telegram Bot in seconds                  |

<div align="center">

![AgentFlow editor with RSS step](docs/assets/agentflow-editor-rss-step.png)

**AgentFlow** — Fetch URLs, summarize each with LLM, and send results to Telegram — no code required

</div>

---

## 📦 Pre-built Downloads

Download the latest release from the [**Releases**](https://github.com/WellWells/desktop-agent-center/releases) page:

| Platform | Format                                 |
| -------- | -------------------------------------- |
| Windows  | NSIS Installer · Portable `.exe` (x64) |
| macOS    | DMG · ZIP (x64 & Apple Silicon arm64)  |

---

## 🔗 AgentFlow — Visual Workflow Automation

AgentFlow is DAC's visual automation engine. Chain **LLM calls, data sources, and Telegram output** into fully automated pipelines — no coding required. Trigger by hotkey, schedule, or Telegram command.

### Triggers

| Trigger           | Description                                               |
| ----------------- | --------------------------------------------------------- |
| ⌨️ **Hotkey**      | A dedicated global keyboard shortcut                      |
| ⏰ **Scheduled**   | Daily / weekly cron schedule with flexible repeat options |
| 🤖 **Bot Command** | A custom Telegram bot command (e.g. `/my_cmd <input>`)    |
| ▶️ **Manual**      | Run on demand from the AgentFlow UI                       |

### Skills

| Skill                 | Description                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| 🧠 **LLM**             | Send prompts to ChatGPT, Gemini, Perplexity, or Duck.ai; optionally export the response as PNG / WebP / PDF |
| 🌐 **Browser**         | Fetch and extract text content from any URL                                                                 |
| 📡 **RSS**             | Monitor RSS/Atom feeds — only new items since the last run are returned                                     |
| 🕵️ **Web Scraper**     | Scrape links and titles from any webpage via CSS selectors, output as JSON                                  |
| 🐚 **Shell**           | Run shell commands (cmd / PowerShell on Windows; bash / zsh on macOS)                                       |
| 📋 **Clipboard**       | Read from or write text to the system clipboard                                                             |
| 📨 **Bot**             | Send a message or file to a Telegram chat                                                                   |
| 🔁 **Loop / End Loop** | Iterate over a list of items line by line                                                                   |
| 🛠️ **Utility**         | Add a timed delay or export a rendered snapshot (PNG / WebP / PDF)                                          |
| ⏹ **Stop**            | Conditionally halt the flow when a variable is empty                                                        |
| 💬 **Comment**         | Add documentation notes to a step (not executed)                                                            |

### Variable System

Every step writes its result to a named variable. Reference it in any later step with `{{variable_name}}`:

```
RSS Feed        → output: rss_1
LLM Prompt      → "Summarize: {{rss_1}}"   → output: llm_1
Telegram Bot    → message: "{{llm_1}}"
```

### Ready-to-use Templates

| Template                     | Description                                                           |
| ---------------------------- | --------------------------------------------------------------------- |
| 📰 **RSS → Telegram**         | Fetch RSS feed, summarize with LLM, send to Telegram                  |
| 🕵️ **Web Monitor → Telegram** | Scrape new items from any website, analyze with LLM, push to Telegram |

Flows can be **exported and shared** as `.json` files, or imported via file or URL.

---

## 📱 Telegram Bot Integration

Connect DAC to Telegram to control your AI agent from anywhere:

1. **Create a bot** — Message [@BotFather](https://t.me/BotFather) on Telegram and get your bot token.
2. **Add token** — Enter it in **Settings → Telegram**.
3. **Pair your account** — Send `/start` to your bot and follow the pairing flow.

### Built-in Bot Commands

| Command            | Description                 |
| ------------------ | --------------------------- |
| `/gpt <prompt>`    | Send a prompt to ChatGPT    |
| `/gemini <prompt>` | Send a prompt to Gemini     |
| `/pplx <prompt>`   | Send a prompt to Perplexity |
| `/status`          | Check agent status          |

Create **custom bot commands** in AgentFlow using the **Bot Command trigger** to build fully custom workflows triggered by Telegram messages.

---

## ⚙️ Settings & Customization

### Prompt Preferences

Tailor how every prompt is delivered to AI:

| Option                  | Choices                                      |
| ----------------------- | -------------------------------------------- |
| **Tone**                | Default · Professional · Casual · Direct     |
| **Length**              | Auto · Concise · Detailed                    |
| **Custom Instructions** | Free-form guidance prepended to every prompt |
| **Templates**           | Save and reuse your own prompt templates     |

### Capture & Export

Export any AI response as a beautifully styled image or PDF:

- **Formats**: PNG · WebP · PDF
- **Options**: gradient palette, layout direction, show/hide prompt text, provider name, and timestamp

### General Settings

| Setting               | Description                                 |
| --------------------- | ------------------------------------------- |
| **Theme**             | Light · Dark · Auto (follows OS)            |
| **Layout**            | Stacked · Side-by-side                      |
| **Response Timeout**  | Maximum wait time for an AI response        |
| **Launch at Startup** | Auto-start DAC when your computer boots     |
| **Close to Tray**     | Minimize to system tray instead of quitting |
| **Markdown Zoom**     | Adjust response text size (70%–200%)        |

### Config Backup

Export and import your full settings as a JSON file via **Settings → Advanced**.

---

## ⚖️ Why DAC vs. Paid Tools?

|                      | Desktop Agent Center           | OpenClaw / n8n Cloud / Zapier AI |
| -------------------- | ------------------------------ | -------------------------------- |
| Price                | **Free forever**               | Paid subscription / credits      |
| API Key              | **Not required**               | Usually required                 |
| AI Providers         | ChatGPT, Gemini, PPLX, Duck.ai | Depends on plan                  |
| Workflow automation  | ✅ AgentFlow (visual)           | ✅ (paid)                         |
| Telegram integration | ✅ Built-in                     | Varies                           |
| Data privacy         | **Local-first**                | Cloud-processed                  |
| Open source          | ✅ MIT                          | Varies                           |

---

## 🔒 Security & Privacy

- **No telemetry** — Zero analytics, tracking scripts, or usage data collection.
- **Local execution** — All automation runs on your machine. Data is sent directly to the AI providers you choose.
- **Encrypted credentials** — Telegram bot tokens are encrypted with Electron's `safeStorage` (OS-level keychain) before being written to disk.
- **Third-party provider policies** — Queries processed by ChatGPT/Gemini/Perplexity are subject to their respective privacy policies. The author has no control over those platforms.
- **Open source** — All automation logic is auditable in `src/main/`.

---

## 🛠️ Development

```bash
# Start dev server with Electron hot-reload
npm run dev

# TypeScript type checking
npm run typecheck

# i18n key audit
npm run i18n:check

# Build Windows (NSIS + Portable)
npm run build:win

# Build macOS (DMG + ZIP)
npm run build:mac
```

### Tech Stack

| Layer      | Technology                |
| ---------- | ------------------------- |
| Runtime    | Electron 42 + Node.js 20  |
| Frontend   | React 19 + TypeScript     |
| UI         | Mantine 9                 |
| State      | Zustand 5                 |
| Build      | Vite 8 + electron-builder |
| Telegram   | GrammY                    |
| Scheduling | node-cron                 |

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

1. **Fork** the repository and create a feature branch (`git checkout -b feat/my-feature`).
2. Make your changes — ensure `npm run typecheck` passes with no errors.
3. Open a **Pull Request** with a clear description.

For major changes, please open an **Issue** first to discuss the approach.

---

## 📜 License

This project is licensed under the **[MIT License](LICENSE)** — free to use, modify, and distribute.

---

<div align="center">

If DAC saves you time or money, please ⭐ **Star** this repository — it helps others discover it!

**[Report a Bug](https://github.com/WellWells/desktop-agent-center/issues) · [Request a Feature](https://github.com/WellWells/desktop-agent-center/issues) · [Discussions](https://github.com/WellWells/desktop-agent-center/discussions)**

</div>
