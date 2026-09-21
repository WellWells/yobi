<div align="center">

# Yobi

**桌面 AI 自动化。流程在本机运行，可操作这台电脑上的应用程序，AI 无需 API Key。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-blue)](#开始使用)
[![Microsoft Store](https://img.shields.io/badge/Microsoft%20Store-Download-0067b8)](https://apps.microsoft.com/detail/9nnx8prfstc9)
[![Electron](https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-brightgreen.svg)](https://github.com/WellWells/yobi/pulls)

**[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md)**

</div>

---

**Yobi** 是一套在桌面运行的流程引擎。把数据、AI 与动作串成自动化，再以定时、全局热键、Telegram 或 LINE 消息，或 App 内的斜杠指令触发。因为它运行在你的电脑上而非服务器，流程能访问云端工具接触不到的对象：本机安装的 LINE 与 Thunderbird、你的文件、shell，以及一个真正的浏览器。AI 步骤驱动的是服务商自己的网页，因此无需 API Key，也没有按 token 计费的账单。

---

## 为什么选 Yobi

| 功能 | 说明 |
| ---- | ---- |
| **无代码流程** | 47 种步骤，以 `{{变量}}` 串接。可以拖拽组装，也可以描述需求让 AI 生成。 |
| **在本机运行** | 流程可访问这台电脑上的 LINE 与 Thunderbird，以及你的文件、shell 与浏览器窗口。无需部署。 |
| **无需 API Key** | AI 步骤驱动服务商的网页，而非付费 API。想用自己的密钥再开 BYOK 即可。 |
| **会执行动作的代理** | `/agent` 接下目标后自行挑选工具，改动任何东西之前会先征询你。 |
| **连接器** | Notion、GitHub、Figma、Stripe 等服务，另有本机的 LINE 与 Thunderbird。 |
| **四种触发方式** | 定时、全局热键、Telegram 或 LINE 消息、App 内斜杠指令。一条流程可同时使用多种。 |
| **主流 AI 全覆盖** | ChatGPT、Claude、Gemini、Perplexity，各自的模型与思考强度均可选。 |
| **没有中间人** | Yobi 自己不运行任何服务器。提示词直接发往你选的 AI 网站，其余一律留在本机硬盘。 |
| **多语言** | 内置 English、繁體中文、简体中文，另可放入语言包扩展（[说明](language/README.md)）。 |

---

## 流程

一条流程就是一串步骤，上一步的输出经由 `{{变量}}` 成为下一步的输入：

```
定时       每个工作日 08:00
    ↓
LINE      → {{chat}}      昨日至今的群组消息
    ↓
问 AI     → {{summary}}   摘要，并挑出决议与待办
    ↓
Telegram  发送 {{summary}}
```

不必自行组装。描述你要的结果，AI 会用下面这些步骤组出整条流程，每一步之后仍可修改：

> *“每个工作日早上 8 点，摘要我的 RSS 并发到 Telegram。”*

上面那条也内置为模板，另有多条可以直接拿来改——一部分按定时运行，一部分用斜杠指令触发。

**步骤按类型：**

- **获取数据** — 网页、RSS、HTTP API、YouTube 字幕、网络搜索、Google 地图评论、LINE 对话、实时股票 / 外汇 / 天气 / 空气质量
- **抓取列表** — 在真实网页上点一条标题，Yobi 推算出整份列表的选择器
- **操作浏览器** — 开标签页、点击、填表单、截图
- **询问 AI** — ChatGPT、Claude、Gemini、Perplexity，或 BYOK
- **发送结果** — Telegram、LINE、用你自己的 SMTP 账号发信、文件、分享链接、剪贴板
- **运行程序** — 程序、JavaScript、shell，以及系统与电源控制
- **流程控制** — 循环、条件、定时，以及“有变化才通知”

流程是普通的 `.json` 文件，可一键导出、分享与导入。

---

## 流程能访问什么

**这台电脑上。** 以下两个连接的是本机安装的应用程序，不经过云端账号：

- **LINE**（Windows）— 列出聊天、搜索消息、取出某段对话。不会向 LINE 发送任何内容，也不会将消息标记为已读。也可用 LINE 流程步骤。
- **Thunderbird** — 搜索与阅读邮件、回复、转发、归档，以及日历、任务与联系人。

**云端服务。** 登录一次，该连接器的工具就能供 `/agent` 使用：

- **工作** — Notion · Linear · Asana · Atlassian（Jira 与 Confluence）· Airtable · Dropbox · Zapier
- **开发** — GitHub · Sentry · Vercel · Netlify · Supabase · Neon · Cloudflare
- **设计** — Figma · Webflow · Wix
- **商务** — Stripe · Square · PayPal · Intercom
- **查资料** — Context7 · DeepWiki · Microsoft Learn · Cloudflare Docs · Hugging Face

列表以外只要支持 MCP 也能添加：粘贴网址即可。在**设置 → 连接器**启用，该页也会带你完成各连接器所需的设置。启用前一律不会工作，任何写入操作都会先征求确认。

---

## 触发方式

| 触发 | 适用场景 |
| ---- | -------- |
| **定时** | 每个工作日早上自动送达的摘要 |
| **全局热键** | 在任意 App 选中文字，按 `Alt+G`（macOS 为 `⌘⌃G`），取得答案并自动保存 |
| **Telegram 或 LINE 消息** | 从手机运行流程 |
| **斜杠指令** | 在 App 的输入框输入 `/你的流程` |

---

## 代理

给 `/agent` 一个目标，而不是一段提示词。它会规划、搜索、调用工具、检查自己的成果，也能把结果写成一条流程，之后按定时自动运行。读取无需确认；执行 shell 指令、写入文件、发送邮件，或调用任何会改变状态的连接器工具，都需要你确认。文件访问限制在你允许的文件夹内，形似密钥或 Token 的内容在送入模型前会先遮蔽。

在聊天中勾选输入框下方 pill 里的**网页**或任一连接器，该段对话即以代理模式运行；否则保持普通多轮对话，保存为可重新打开并接续的 Markdown 文件。`Shift+Tab` 可轮换各服务商与其模型。答案会边生成边渲染，含 Mermaid 图表与数学公式，并可导出为 PNG、PDF 或端到端加密的分享链接。

个性化记忆保存关于你的短句：所在城市、正在进行的工作、偏好的回答方式。AI 会在对话中提议，你同意之前不会写入任何一条。

---

## 开始使用

**1. 下载**适合你操作系统的最新版本：

| 平台 | 下载 | 说明 |
| ---- | ---- | ---- |
| **Windows** | [**Microsoft Store**](https://apps.microsoft.com/detail/9nnx8prfstc9) **（推荐）** | 自动安装与更新。 |
| **Windows** | [GitHub Releases](https://github.com/WellWells/yobi/releases) — NSIS 安装包（x64） | 未签名，首次启动 Windows 会拦截，选择**更多信息 → 仍要运行**。 |
| **macOS** | [GitHub Releases](https://github.com/WellWells/yobi/releases) — DMG（Intel 与 Apple Silicon） | 未签名，首次启动会被 Gatekeeper 拦下，打开方式见[发行说明](https://github.com/WellWells/yobi/releases)。 |

**2. 30 秒跑出第一个结果：**

1. （可选）打开内置浏览器，登录 ChatGPT / Claude / Gemini / Perplexity。
2. 在任意 App 中选中一段文字。
3. 按 **`Alt+G`**，Yobi 会发给你选定的 AI，并把回复保存为带时间戳的 Markdown 文件。

接着打开**流程**，从模板开始。

<details>
<summary><b>改用源码运行</b>（Node.js 22.12+）</summary>

```bash
git clone https://github.com/WellWells/yobi.git
cd yobi
npm install
npm run dev
```
</details>

---

## 界面截图

| 流程编辑器 | `/agent` 实际运行 |
| :--------: | :---------------: |
| <img src="assets/screenshots/flow-editor-rss-step.png" width="400" /> | <img src="assets/screenshots/agent-command-result.png" width="400" /> |
| 抓取、用 AI 摘要，再按计划发到 Telegram | 给它一个目标，它自行挑选工具并执行 |

| 主聊天界面 | 模型选择 |
| :--------: | :------: |
| <img src="assets/screenshots/main-chat-interface.png" width="400" /> | <img src="assets/screenshots/model-selection-menu.png" width="400" /> |
| 通过 AI 的网页界面对话 | 切换服务商，并挑选各家自己的模型 |

| 对话历史与摘要 | 导出选项 |
| :------------: | :------: |
| <img src="assets/screenshots/chat-history-summary-result.png" width="400" /> | <img src="assets/screenshots/export-options-preview.png" width="400" /> |
| 自动保存并附上时间戳 | 导出为 PNG、WebP 或 PDF，样式可自定义 |

---

## 用 Telegram 或 LINE 操控

接上一个 Bot，就能从手机使用你的 AI 与流程。设置约需两分钟：

1. **创建 Bot** — 给 [@BotFather](https://t.me/BotFather) 发消息，复制它给你的 Token。（LINE 则是创建一个 Messaging API channel。）
2. **填入 Token** — 在 **设置 → Telegram**（或 **LINE**）中粘贴。
3. **对你的 Bot 说 `/start`**，按配对提示完成。

| 指令 | 功能 |
| ---- | ---- |
| `/gpt` · `/claude` · `/gemini` · `/pplx` | 询问该服务商（指令可自定义） |
| `/agent` | 交给它一个目标，与 App 内相同 |
| `/search` | 搜索网络并附上来源作答（仅 Bot 有） |
| `/new` | 开始一段全新的对话 |
| `/output <模式>` | 设置回复格式：`md` · `png` · `webp` · `pdf` |
| `/status` | 查看代理状态 |
| `/restart` | 重启 Yobi（管理员） |

也可以完全不使用指令：在该 Bot 的设置里开启**免指令对话**，之后直接发消息就会当成普通对话送给你的 AI。

流程里的 **Bot 触发器**能把任何消息变成你自己的指令，两个平台均支持。

---

## 设置

常规 · 键盘快捷键 · 外观 · 导出 · AI 回复 · 个性化记忆 · 模型来源 · 连接器 · Bot 集成 · 统计 · 备份与还原。

**模型来源**也是 BYOK 的位置：添加 OpenAI 兼容端点或 Gemini API 密钥作为额外服务商，之后在聊天与流程中和其他选项一样可选。**备份与还原**把全部设置写成单个 JSON 文件。

---

## Yobi 如何工作

AI 步骤自动操作 ChatGPT、Claude、Gemini 与 Perplexity 的**网页界面**。Yobi 在内置浏览器窗口里把提示词输入服务商的网站，再从页面读回答案，与你手动操作的过程相同。只有需要登录的服务商才要你在那里登录。它**不使用官方 API，也不使用本地模型**，这正是它无需 API Key、也没有费用的原因。（可选的 BYOK 模式改为直接调用 OpenAI 兼容端点或 Gemini API；以下说明均针对默认的浏览器模式。）

以网页而非官方 API 操作，这件事落在服务商的服务条款之外。不过 Yobi 不绕过任何保护措施：不破解 CAPTCHA、不规避速率限制、不轮换 IP。实际上最多会遇到反机器人检查，也就是 Cloudflare 那类“验证你是真人”的页面；发生时 Yobi 会暂停，将控制权交还给你手动通过。

**请负责任地使用 Yobi**：不做违法的事，也不进行大规模或滥用式的自动化。个人轻度使用通常只会偶尔遇到验证；被封的是重度或滥用的用法。是否在此前提下使用由你自行决定，服务商的条款也可能变更，请自行确认。本文不构成法律建议。

---

## 安全与隐私

- **你的提示词去了哪里** — 发送到你选的那个 AI 网站，输入它自己的网页。那是你的文字唯一会去的地方，并适用该服务商的隐私政策。
- **没有中间人、没有遥测** — Yobi 没有服务器也没有账号，不代理任何数据，也没有任何分析追踪。对话、流程与导出文件都是本机硬盘上的普通文件，自动化逻辑可在 `src/main/` 查证。
- **其余会离开本机的功能一律由你主动开启** — 只有在**网页**开启时才会向 DuckDuckGo 查询。分享链接在 App 内先加密再上传，密钥放在链接的 `#fragment` 中，浏览器不会把它发给主机。连接器只会连接你自行登录的服务，LINE 与 Thunderbird 这两个则只与这台电脑上的应用程序往来。
- **代理执行动作前会先询问** — 读取无需询问，写入须确认。执行 shell 指令、写入文件、发送邮件，或调用任何会改变状态的连接器工具，都需要你确认。文件访问限制在你允许的文件夹内，形似密钥或 Token 的内容在送入模型前就会遮蔽。
- **凭据加密** — 你的 Telegram／LINE Token、SMTP 密码与 BYOK API 密钥在写入磁盘前，均使用操作系统密钥链（Electron `safeStorage`）加密。

---

## 延伸阅读

更完整的操作教程，附截图：

- [Yobi：用内建浏览器操作网页版 AI 的自动化工具，打造专属 Agent](https://wellstsai.com/post/yobi-free-ai-automation/) — 功能概览与安装设置
- [用 Telegram Bot 自动收 RSS 摘要：不用 API Key 的完整教程](https://wellstsai.com/post/telegram-bot-rss-ai-digest/) — 一条流程从头做到尾
- [免费 LLM API 密钥申请教程：Gemini、OpenRouter 额度实测](https://wellstsai.com/post/free-ai-api-key/) — 改走 BYOK 的话看这篇

---

## 开发

```bash
npm run dev         # 开发服务器，含 Electron 热重载
npm run typecheck   # TypeScript 类型检查
npm run i18n:check  # i18n key 审计
npm run build:win   # 构建 Windows（NSIS 安装包）
npm run build:mac   # 构建 macOS（DMG）
```

**技术栈：** Electron · React + TypeScript · Mantine · Zustand · Vite + electron-builder · grammY · LINE Bot SDK · MCP SDK

---

## 参与贡献

欢迎提 issue 与 PR。fork、建分支（`git checkout -b feat/my-feature`）、确认 `npm run typecheck` 通过，然后提交一个说明清晰的 PR。较大的改动请先开 issue 讨论。

---

## 许可证

[**MIT**](LICENSE) — 可自由使用、修改与分发。

---

<div align="center">

如果 Yobi 帮你省下时间，请点个 ⭐ **Star**，能让更多人找到它！

**[报告问题](https://github.com/WellWells/yobi/issues) · [功能建议](https://github.com/WellWells/yobi/issues) · [讨论区](https://github.com/WellWells/yobi/discussions)**

</div>
