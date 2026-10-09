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

**Yobi** 是一套在桌面运行的流程引擎。把数据、AI 与动作串成自动化，再以定时、全局热键、发给 Telegram 或 LINE Bot 的指令、App 内的斜杠指令触发，或在 Yobi 启动、电脑唤醒、屏幕锁定或解锁时运行。因为它运行在你的电脑上而非服务器，流程能访问云端工具接触不到的对象：本机的 LINE（Windows）、你的文件、shell，以及一个真正的浏览器。AI 步骤驱动的是服务商自己的网页，因此无需 API Key，也没有按 token 计费的账单。

---

## 为什么选 Yobi

| 功能 | 说明 |
| ---- | ---- |
| **无代码流程** | 50 种步骤，以 `{{变量}}` 串接。从菜单加入、拖拽调整顺序，也可以描述需求让 AI 生成。 |
| **在本机运行** | 流程可读取本机的 LINE（Windows），并访问你的文件、shell 与浏览器窗口；代理另可操作 Thunderbird。无需部署。 |
| **无需 API Key** | AI 步骤驱动服务商的网页，而非付费 API。想用自己的密钥再开 BYOK 即可。 |
| **会执行动作的代理** | 把聊天切到 **Agent**（或输入 `/agent`）并交给它一个目标：它自行挑选工具，改动任何东西之前会先征询你。发给 Telegram 或 LINE Bot 的消息也由代理处理，可用的工具取决于你给每个账号的权限。 |
| **连接器** | 供代理使用：Notion、GitHub、Figma、Stripe 等服务，或粘贴任何 MCP 服务器网址。内置本机的 LINE 与 Thunderbird，以及 X。 |
| **五种触发方式** | 定时、全局热键、发给 Telegram 或 LINE Bot 的指令、App 内斜杠指令、系统事件（Yobi 启动、电脑唤醒、屏幕锁定或解锁）。一条流程可同时使用多种。 |
| **主流 AI 全覆盖** | Gemini、Claude、ChatGPT、Perplexity。Gemini、Claude、ChatGPT 可选模型与思考强度；Gemini 与 Perplexity 不登录也能用。 |
| **没有中间人** | Yobi 自己不运行任何服务器。提示词直接发往你选的 AI 网站；其他数据只有经过你开启的功能（网络搜索、Bot、分享链接、连接器等）才会离开这台电脑。 |
| **多语言** | 内置 English、繁體中文、简体中文，另可放入语言包扩展（[说明](language/README.md)）。 |

---

## 流程

一条流程就是一串步骤，上一步的输出经由 `{{变量}}` 成为下一步的输入：

```
定时       每天 09:00
    ↓
LINE      → {{chat}}      昨日至今的群组消息
    ↓
问 AI     → {{summary}}   摘要，并挑出决议与待办
    ↓
Telegram  发送 {{summary}}
```

不必自行组装。描述你要的结果，AI 会用下面这些步骤组出整条流程，每一步之后仍可修改：

> *“每个工作日早上 8 点，摘要我的 RSS 并发到 Telegram。”*

上面那条也内置为模板，共有 18 条模板可以直接拿来改：一部分按定时运行，一部分用聊天或发给 Bot 的指令触发。

**步骤按类型：**

- **获取数据** — 网页、RSS、HTTP API、YouTube 字幕与订阅频道的新视频、网络搜索与深度研究、Google 地图评论、LINE 对话、X 帖子、回复与热门趋势（趋势需登录 X）、实时股票 / 外汇 / 天气 / 空气质量
- **抓取列表** — 在真实网页上点一条标题，Yobi 推算出整份列表的选择器
- **操作浏览器** — 开标签页、点击、填表单、截图
- **询问 AI** — Gemini、Claude、ChatGPT、Perplexity，或 BYOK
- **发送结果** — Telegram、LINE、用你自己的 SMTP 账号发信、文件、PDF、图片或分享链接、剪贴板、桌面通知
- **运行程序** — 程序、JavaScript、shell，以及系统与电源控制
- **流程控制** — 循环、条件、延迟、提前停止，以及“有变化才通知”

