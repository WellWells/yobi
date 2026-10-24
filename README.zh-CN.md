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

**Yobi** 在桌面上跑自动化。流程把数据、AI 与动作串在一起，可以按定时、热键、Bot 指令、文件夹出现新文件或系统事件运行。因为跑在你的电脑上，流程能用本机的 LINE（Windows）、你的文件、shell 和真正的浏览器。AI 步骤走服务商自己的网页，无需 API Key，也没有 token 费用。

<!-- demos:hero:start -->
<p align="center"><img src="assets/demos/zh-CN/agent.webp" alt="由 Agent 完成多步骤任务" width="100%" /></p>
<!-- demos:hero:end -->

---

## 为什么选 Yobi

| 功能 | 说明 |
| ---- | ---- |
| **无代码流程** | 60 种步骤，以 `{{变量}}` 串接。从菜单加入，或描述需求让 AI 生成。 |
| **在本机运行** | 本机的 LINE（Windows）、文件、shell、浏览器窗口与 Thunderbird。无需部署。 |
| **无需 API Key** | AI 步骤操作服务商的网页。想用自己的密钥再开 BYOK。 |
| **会动手的 Agent** | 给 `/agent` 一个目标，它自己挑工具，改动任何东西前先问你。发给 Bot 的消息也由 Agent 处理，工具取决于你给每个账号的权限。 |
| **连接器** | Notion、GitHub、Figma、Stripe 等，或粘贴任何 MCP 服务器网址。内置 LINE、Thunderbird、邮箱与 X。 |
| **触发方式** | 定时、全局热键、Bot 指令、App 内斜杠指令、文件夹新文件、系统事件。 |
| **AI 服务商** | Gemini、Claude、ChatGPT、Perplexity。Gemini 与 Perplexity 不登录也能用。 |
| **没有中间人** | Yobi 没有服务器，提示词直接发到你选的 AI 网站。 |
| **多语言** | English、繁體中文、简体中文，另可放入语言包（[说明](language/README.md)）。 |

---

<!-- demos:start -->
## 实际操作

<table>
<tr>
<td width="33%" valign="top">
<a href="assets/demos/zh-CN/flow-build.webp"><img src="assets/demos/zh-CN/flow-build.webp" alt="用文字描述创建流程" width="100%" /></a>
<br /><b>用文字描述创建流程</b>
<br /><sub>用一句话描述自动化需求，生成可直接运行、也可逐步修改的流程。</sub>
</td>
<td width="33%" valign="top">
<a href="assets/demos/zh-CN/writing.webp"><img src="assets/demos/zh-CN/writing.webp" alt="改写选中的段落" width="100%" /></a>
<br /><b>改写选中的段落</b>
<br /><sub>仅改写回答中选中的段落，修改直接写回 Markdown。</sub>
</td>
<td width="33%" valign="top">
<a href="assets/demos/zh-CN/telegram.webp"><img src="assets/demos/zh-CN/telegram.webp" alt="通过 Telegram 分析地点评论" width="100%" /></a>
<br /><b>通过 Telegram 分析地点评论</b>
<br /><sub>向 Telegram Bot 发送 Google 地图链接，由电脑端读取评论并回传分析。</sub>
</td>
</tr>
<tr>
<td width="33%" valign="top">
<a href="assets/demos/zh-CN/downloader.webp"><img src="assets/demos/zh-CN/downloader.webp" alt="下载 bilibili 视频" width="100%" /></a>
<br /><b>下载 bilibili 视频</b>
<br /><sub>粘贴 bilibili 链接，可下载视频、字幕文件或生成内容摘要。</sub>
</td>
<td width="33%" valign="top">
<a href="assets/demos/zh-CN/notion.webp"><img src="assets/demos/zh-CN/notion.webp" alt="导入并编辑 Notion 页面" width="100%" /></a>
<br /><b>导入并编辑 Notion 页面</b>
<br /><sub>导入 Notion 页面，借助 AI 编辑后同步回 Notion。</sub>
</td>
<td width="33%" valign="top">
<a href="assets/demos/zh-CN/files.webp"><img src="assets/demos/zh-CN/files.webp" alt="汇总本机文件" width="100%" /></a>
<br /><b>汇总本机文件</b>
<br /><sub>读取本机文件并整理成摘要。</sub>
</td>
</tr>
</table>
<!-- demos:end -->

