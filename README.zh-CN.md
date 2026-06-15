<div align="center">

# 🤖 Yobi

**一个热键，畅用 ChatGPT、Gemini、Perplexity 与 Duck.ai——还能用无代码方式自动化它们。无需 API Key。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-blue)](#-快速上手)
[![Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron)](https://www.electronjs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-brightgreen.svg)](https://github.com/WellWells/yobi/pulls)

**[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)**

</div>

---

**Yobi** 把你早已在用的 AI 网站——**ChatGPT、Gemini、Perplexity 与 Duck.ai**——变成一个由全局热键唤起的桌面助手，也是一台可定时运行、可从 Telegram 触发的无代码自动化引擎。无需 API Key，也没有额外费用：它在内置浏览器中驱动服务商自己的网页，就像你亲自操作一样。

> ℹ️ 须知：自动化这些网站并非服务商官方支持的用法，也不在其服务条款的许可范围内。Yobi 不会绕过任何技术保护——一旦网站弹出 CAPTCHA，它会暂停并把控制权交还给你。请负责任地使用。[运作原理 →](#-yobi-如何运作)

---

## ✨ 为什么选 Yobi

|     | 功能                 | 对你意味着什么                                                                 |
| --- | -------------------- | ----------------------------------------------------------------------------- |
| ⌨️   | **一个热键**         | 在任何地方选中文字，按下 `Alt+G`（macOS 为 `⌘G`）即得答案——并自动保存          |
| 🔑   | **无需 API Key**     | 使用服务商的网页，而非付费 API——无需注册、无需付费                             |
| 🤖   | **主流 AI 全覆盖**   | ChatGPT · Gemini · Perplexity · Duck.ai，一键切换                              |
| 🔁   | **无代码自动化**     | 拖拽步骤即可搭建工作流——或只需描述一下，让 AI 替你组装                         |
| 📱   | **从 Telegram 运行** | 在手机上触发你的 AI 与自动化流程                                               |
| 🎨   | **即分享的输出**     | 将任意回复导出为精美的 PNG、WebP 或 PDF                                        |
| 🔒   | **完全属于你**       | 全程在本机运行——无遥测、无追踪、开源                                          |
| 🌍   | **9 种语言**         | English · 繁中 · 简中 · 日本語 · 한국어 · Deutsch · Español · Français · Português |

---

## 🚀 快速上手

**1. 下载** 适合你系统的最新版本：

| 平台    | 下载                            |
| ------- | ------------------------------- |
| Windows | NSIS 安装包（x64）              |
| macOS   | DMG（Intel 与 Apple Silicon）   |

→ [**Releases 页面**](https://github.com/WellWells/yobi/releases)

**2. 30 秒内获得你的第一个答案：**

1. （可选）打开应用内浏览器，登录 ChatGPT / Gemini / Perplexity。
2. 在任意应用中高亮选中文字。
3. 按下 **`Alt+G`**——Yobi 会把它发送给你选定的 AI，并将回复保存为带时间戳的 Markdown 文件。

> 热键、AI 服务商与托盘行为都可在 **设置** 中配置。

<details>
<summary><b>改为从源码运行</b>（Node.js 20+）</summary>

```bash
git clone https://github.com/WellWells/yobi.git
cd yobi
npm install
npm run dev
```
</details>

---

## 📸 截图预览

|                          主聊天界面                           |                          模型选择菜单                          |
| :-----------------------------------------------------------: | :------------------------------------------------------------: |
| <img src="docs/assets/main-chat-interface.png" width="400" /> | <img src="docs/assets/model-selection-menu.png" width="400" /> |
|                    通过网页界面与 AI 对话                     |       在 ChatGPT · Gemini · Perplexity · Duck.ai 间切换        |

|                            对话历史与摘要                             |                             导出选项                             |
| :-------------------------------------------------------------------: | :--------------------------------------------------------------: |
| <img src="docs/assets/chat-history-summary-result.png" width="400" /> | <img src="docs/assets/export-options-preview.png" width="400" /> |
|                         自动保存并附带时间戳                          |             导出为 PNG、WebP 或 PDF，支持自定义样式              |

<div align="center">

![AgentFlow 编辑器（RSS 步骤）](docs/assets/agentflow-editor-rss-step.png)

**AgentFlow** — 抓取内容、用 AI 摘要，并按计划发送到 Telegram——无需代码

</div>

---

## 🔗 AgentFlow — 无代码自动化

把 AI、数据与动作串成自动化流程，可通过**热键、定时计划、Telegram 指令，或应用内的 `/指令`** 触发——同一条流程还能同时使用多种方式。

**从没做过自动化？你不需要会。** 只需用大白话描述你想要什么，AI 就会为你搭好整条流程：

> *「每个工作日早上 8 点，总结我的 RSS 订阅并发送到 Telegram。」* → 🪄 一条完整、即开即用的流程，为你自动生成。

想再微调？每一步都可编辑——也可以从零开始，自己拖拽搭建。

**你可以串联起这些能力：**

- 📥 **抓取数据**——网页、RSS、HTTP API、YouTube 字幕，甚至实时的股票 / 外汇 / 天气——无需 API Key
- 🌐 **驱动浏览器**——打开标签页、点击、填写表单、截图
- 🧠 **询问 AI**——ChatGPT · Gemini · Perplexity · Duck.ai
- 📤 **发送结果**——Telegram、邮件、文件，或剪贴板
- 🛠️ **运行任意内容**——程序、JavaScript、Shell，以及系统与电源控制
- 🔀 **控制流程**——循环、条件、定时调度

……**35+ 种技能且仍在增加**，全部通过简单的 `{{variables}}` 串联——每一步的输出都喂给下一步。

**从模板开始** 并自定义：

| 模板                                      | 功能                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------- |
| 📰 **RSS → Telegram**                      | 用 AI 摘要一个订阅源并发送到 Telegram                                |
| 🕵️ **网站监控 → Telegram**                 | 监控任意网站的新内容，分析后推送到 Telegram                          |
| ▶️ **YouTube 订阅 → Telegram**             | 摘要你关注频道的新视频，并附带缩略图                                 |

流程就是普通的 `.json` 文件——一键导出、分享与导入。

---

## 📱 从 Telegram 运行

想在手机上使用你的 AI？连接一个 Telegram Bot——大约两分钟：

1. **创建 Bot**——给 [@BotFather](https://t.me/BotFather) 发消息，复制它给你的 Token。
2. **填入 Token**——在 **设置 → Telegram** 中粘贴。
3. **发送 `/start`**——向你的 Bot 发送并按提示完成绑定。搞定。

现在就能随时随地给你的 Bot 发消息：

| 指令               | 作用                                                 |
| ------------------ | ---------------------------------------------------- |
| `/gpt` · `/gemini` · `/pplx` · `/duck` | 询问对应服务商（指令可自定义）   |
| `/output <模式>`   | 设置回复格式——`md` · `png` · `webp` · `pdf`          |
| `/status`          | 查看 AI 状态                                         |
| `/restart`         | 重启 Yobi（管理员）                                  |

在 AgentFlow 中用 **Telegram 触发器**打造你自己的指令——任意消息都能启动一条流程。

---

## ⚙️ 设置与自定义

- **提示词偏好**——设置默认语气与长度，并在每条提示词前加上你自己的引导指令。
- **截图与导出**——把任意回复变成精美的 PNG / WebP / PDF（浅色或深色卡片、渐变色板、自选元数据）。
- **邮件（SMTP）**——让流程通过邮件发送结果；密码保存在操作系统密钥链中，绝不会写入流程文件。
- **账号**——按服务商分别登录或登出，一键重置某个服务商的数据以修复卡死的会话。
- **外观与行为**——11 款主题、堆叠或左右并排布局、开机自启、关闭至托盘、响应超时、文字缩放。
- **配置备份**——将全部设置导出和导入为单个 JSON 文件。

---

## 🔍 Yobi 如何运作

Yobi 自动化 ChatGPT、Gemini、Perplexity 与 Duck.ai 的**网页界面**。它在内置浏览器窗口中，把你的提示词输入服务商的网页，再从页面读回答案——就和你亲手操作一样。只有需要登录的服务商才在该窗口里登录。它**不使用官方 API，也不运行本地模型**——这正是它无需 API Key、也没有任何费用的原因。

由于它使用的是网页而非官方 API，这**并不在服务商服务条款的许可范围内**。不过 Yobi 不会隐瞒这一点——它不会绕过任何保护措施：不破解 CAPTCHA、不规避速率限制、也不轮换 IP。所以你真正会遇到的，是反机器人检查（类似 Cloudflare 的「确认你不是机器人」页面）；一旦发生，Yobi 会暂停，把控制权交还给你手动完成。

**请负责任地使用 Yobi**——不做任何非法之事，也不进行大规模或恶意的自动化。轻度的个人使用通常只会偶尔遇到一次验证；大量或恶意的使用才是会被封锁的情形。是否在此前提下使用由你决定——本说明不构成法律意见，而且服务商的条款可能变化，请自行查阅。

---

## 🔒 安全与隐私

- **无遥测**——零分析、零追踪；你的查询只发送给你选择的 AI 服务商（受其各自的隐私政策约束）。
- **本地且开源**——所有自动化逻辑都在本机运行，可在 `src/main/` 中审查。
- **凭据加密**——你的 Telegram Token 与 SMTP 密码在写入磁盘前，均使用操作系统密钥链（Electron `safeStorage`）加密。

---

## 🛠️ 开发

```bash
npm run dev         # dev server with Electron hot-reload
npm run typecheck   # TypeScript type checking
npm run i18n:check  # i18n key audit
npm run build:win   # build Windows (NSIS installer)
npm run build:mac   # build macOS (DMG)
```

**技术栈：** Electron 42 · React 19 + TypeScript · Mantine 9 · Zustand 5 · Vite 8 + electron-builder · GrammY · node-cron

---

## 🤝 参与贡献

欢迎提交 Issue 和 PR！Fork 仓库、创建分支（`git checkout -b feat/my-feature`），确保 `npm run typecheck` 通过，然后提交一个附有清晰描述的 PR。重大变更请先开 Issue 讨论方案。

---

## 📜 开源许可

[**MIT**](LICENSE) — 自由使用、修改与分发。

---

<div align="center">

如果 Yobi 为你节省了时间，请 ⭐ **Star** 这个仓库——让更多人发现它！

**[报告 Bug](https://github.com/WellWells/yobi/issues) · [功能建议](https://github.com/WellWells/yobi/issues) · [讨论区](https://github.com/WellWells/yobi/discussions)**

</div>