流程是普通的 `.json` 文件。可导出分享（不含你填的变量值与 Bot 账号 ID）；导入时会先列出它会访问什么。

---

## 连接器

**这台电脑上。** 以下两个连接的是本机安装的应用程序，不经过云端账号：

- **LINE**（Windows）— 列出聊天、搜索消息、取出某段对话，读的是运行中的 LINE 电脑版。不会向 LINE 发送任何内容，也不会将消息标记为已读。流程用 **LINE 消息** 步骤读取。
- **Thunderbird** — 搜索与阅读邮件、撰写、回复、转发、归档，以及日历、任务与联系人。需要 Thunderbird MCP 扩展，**设置 → 连接器**有下载链接。这是给 Agent 用的；流程发信用 **发送 Email** 步骤。

**X（推特）。** 内置：搜索帖子、看热门趋势、读取账号最新帖子与帖子下面的回复。在**设置 → 连接器**开启并登录（搜索与趋势需要登录）；之后消息里提到 X 或推特，Agent 就会到 X 上查。流程用 **X 追踪**、**X 帖子与回复**、**X 热门趋势** 步骤，共用同一个登录。未登录时每个账号只看得到最新几条帖子、每条只有少数热门回复，**X 热门趋势** 也无法使用。

**云端服务。** 连接一次（多数要登录，GitHub 要粘贴 Token，查资料类无需设置），Agent 就能使用该连接器的工具：

- **工作** — Notion · Linear · Asana · Atlassian（Jira 与 Confluence）· Airtable · Dropbox · Zapier
- **开发** — GitHub · Sentry · Vercel · Netlify · Supabase · Neon · Cloudflare
- **设计** — Figma · Webflow · Wix
- **商务** — Stripe · Square · PayPal · Intercom
- **查资料** — Context7 · DeepWiki · Microsoft Learn · Cloudflare Docs · Hugging Face

列表以外只要支持 MCP 也能添加：粘贴网址即可。在**设置 → 连接器**启用，该页也会带你完成各连接器所需的设置。启用前一律不会工作。任何写入操作都会先问你；按**永远允许这个服务器**可跳过修改类的确认，但发送与删除每次都会问。从 Telegram 或 LINE 只能读取连接器，而且仅限你授权的账号。

---

## 触发方式

| 触发 | 适用场景 |
| ---- | -------- |
| **定时** | 每个工作日早上自动送达的摘要 |
| **全局热键** | 自定一组按键，在任意 App 按下；流程拿得到你选中的文字 |
| **Telegram 或 LINE 消息** | 从手机向 Bot 发送一个你命名的 `/指令`；可指定哪些已配对的账号能用 |
| **斜杠指令** | 在 App 的输入框输入 `/你的流程` |
| **系统事件** | Yobi 启动时、电脑从睡眠唤醒后，或屏幕锁定、解锁时（锁定与解锁仅限 Windows 与 macOS） |

---

## 代理

给 `/agent` 一个目标，而不是一段提示词。它会规划、搜索、调用工具、检查自己的成果，也能把结果保存为一条流程，或修改你已有的流程，之后按定时自动运行。新建的流程保存时处于停用状态，要你开启后才会运行。读取无需确认；执行 shell 指令、保存流程，或使用会改变数据的连接器工具，都会先询问你；发送与删除即使选过**永远允许这个服务器**，也每次都会问。它只读取 Yobi 输出文件夹、文档、下载与桌面中的文件，也只写入输出文件夹。形似密钥或 Token 的内容在送入模型前会先遮蔽。

在聊天中，从输入框下方的模式菜单选 **Agent**（或输入 `/agent`），或在同一个菜单开启**网页**或任一连接器，消息就会交给 Agent 运行。Agent 模式下要不要上网，由它自己判断。三者都关闭时是普通多轮对话，保存为可重新打开并接续的 Markdown 文件。只有查了才答得对的问题（天气、股价、汇率）仍会交给 Agent，只限那一条。`Shift+Tab` 可轮换各服务商与其模型，`Ctrl+G` 用外部编辑器编辑草稿。答案完成后会渲染 Mermaid 图表与数学公式。回答可导出为 PNG、WebP 或 PDF，整段对话可生成端到端加密的分享链接。