---

## 流程

一条流程就是一串步骤，上一步的输出经由 `{{变量}}` 传给下一步：

```
定时       每天 09:00
    ↓
LINE      → {{chat}}      昨日至今的群组消息
    ↓
问 AI     → {{summary}}   摘要，并挑出决议与待办
    ↓
Telegram  发送 {{summary}}
```

也可以直接描述需求，让 AI 组出整条流程，每一步之后都能改：

> *“每个工作日早上 8 点，摘要我的 RSS 并发到 Telegram。”*

内置 28 条模板可以直接改：有的按定时、有的用热键处理选中的文字、有的用聊天或 Bot 指令触发。

**步骤：**

- **获取数据** — 网页、RSS、HTTP API、YouTube 字幕与订阅频道新视频、网络搜索与深度研究、Google 地图评论、LINE 对话、Telegram 群组、X 帖子／回复／趋势、新邮件、日历、股票、汇率、天气、空气质量、农民历
- **使用连接器** — 调用已添加连接器的任一工具，例如 Notion 或 Jira
- **抓取列表** — 在网页上点一条标题，Yobi 找出其他条目
- **操作浏览器** — 开标签页、点击、填表单、截图
- **询问 AI** — Gemini、Claude、ChatGPT、Perplexity 或 BYOK
- **发送结果** — Telegram、LINE、Discord、Slack、发邮件、文件、PDF、图片、分享链接、剪贴板、通知
- **运行程序** — 程序、JavaScript、shell、系统与电源控制
- **流程控制** — 循环、条件、延迟、提前停止、“有变化才通知”

流程是普通的 `.json` 文件。导出时不含你填的变量值与 Bot 账号 ID；导入前会先列出它会访问什么。

---

## 连接器

**这台电脑上：**

- **LINE**（Windows）— 从运行中的 LINE 电脑版列出聊天、搜索消息、读取对话。不会发送任何内容，也不会标为已读。流程用 **LINE 消息** 步骤。
- **Thunderbird** — 搜索、阅读、撰写、回复、转发、归档邮件，以及日历、任务与联系人。需要 Thunderbird MCP 扩展（**设置 → 连接器**有链接）。流程发信用 **发送 Email** 步骤。

**邮箱。** 在**设置 → 连接器 → 邮箱**添加邮箱：Gmail、Yahoo、iCloud 用应用专用密码，Outlook、Hotmail、Microsoft 365 用**用 Microsoft 登录**，其他填 IMAP／SMTP 服务器。Agent 会一次搜索全部邮箱，可以读信、保存附件、写草稿、回复、发送、整理与移到垃圾箱；发送与移到垃圾箱每次都会问。流程用 **读新邮件** 与 **发送 Email**。

**X（推特）。** 搜索帖子、看趋势、读取账号最新帖子与帖子下的回复。在**设置 → 连接器**开启并登录（搜索与趋势需要登录）；消息里提到 X 或推特，Agent 就会去 X 查。流程用 **X 追踪**、**X 帖子与回复**、**X 热门趋势**。未登录只能看到每个账号最新几条与少数热门回复，也没有趋势。

**云端服务。** 连接一次（多数要登录，GitHub 粘贴 Token，查资料类无需设置）：

- **工作** — Notion · Linear · Asana · Atlassian（Jira 与 Confluence）· Airtable · Dropbox · Zapier
- **开发** — GitHub · Sentry · Vercel · Netlify · Supabase · Neon · Cloudflare
- **设计** — Figma · Webflow · Wix
- **商务** — Stripe · Square · PayPal · Intercom
- **查资料** — Context7 · DeepWiki · Microsoft Learn · Cloudflare Docs · Hugging Face

其他支持 MCP 的服务粘贴网址即可。全部默认关闭，在**设置 → 连接器**开启。写入操作都会先问；**永远允许这个服务器**只跳过修改类的确认，发送与删除每次都问。

---

## 触发方式

