<div align="center">

# Yobi

**桌面 AI 自動化。流程在本機執行，可操作這台電腦上的應用程式，AI 不需 API 金鑰。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-blue)](#開始使用)
[![Microsoft Store](https://img.shields.io/badge/Microsoft%20Store-Download-0067b8)](https://apps.microsoft.com/detail/9nnx8prfstc9)
[![Electron](https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-brightgreen.svg)](https://github.com/WellWells/yobi/pulls)

**[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md)**

</div>

---

**Yobi** 是一套在桌面執行的流程引擎。把資料、AI 與動作串成自動化，再以排程、全域熱鍵、Telegram 或 LINE 訊息，或 App 內的斜線指令觸發。因為它執行在你的電腦上而非伺服器，流程能取用雲端工具接觸不到的對象：本機安裝的 LINE 與 Thunderbird、你的檔案、shell，以及一個真正的瀏覽器。AI 步驟驅動的是服務商自家的網頁，因此不需要 API 金鑰，也沒有按 token 計費的帳單。

---

## 為什麼用 Yobi

| 功能 | 說明 |
| ---- | ---- |
| **無程式碼流程** | 47 種步驟，以 `{{變數}}` 串接。可以拖拉組裝，也可以描述需求讓 AI 生成。 |
| **在本機執行** | 流程可取用這台電腦上的 LINE 與 Thunderbird，以及你的檔案、shell 與瀏覽器視窗。無須架設。 |
| **不需 API 金鑰** | AI 步驟驅動服務商的網頁，而非付費 API。想用自己的金鑰再開 BYOK 即可。 |
| **會執行動作的代理** | `/agent` 接下目標後自行挑選工具，變更任何東西之前會先徵詢你。 |
| **連接器** | Notion、GitHub、Figma、Stripe 等服務，另有本機的 LINE 與 Thunderbird。 |
| **四種觸發方式** | 排程、全域熱鍵、Telegram 或 LINE 訊息、App 內斜線指令。一條流程可同時使用多種。 |
| **主流 AI 全都有** | ChatGPT、Claude、Gemini、Perplexity，各自的模型與思考強度皆可選。 |
| **沒有中間人** | Yobi 自己不執行任何伺服器。提示詞直接送往你選的 AI 網站，其餘一律留在本機硬碟。 |
| **多語系** | 內建英文、繁體中文、简体中文，另可放入語言包擴充（[說明](language/README.md)）。 |

---

## 流程

一條流程就是一串步驟，前一步的輸出經由 `{{變數}}` 成為下一步的輸入：

```
排程       每個平日 08:00
    ↓
LINE      → {{chat}}      昨日至今的群組訊息
    ↓
問 AI     → {{summary}}   摘要，並挑出決議與待辦
    ↓
Telegram  送出 {{summary}}
```

不必自行組裝。描述你要的結果，AI 會用下面這些步驟組出整條流程，每一步之後仍可修改：

> *「每個平日早上 8 點，摘要我的 RSS 並送到 Telegram。」*

上面那條也內建為範本，另有多條可以直接拿來改——一部分按排程執行，一部分用斜線指令觸發。

**步驟依類型：**

- **取得資料** — 網頁、RSS、HTTP API、YouTube 字幕、網路搜尋、Google 地圖評論、LINE 對話、即時股票 / 外匯 / 天氣 / 空氣品質
- **擷取清單** — 在真實網頁上點一則標題，Yobi 推算出整份清單的選擇器
- **操作瀏覽器** — 開分頁、點擊、填表單、擷圖
- **詢問 AI** — ChatGPT、Claude、Gemini、Perplexity，或 BYOK
- **送出結果** — Telegram、LINE、以你自己的 SMTP 帳號寄信、檔案、分享連結、剪貼簿
- **執行程式** — 程式、JavaScript、shell，以及系統與電源控制
- **流程控制** — 迴圈、條件、排程，以及「有變化才通知」

流程是單純的 `.json` 檔，可一鍵匯出、分享與匯入。

---

## 流程能取用什麼

**這台電腦上。** 以下兩個連接的是本機安裝的應用程式，不經過雲端帳號：

- **LINE**（Windows）— 列出聊天室、搜尋訊息、取出某段對話。不會送出任何內容給 LINE，也不會將訊息標示為已讀。也可用 LINE 流程步驟。
- **Thunderbird** — 搜尋與閱讀郵件、回覆、轉寄、歸檔，以及行事曆、工作與聯絡人。

**雲端服務。** 登入一次，該連接器的工具就能供 `/agent` 使用：

- **工作** — Notion · Linear · Asana · Atlassian（Jira 與 Confluence）· Airtable · Dropbox · Zapier
- **開發** — GitHub · Sentry · Vercel · Netlify · Supabase · Neon · Cloudflare
- **設計** — Figma · Webflow · Wix
- **商務** — Stripe · Square · PayPal · Intercom
- **查資料** — Context7 · DeepWiki · Microsoft Learn · Cloudflare Docs · Hugging Face

清單以外只要支援 MCP 也能加入：貼上網址即可。在**設定 → 連接器**啟用，該頁也會帶你完成各連接器所需的設定。啟用前一律不會運作，任何會寫入的操作都會先徵求確認。

---

## 觸發方式

| 觸發 | 適用情境 |
| ---- | -------- |
| **排程** | 每個平日早上自動送達的摘要 |
| **全域熱鍵** | 在任何 App 選取文字，按 `Alt+G`（macOS 為 `⌘⌃G`），取得答案並自動存檔 |
| **Telegram 或 LINE 訊息** | 從手機執行流程 |
| **斜線指令** | 在 App 的輸入框輸入 `/你的流程` |

---

## 代理

給 `/agent` 一個目標，而不是一段提示詞。它會規劃、搜尋、呼叫工具、檢查自己的成果，也能把結果寫成一條流程，之後按排程自動執行。讀取不需確認；執行 shell 指令、寫入檔案、寄送郵件，或呼叫任何會變更狀態的連接器工具，都需要你確認。檔案存取限制在你允許的資料夾內，形似金鑰或 token 的內容在送入模型前會先遮罩。

在聊天中勾選輸入框下方 pill 裡的**網頁**或任一連接器，該段對話即以代理模式執行；否則維持一般多輪對話，存成可重新開啟並接續的 Markdown 檔。`Shift+Tab` 可輪播各服務商與其模型。答案會邊產生邊渲染，含 Mermaid 圖表與數學式，並可匯出成 PNG、PDF 或端對端加密的分享連結。

個人化記憶保存關於你的短句：所在城市、正在進行的工作、偏好的回答方式。AI 會在對話中提議，你同意之前不會寫入任何一條。

---

## 開始使用

**1. 下載**適合你作業系統的最新版本：

| 平台 | 下載 | 說明 |
| ---- | ---- | ---- |
| **Windows** | [**Microsoft Store**](https://apps.microsoft.com/detail/9nnx8prfstc9) **（建議）** | 自動安裝與更新。 |
| **Windows** | [GitHub Releases](https://github.com/WellWells/yobi/releases) — NSIS 安裝檔（x64） | 未簽章，首次啟動 Windows 會攔截，選**其他資訊 → 仍要執行**。 |
| **macOS** | [GitHub Releases](https://github.com/WellWells/yobi/releases) — DMG（Intel 與 Apple Silicon） | 未簽章，首次啟動會被 Gatekeeper 擋下，開啟方式見[發行說明](https://github.com/WellWells/yobi/releases)。 |

**2. 30 秒內跑出第一個結果：**

1. （可選）開啟內建瀏覽器，登入 ChatGPT / Claude / Gemini / Perplexity。
2. 在任何 App 裡選取一段文字。
3. 按 **`Alt+G`**，Yobi 會送給你選定的 AI，並把回覆存成有時間戳記的 Markdown 檔。

接著開啟**流程**，從範本開始。

<details>
<summary><b>改用原始碼執行</b>（Node.js 22.12+）</summary>

```bash
git clone https://github.com/WellWells/yobi.git
cd yobi
npm install
npm run dev
```
</details>

---

## 畫面截圖

| 流程編輯器 | `/agent` 實際執行 |
| :--------: | :---------------: |
| <img src="assets/screenshots/flow-editor-rss-step.png" width="400" /> | <img src="assets/screenshots/agent-command-result.png" width="400" /> |
| 抓取、用 AI 摘要，再按排程送到 Telegram | 給它一個目標，它自行挑選工具並執行 |

| 主要聊天介面 | 模型選擇 |
| :----------: | :------: |
| <img src="assets/screenshots/main-chat-interface.png" width="400" /> | <img src="assets/screenshots/model-selection-menu.png" width="400" /> |
| 透過 AI 的網頁介面對話 | 切換服務商，並挑選各自的模型 |

| 對話紀錄與摘要 | 匯出選項 |
| :------------: | :------: |
| <img src="assets/screenshots/chat-history-summary-result.png" width="400" /> | <img src="assets/screenshots/export-options-preview.png" width="400" /> |
| 自動存檔並附上時間戳記 | 匯出成 PNG、WebP 或 PDF，樣式可自訂 |

---

## 用 Telegram 或 LINE 操控

接上一個 bot，就能從手機使用你的 AI 與流程。設定約需兩分鐘：

1. **建立 bot** — 在 Telegram 向 [@BotFather](https://t.me/BotFather) 傳訊息，複製它給你的 token。（LINE 則是建立一個 Messaging API channel。）
2. **貼上 token**，位置在 **設定 → Telegram**（或 **LINE**）。
3. **對你的 bot 說 `/start`**，依配對提示完成。

| 指令 | 功能 |
| ---- | ---- |
| `/gpt` · `/claude` · `/gemini` · `/pplx` | 詢問該服務商（指令可自訂） |
| `/agent` | 交給它一個目標，與 App 內相同 |
| `/search` | 搜尋網路並附上來源作答（僅 bot 有） |
| `/new` | 開始一段全新的對話 |
| `/output <模式>` | 設定回覆格式：`md` · `png` · `webp` · `pdf` |
| `/status` | 查看代理狀態 |
| `/restart` | 重新啟動 Yobi（管理員） |

也可以完全不使用指令：在該 bot 的設定裡開啟**免指令對話**，之後直接傳訊息就會當成一般對話送給你的 AI。

流程裡的 **Bot 觸發器**能把任何訊息變成你自己的指令，兩個平台皆支援。

---

## 設定

一般 · 鍵盤快速鍵 · 外觀 · 匯出 · AI 回應 · 個人化記憶 · 模型來源 · 連接器 · Bot 整合 · 統計 · 備份與還原。

**模型來源**也是 BYOK 的位置：加入 OpenAI 相容端點或 Gemini API 金鑰作為額外的服務商，之後在聊天與流程中與其他選項一樣可選。**備份與還原**把全部設定寫成單一 JSON 檔。

---

## Yobi 怎麼運作

AI 步驟自動操作 ChatGPT、Claude、Gemini 與 Perplexity 的**網頁介面**。Yobi 在內建瀏覽器視窗裡把提示詞輸入服務商的網站，再從頁面讀回答案，與你手動操作的流程相同。只有需要登入的服務商才要你在那裡登入。它**不使用官方 API，也不使用本機模型**，這正是它不需要 API 金鑰、也沒有費用的原因。（可選的 BYOK 模式改為直接呼叫 OpenAI 相容端點或 Gemini API；以下說明皆針對預設的瀏覽器模式。）

以網頁而非官方 API 操作，這件事落在服務商的服務條款之外。不過 Yobi 不繞過任何保護措施：不解 CAPTCHA、不規避速率限制、不輪換 IP。實務上最多會遇到防機器人檢查，也就是 Cloudflare 那類「驗證你是真人」的頁面；發生時 Yobi 會暫停，將控制權交還給你手動通過。

**請負責任地使用 Yobi**：不做違法的事，也不進行大規模或濫用式的自動化。個人輕度使用通常只會偶爾遇到驗證；被擋下的是重度或濫用的用法。是否在此前提下使用由你自行決定，服務商的條款也可能變動，請自行確認。本文不構成法律建議。

---

## 安全與隱私

- **你的提示詞去了哪裡** — 送到你選的那個 AI 網站，輸入它自己的網頁。那是你的文字唯一會去的地方，並適用該服務商的隱私權政策。
- **沒有中間人、沒有遙測** — Yobi 沒有伺服器也沒有帳號，不代理任何資料，也沒有任何分析追蹤。對話、流程與匯出檔都是本機硬碟上的普通檔案，自動化邏輯可在 `src/main/` 查核。
- **其餘會離開這台電腦的功能一律由你主動開啟** — 只有在**網頁**開啟時才會向 DuckDuckGo 查詢。分享連結在 App 內先加密才上傳，金鑰放在連結的 `#fragment`，瀏覽器不會將其送給主機。連接器只會連到你自行登入的服務，LINE 與 Thunderbird 兩個則只與這台電腦上的應用程式往來。
- **代理執行動作前會先詢問** — 讀取免詢問，寫入須確認。執行 shell 指令、寫入檔案、寄送郵件，或呼叫任何會變更狀態的連接器工具，都需要你確認。檔案存取限制在你允許的資料夾內，形似金鑰或 token 的內容在送入模型前就會遮罩。
- **加密憑證** — 你的 Telegram／LINE token、SMTP 密碼與 BYOK API 金鑰會以作業系統金鑰圈（Electron `safeStorage`）加密後才寫入磁碟。

---

## 延伸閱讀

更完整的操作教學，附截圖：

- [Yobi：用內建瀏覽器操作網頁版 AI 的自動化工具，打造專屬 Agent](https://wellstsai.com/post/yobi-free-ai-automation/) — 功能概觀與安裝設定
- [用 Telegram Bot 自動收 RSS 摘要：不用 API Key 的完整教學](https://wellstsai.com/post/telegram-bot-rss-ai-digest/) — 一條流程從頭做到尾
- [免費 LLM API 金鑰申請教學：Gemini、OpenRouter 額度實測](https://wellstsai.com/post/free-ai-api-key/) — 改走 BYOK 的話看這篇

---

## 開發

```bash
npm run dev         # 開發伺服器，含 Electron 熱重載
npm run typecheck   # TypeScript 型別檢查
npm run i18n:check  # i18n key 稽核
npm run build:win   # 建置 Windows（NSIS 安裝檔）
npm run build:mac   # 建置 macOS（DMG）
```

**技術堆疊：** Electron · React + TypeScript · Mantine · Zustand · Vite + electron-builder · grammY · LINE Bot SDK · MCP SDK

---

## 參與貢獻

歡迎開 issue 與 PR。fork、開分支（`git checkout -b feat/my-feature`）、確認 `npm run typecheck` 通過，然後開一個說明清楚的 PR。較大的改動請先開 issue 討論。

---

## 授權

[**MIT**](LICENSE) — 可自由使用、修改與散布。

---

<div align="center">

如果 Yobi 幫你省下時間，請給個 ⭐ **Star**，能讓更多人找到它！

**[回報問題](https://github.com/WellWells/yobi/issues) · [功能建議](https://github.com/WellWells/yobi/issues) · [討論區](https://github.com/WellWells/yobi/discussions)**

</div>