个性化记忆保存关于你的短句：所在城市、正在进行的工作、偏好的回答方式。对话中遇到值得记的事，AI 会直接记下，并在回答下方显示“已记住”与**撤销**。你可以在**设置 → 个性化记忆**添加、编辑或删除；点**整理**会由 AI 提出合并与删除的建议，只有你勾选的项才会应用。

---

## 开始使用

**1. 安装：**

Windows 可从 [Microsoft Store](https://apps.microsoft.com/detail/9nnx8prfstc9) 安装（自动安装与更新）；也可以到 [GitHub Releases](https://github.com/WellWells/yobi/releases) 下载 Windows 安装包或 macOS DMG（Intel 与 Apple Silicon）。GitHub 版本未签名：Windows 首次启动会被拦截，请选择**更多信息 → 仍要运行**；macOS 的打开方式见[发行说明](https://github.com/WellWells/yobi/releases)。

**2. 30 秒跑出第一个结果：**

1. （可选）默认的 Gemini 与 Perplexity 无需账号即可使用；要用 Claude 或 ChatGPT，到**设置 → AI 模型**点它旁边的**登录**。
2. 在任意 App 中选中一段文字。
3. 按 **`Alt+G`**（macOS 为 `⌘⌃G`），Yobi 会发给你选定的 AI，把答案复制到剪贴板，并把这段对话保存为 Markdown 文件，可在**聊天**中重新打开。

接着打开**流程**，点**模板**。

<details>
<summary><b>改用源码运行</b>（Node.js 22.12+）</summary>

```bash
git clone https://github.com/WellWells/yobi.git
cd yobi
npm install   # Windows 未安装 Visual Studio 时：npm install --ignore-scripts
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

| 对话记录 | 导出选项 |
| :------------: | :------: |
| <img src="assets/screenshots/chat-history-summary-result.png" width="400" /> | <img src="assets/screenshots/export-options-preview.png" width="400" /> |
| 每段对话都保存为 Markdown 文件，可以重新打开接着聊 | 导出为 PNG、WebP 或 PDF，样式可自定义 |

---

## 用 Telegram 或 LINE 操控

接上一个 Bot，就能从手机使用你的 AI 与流程。Telegram 约两分钟就能设置好：

1. **创建 Bot** — 给 [@BotFather](https://t.me/BotFather) 发消息，复制它给你的 Token。
2. **填入 Token**：在 **设置 → Bot 整合** 开启 **启用 Telegram Bot**，把 Token 粘贴到 **Bot Token**，再点 **保存 Token**。
3. **配对账号**：点 **创建配对码**，再给你的 Bot 发送 `/start <配对码>`，或点 **打开 Telegram**。

LINE 要多几步：在 LINE Developers Console 创建 Messaging API channel，把它的 **Channel access token** 和 **Channel secret** 填进 LINE 卡片，再开一条通道让 LINE 连得上 Yobi 的本机 webhook（卡片上有 `cloudflared` 命令）。配对时点 **生成配对码**，把配对链接发给对方，点开就会自动填入 `/pair <配对码>`。

| 指令 | 功能 |
| ---- | ---- |
| `/gemini` · `/claude` · `/gpt` · `/pplx` | 指定用该服务商回答；每个自备密钥与密钥分组也各有自己的指令（名称可自定义） |
| `/search` | 搜索网络并附上来源作答（需要**网络搜索**权限） |
| `/new` | 开始一段全新的对话（闲置 6 小时后也会自动开新的） |
| `/help` | 列出你能用的指令（LINE） |
| `/output <模式>` | 设置所有人的回复格式：`md` · `compact` · `png` · `webp` · `pdf`（Telegram，管理员） |
| `/status` | 查看工作队列（Telegram，管理员） |
| `/restart` | 重启 Yobi（Telegram，管理员） |

指令可以不打：直接发消息就会交给 Bot 的**默认模型**，要不要上网查、用工具由 AI 自己判断。配对只代表能和 Bot 对话、使用模型指令；其他功能在已配对列表里逐个账号添加：**Agent**、**网络搜索**、**读取这台电脑**、**执行命令**（每个命令都会先列在聊天中，你同意后才执行）、连接器，以及**管理员**（仅 Telegram）。

流程的 **Bot** 触发器可以新增你自己的指令（例如 `/my_cmd`），两个平台都能用。指令后面的文字会带进流程，谁可以用也由你决定：**所有已配对的人**或**指定的人**。

---

## 设置

通用 · 键盘快捷键 · 外观 · 导出 · AI 模型 · AI 回应 · 个性化记忆 · 连接器 · Bot 整合 · 统计 · 备份与还原。

**AI 模型**也是 BYOK 的位置：在 **自备密钥（API）** 点 **添加密钥**，从列表选一个服务商（OpenAI、Anthropic、Google Gemini、OpenRouter、DeepSeek 等），其他端点（包括本机服务器）选 **OpenAI-compatible**，再粘贴密钥。它会出现在聊天的模型菜单、流程的 LLM 步骤，也会成为一个 Bot 指令。**密钥分组（轮询）** 把多个密钥组成一个服务商，轮流使用、某个失败就换下一个。**备份与还原**把设置（含密钥与密码）、流程、对话记录与记忆打包成单个 .zip，还原时可以选要还原哪些项目；密钥与密码只能在创建备份的同一台设备还原。

**通用 → 外部编辑器**决定在输入框按 `Ctrl+G` 时用哪个程序打开草稿；每次保存都会带回输入框。

---

## Yobi 如何工作

默认情况下，每个 AI 请求都是操作 Gemini、Claude、ChatGPT 与 Perplexity 的**网页界面**。Yobi 在内置浏览器窗口里把提示词输入服务商的网站，再从页面读回答案，与你手动操作的过程相同。Gemini 与 Perplexity 不登录也能用；Claude 与 ChatGPT 要先在那个窗口登录一次。它**不使用官方 API，也不使用本地模型**，这正是它无需 API Key、也没有费用的原因。（如果你添加自己的 API 密钥（BYOK）并选用它，Yobi 会改为直接调用该服务商的 API；以下说明都是针对网页界面。）

以网页而非官方 API 操作，这件事落在服务商的服务条款之外。以下是 Yobi 实际的做法。它的浏览器窗口以普通浏览器的身份出现，而不是 Electron：在 Windows 上，Google 的网站看到的是 Google 官方的 Gemini Windows App，其他网站看到的是 Chrome；在 macOS 上，Gemini 看到的是 Firefox。未登录 Perplexity 时，Yobi 会在每个新对话前（以及每 30 分钟）清除 perplexity.ai 的 Cookie 与网站数据，所以每个新对话都从新访客开始。如果 Perplexity 仍回复“Sign up and repeat your request”，Yobi 会以另一个新访客再试一次。Yobi 不破解 CAPTCHA、不轮换 IP。Claude 或 Perplexity 出现 Cloudflare“验证你是真人”的页面时，Yobi 会停止这次请求并打开浏览器窗口，让你完成验证后再发送一次。DuckDuckGo 要求验证时，Yobi 会停止搜索 3 分钟。Claude 提示用量已达上限时，Yobi 会告诉你几点后可以再用。

**请负责任地使用 Yobi**：不做违法的事，也不进行大规模或滥用式的自动化。个人轻度使用通常只会偶尔遇到验证；被封的是重度或滥用的用法。是否在此前提下使用由你自行决定，服务商的条款也可能变更，请自行确认。本文不构成法律建议。

---

## 安全与隐私

- **你的提示词去了哪里** — 发送到你选的那个 AI：输入它自己的网页，或发送到你设置的 BYOK 端点。聊天与 Agent 会一并发送你的个性化记忆与回答偏好。这些文字适用该服务商的隐私政策。
- **没有中间人、没有遥测** — Yobi 没有服务器也没有账号，不代理任何数据，也没有任何分析追踪。对话、流程、个性化记忆与导出文件都是本机硬盘上的普通文件，自动化逻辑可在 `src/main/` 查证。
- **其他会离开本机的数据** — 网络搜索发送到 DuckDuckGo，搜到的网页由 Yobi 直接读取。在聊天里，除非你在该对话关闭**网页**，Agent 可能会自己上网搜索；流程只在 **网络搜索** 与 **深度研究** 步骤搜索。分享链接包含整段对话，在 App 内先加密，再上传到 PrivateBin 服务器（默认 privatebin.net，可改成你自己的）；密钥放在链接的 `#fragment` 中，浏览器不会把它发给主机。连接器只会连接你添加的服务：LINE 连接器读取这台电脑上的 LINE 数据，Thunderbird 连接器只与这台电脑上的 Thunderbird 往来。Yobi 启动时会向 GitHub 检查新版本（Microsoft Store 版不会）。
- **Agent 修改任何东西前会先询问** — 读取无需询问。每个 shell 命令、它要保存或修改的每个流程，以及每个会修改数据的连接器工具，都需要你确认。发送与删除每次都会询问，选了**永远允许这个服务器**也一样。Agent 只读取“文档”、“下载”、“桌面”与 Yobi 输出文件夹里的文件，写入文件只限输出文件夹，这部分无需确认。工具读到的内容里形似密钥或 Token 的字符串，在送入模型前就会遮蔽。
- **Bot 只能用你给的权限** — 配对只让账号能聊天与使用模型指令。**Agent**、**网络搜索**、**读取这台电脑**、**执行命令**、连接器与**管理员**都在**设置 → Bot 整合**逐一授权给各账号；标为**本人**的账号拥有执行命令与管理员以外的全部权限。Bot 要执行的命令会先显示在聊天里，你选了**执行**才会运行。文件、命令与连接器只在私聊中可用，Bot 也永远不能修改连接器的数据。
- **凭据加密** — 你的 Telegram 与 LINE Token、SMTP 密码、BYOK 与其他 API 密钥、连接器的登录凭据，以及 LINE 数据库密钥，在写入磁盘前均使用操作系统的密钥存储（Electron `safeStorage`）加密。

---

## 延伸阅读

更完整的操作教程，附截图：

- [Yobi：用内建浏览器操作网页版 AI 的自动化工具，打造专属 Agent](https://wellstsai.com/post/yobi-free-ai-automation/) — 功能概览与安装设置
- [用 Telegram Bot 自动收 RSS 摘要：不用 API Key 的完整教程](https://wellstsai.com/post/telegram-bot-rss-ai-digest/) — 一条流程从头做到尾
- [免费 LLM API 密钥申请教程：Gemini、OpenRouter 额度实测](https://wellstsai.com/post/free-ai-api-key/) — 改走 BYOK 的话看这篇

---

## 开发

```bash
npm run dev         # 开发模式：界面实时更新；改了主进程后按 Enter 重新启动 Electron
npm run typecheck   # TypeScript 类型检查
npm run i18n:check  # 比对 language/*.json 与源代码；会删除代码已不再使用的 key
npm run build:win   # 构建 Windows（NSIS 安装包）
npm run build:msix  # 构建 Windows（Microsoft Store 用的 MSIX）
npm run build:mac   # 构建 macOS（DMG）
```

**技术栈：** Electron · React + TypeScript · Mantine · Zustand · Vite + electron-builder · grammY · LINE Bot SDK · MCP SDK

---

## 参与贡献

欢迎提 issue 与 PR。fork、建分支（`git checkout -b feat/my-feature`）、确认 `npm run typecheck` 通过，然后提交一个说明清晰的 PR。用户看得到的文字放在 `language/*.json`，三个内置语言（en-US、zh-TW、zh-CN）都要补；要新增其他语言，请看 [language/README.md](language/README.md)。较大的改动请先开 issue 讨论。

---

## 许可证

[**MIT**](LICENSE) — 可自由使用、修改与分发。

---

<div align="center">

如果 Yobi 帮你省下时间，请点个 ⭐ **Star**，能让更多人找到它！

**[报告问题](https://github.com/WellWells/yobi/issues) · [功能建议](https://github.com/WellWells/yobi/issues) · [讨论区](https://github.com/WellWells/yobi/discussions)**

</div>