| 触发 | 适用场景 |
| ---- | -------- |
| **定时** | 每个工作日早上送来的摘要 |
| **全局热键** | 在任意 App 按下自定按键；流程拿得到选中的文字 |
| **Bot 消息** | 发给 Telegram、LINE、Discord 或 Slack Bot 的 `/指令`；可指定哪些已配对账号能用 |
| **斜杠指令** | 在 App 输入框输入 `/你的流程` |
| **新文件** | 指定文件夹里每存入、下载或移入一个文件，写完就运行一次 |
| **系统事件** | Yobi 启动、电脑从睡眠唤醒、屏幕锁定或解锁（锁定与解锁仅限 Windows 与 macOS） |

---

## 代理

给 `/agent` 一个目标，而不是一段提示词。它会规划、搜索、调用工具、检查结果，也能把做法保存为流程（或修改已有流程）之后按定时运行。新流程保存时处于停用状态。它动手前会问什么，见[安全与隐私](#安全与隐私)。

在聊天中，从输入框下方的模式菜单选 **Agent**，或在同一个菜单开启**网页**或连接器。全部关闭时就是普通对话，保存为可重新打开的 Markdown 文件。需要查资料才答得出的问题（天气、股价、汇率）仍会交给 Agent，只限那一条。

`Shift+Tab` 切换服务商与模型，`Ctrl+G` 用外部编辑器写草稿。回答会渲染 Mermaid 与数学公式，可导出 PNG、WebP、PDF；整段对话可生成端到端加密的分享链接。

个性化记忆保存关于你的短句，例如所在城市、偏好的回答方式。AI 记下时会在回答下方显示，可点**撤销**。在**设置 → 个性化记忆**可以添加、编辑、删除；**整理**会建议合并与删除，只应用你勾选的项。

---

## 开始使用

**1. 安装：**

```bash
brew install --cask wellwells/tap/yobi   # macOS（Intel 与 Apple Silicon）
```

或从 [Microsoft Store](https://apps.microsoft.com/detail/9nnx8prfstc9)（Windows，自动更新）、[GitHub Releases](https://github.com/WellWells/yobi/releases)（Windows 安装包、macOS DMG）下载。GitHub 版本未签名：Windows 请选择**更多信息 → 仍要运行**；macOS 见[发行说明](https://github.com/WellWells/yobi/releases)。

**2. 试一下：**

1. 默认的 Gemini 与 Perplexity 无需账号。要用 Claude 或 ChatGPT，到**设置 → AI 模型**点旁边的**登录**。
2. 在任意 App 选中一段文字。
3. 按 **`Alt+G`**（macOS 为 `⌘⌃G`）。答案会复制到剪贴板，对话保存在**聊天**里。

**`Alt+J`**（macOS 为 `⌘⌃J`）则是框选屏幕的一块，再对它提问。

接着到**流程 → 模板**。

<details>
<summary><b>从源码运行</b>（Node.js 22.12+）</summary>

```bash
git clone https://github.com/WellWells/yobi.git
cd yobi
npm install   # Windows 未安装 Visual Studio 时：npm install --ignore-scripts
npm run dev
```
</details>

---

## 界面截图

| 流程编辑器 | `/agent` |
| :--------: | :------: |
| <img src="assets/screenshots/flow-editor-rss-step.png" width="400" /> | <img src="assets/screenshots/agent-command-result.png" width="400" /> |
| 抓取、AI 摘要，按定时发到 Telegram | 给它目标，它自己挑工具 |

| 聊天 | 模型选择 |
| :--: | :------: |
| <img src="assets/screenshots/main-chat-interface.png" width="400" /> | <img src="assets/screenshots/model-selection-menu.png" width="400" /> |
| 通过 AI 的网页对话 | 切换服务商与模型 |

| 对话记录 | 导出 |
| :------: | :--: |
| <img src="assets/screenshots/chat-history-summary-result.png" width="400" /> | <img src="assets/screenshots/export-options-preview.png" width="400" /> |
| 对话保存为 Markdown 文件，可重新打开 | PNG、WebP、PDF，样式可自定义 |

---

## 用手机操控

接上 Telegram、LINE、Discord 或 Slack Bot，就能从手机用你的 AI 与流程。Telegram 约两分钟：

1. 向 [@BotFather](https://t.me/BotFather) 创建 Bot，复制 Token。
2. 在**设置 → Bot 整合**开启**启用 Telegram Bot**，把 Token 粘贴到 **Bot Token**，点**保存 Token**。
3. 点**创建配对码**，给 Bot 发送 `/start <配对码>`，或点**打开 Telegram**。

**LINE：** 在 LINE Developers Console 创建 Messaging API channel，把 **Channel access token** 和 **Channel secret** 填进 LINE 卡片，再开一条通道连到 Yobi 的本机 webhook（卡片上有 `cloudflared` 命令）。配对时点**生成配对码**，把链接发给对方。

**Discord 与 Slack** 由这台电脑主动连出，不用开通道。Discord 在 Developer Portal 创建应用、粘贴 bot token；Slack 用卡片上的配置清单创建 App、粘贴两个 token。配对方式与 LINE 相同。

没配对的人私聊 Bot 就是申请加入，在**设置 → Bot 整合**允许或屏蔽；Telegram 与 LINE 也会发一张有**允许**与**屏蔽**的卡片给你。

| 指令 | 功能 |
| ---- | ---- |
| `/gemini` · `/claude` · `/gpt` · `/pplx` | 指定服务商回答；每个自备密钥与密钥分组也有自己的指令（名称可自定义） |
| `/search` | 搜索网络并附来源（需要**网络搜索**权限） |
| `/new` | 开新对话（闲置 6 小时也会自动开新的） |
| `/help` | 列出能用的指令（LINE） |
| `/output <模式>` | 设置所有人的回复格式：`md` · `compact` · `png` · `webp` · `pdf`（Telegram，管理员） |
| `/status` | 查看工作队列（Telegram，管理员） |
| `/restart` | 重启 Yobi（Telegram，管理员） |
| `/users` · `/invite` · `/groups` | 处理加入申请与权限、发会过期的邀请链接、决定哪些群组能用 Bot（Telegram 管理员；LINE 只有你本人） |

直接发消息会交给 Bot 的**默认模型**，要不要查资料、用工具由 AI 判断。配对只能聊天与用模型指令；其他权限逐个账号开：**Agent**、**网络搜索**、**读取这台电脑**、**执行命令**（每个命令都要你同意才执行）、连接器、**管理员**（仅 Telegram）。

你和管理员也能在私聊请 Bot 创建或修改流程，例如“每天早上 8 点把天气预报发给我”。保存前 Bot 会先问你。会操作电脑的流程，以及管理员创建、会读取你的数据或代替你操作（保存文件、发邮件、在你登录的浏览器打开网页）的流程，会保存为停用，等你在电脑上确认。

流程的 **Bot** 触发器可以加你自己的指令（例如 `/my_cmd`），每个平台都能用。指令后的文字会带进流程，可开放给**所有已配对的人**或**指定的人**。

---

## 设置

AI 模型 · AI 回应 · 个性化记忆 · 连接器 · Bot 整合 · 通用 · 外观 · 通知 · 链接与下载 · 导出 · 键盘快捷键 · 统计 · 备份与还原。

**BYOK：** 在**AI 模型 → 自备密钥（API）**点**添加密钥**，选服务商（OpenAI、Anthropic、Google Gemini、OpenRouter、DeepSeek 等），其他端点（包括本机服务器）选 **OpenAI-compatible**。密钥会出现在聊天的模型菜单、流程的 AI 步骤，也会成为一个 Bot 指令。**密钥分组（轮询）**让多个密钥轮流用，某个失败就换下一个。

**备份与还原**把设置（含密钥与密码）、流程、对话与记忆打包成一个 .zip，还原时可挑项目。密钥与密码只能在原来那台设备还原。

---

## Yobi 如何工作

默认每个 AI 请求都走服务商的**网页**：Yobi 在内置浏览器窗口把提示词输入 Gemini、Claude、ChatGPT 或 Perplexity，再从页面读回答案。Gemini 与 Perplexity 不登录也能用；Claude 与 ChatGPT 要在那个窗口登录一次。不用官方 API、也不用本地模型，所以无需密钥也不收费。（选用 BYOK 密钥时，改为直接调用该服务商的 API。）

用网页而非官方 API 不在服务商条款允许的范围内。Yobi 的做法：

- 浏览器窗口以普通浏览器的身份出现，不是 Electron。Windows 上，Google 的网站看到的是 Google 官方的 Gemini Windows App，其他网站看到 Chrome；macOS 上 Gemini 看到的是 Firefox。
- 未登录 Perplexity 时，每个新对话前（以及每 30 分钟）清除 perplexity.ai 的 Cookie 与网站数据。若仍被要求注册，会以新访客再试一次。
- 不破解 CAPTCHA、不换 IP。Claude 或 Perplexity 弹出 Cloudflare 验证时，停下这次请求并打开窗口让你完成验证。DuckDuckGo 要求验证时暂停搜索 3 分钟。Claude 用量到上限时，告诉你几点可以再用。

请合理使用：不做违法的事，不做大规模或滥用的自动化。个人轻度使用通常只会偶尔遇到验证。服务商条款可能变更，请自行确认。本文不构成法律建议。

---

## 安全与隐私

- **提示词**发送到你选的 AI：它的网页，或你的 BYOK 端点。聊天与 Agent 会一并发送个性化记忆与回答偏好，适用该服务商的隐私政策。
- **没有服务器、没有遥测。** Yobi 没有账号、没有分析追踪。对话、流程、记忆与导出文件都是你硬盘上的普通文件。
- **其他会离开电脑的数据。** 网络搜索发送到 DuckDuckGo，搜到的网页直接读取。聊天中除非关闭**网页**，Agent 可能自己搜索；流程只在**网络搜索**与**深度研究**步骤搜索。分享链接在 App 内加密后才上传到 PrivateBin（默认 privatebin.net，可改成自己的），密钥在链接的 `#fragment`，浏览器不会发送。连接器只连接你添加的服务。Yobi 启动时会向 GitHub 检查新版本（Store 版不会）。
- **Agent 动手前会问。** 读取无需确认。shell 命令、保存或修改流程、会修改数据的连接器工具都要你确认；发送与删除每次都问，选了**永远允许这个服务器**也一样。它只读 Yobi 输出文件夹、文档、下载与桌面，只写入输出文件夹。形似密钥或 Token 的内容送入模型前会遮蔽。
- **Bot 只有你给的权限。** 在**设置 → Bot 整合**逐个账号授权；标为**本人**的账号拥有执行命令与管理员以外的全部权限。文件、命令与连接器只在私聊可用，从 Bot 修改连接器数据只能在你自己的私聊、确认后才执行。
- **凭据加密。** Bot Token、邮箱密码与 Microsoft 登录、API 密钥、连接器登录与 LINE 数据库密钥，都用操作系统的密钥存储（Electron `safeStorage`）加密。

---

## 延伸阅读

- [Yobi：用内建浏览器操作网页版 AI 的自动化工具，打造专属 Agent](https://wellstsai.com/post/yobi-free-ai-automation/) — 功能与安装
- [用 Telegram Bot 自动收 RSS 摘要：不用 API Key 的完整教程](https://wellstsai.com/post/telegram-bot-rss-ai-digest/) — 一条流程从头做到尾
- [免费 LLM API 密钥申请教程：Gemini、OpenRouter 额度实测](https://wellstsai.com/post/free-ai-api-key/) — 想用 BYOK 看这篇

---

## 开发

```bash
npm run dev         # 开发模式；改了主进程后按 Enter 重启 Electron
npm run typecheck   # TypeScript 类型检查
npm run i18n:check  # 比对 language/*.json 与源代码；会删除没用到的 key
npm run build:win   # Windows（NSIS 安装包）
npm run build:mac   # macOS（DMG）
```

**技术栈：** Electron · React + TypeScript · Mantine · Zustand · Vite + electron-builder · grammY · LINE Bot SDK · MCP SDK

---

## 参与贡献

欢迎 issue 与 PR，提交前确认 `npm run typecheck` 通过。用户看得到的文字放在 `language/*.json`，en-US、zh-TW、zh-CN 都要补；新增语言见 [language/README.md](language/README.md)。较大的改动请先开 issue。

---

## 许可证

[MIT](LICENSE)

---

<div align="center">

如果 Yobi 帮你省下时间，请点个 ⭐ **Star**，能让更多人找到它！

**[报告问题](https://github.com/WellWells/yobi/issues) · [功能建议](https://github.com/WellWells/yobi/issues) · [讨论区](https://github.com/WellWells/yobi/discussions)**

</div>
