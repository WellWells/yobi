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

**Yobi** 在桌面上跑自動化。流程把資料、AI 與動作串在一起，可以按排程、熱鍵、Bot 指令、資料夾出現新檔案或系統事件執行。因為跑在你的電腦上，流程能用本機的 LINE（Windows）、你的檔案、shell 與真正的瀏覽器。AI 步驟走服務商自己的網頁，不需要 API 金鑰，也沒有 token 費用。

<!-- demos:hero:start -->
<p align="center"><img src="assets/demos/zh-TW/agent.webp" alt="由 Agent 完成多步驟任務" width="100%" /></p>
<!-- demos:hero:end -->

---

## 為什麼用 Yobi

| 功能 | 說明 |
| ---- | ---- |
| **無程式碼流程** | 60 種步驟，以 `{{變數}}` 串接。從選單加入，或描述需求讓 AI 生成。 |
| **在本機執行** | 本機的 LINE（Windows）、檔案、shell、瀏覽器視窗與 Thunderbird。無須架設。 |
| **不需 API 金鑰** | AI 步驟操作服務商的網頁。想用自己的金鑰再開 BYOK。 |
| **會動手的 Agent** | 給 `/agent` 一個目標，它自己挑工具，變更任何東西前先問你。傳給 Bot 的訊息也由 Agent 處理，工具依你給每個帳號的權限而定。 |
| **連接器** | Notion、GitHub、Figma、Stripe 等，或貼上任何 MCP 伺服器網址。內建 LINE、Thunderbird、信箱與 X。 |
| **台灣** | PTT、台鐵、高鐵與七個捷運系統、統一發票對獎。 |
| **觸發方式** | 排程、全域熱鍵、Bot 指令、App 內斜線指令、資料夾新檔案、系統事件。 |
| **AI 服務商** | Gemini、Claude、ChatGPT、Perplexity。Gemini 與 Perplexity 不登入也能用。 |
| **沒有中間人** | Yobi 沒有伺服器，提示詞直接送到你選的 AI 網站。 |
| **多語系** | 英文、繁體中文、简体中文，另可放入語言包（[說明](language/README.md)）。 |

---

<!-- demos:start -->
## 實際操作

<table>
<tr>
<td width="33%" valign="top">
<a href="assets/demos/zh-TW/flow-build.webp"><img src="assets/demos/zh-TW/flow-build.webp" alt="以文字描述建立流程" width="100%" /></a>
<br /><b>以文字描述建立流程</b>
<br /><sub>以一句話描述自動化需求，產生可直接執行、也可逐步修改的流程。</sub>
</td>
<td width="33%" valign="top">
<a href="assets/demos/zh-TW/writing.webp"><img src="assets/demos/zh-TW/writing.webp" alt="改寫選取的段落" width="100%" /></a>
<br /><b>改寫選取的段落</b>
<br /><sub>僅改寫回答中選取的段落，修改直接寫回 Markdown。</sub>
</td>
<td width="33%" valign="top">
<a href="assets/demos/zh-TW/telegram.webp"><img src="assets/demos/zh-TW/telegram.webp" alt="透過 Telegram 分析地點評論" width="100%" /></a>
<br /><b>透過 Telegram 分析地點評論</b>
<br /><sub>傳送 Google 地圖連結給 Telegram Bot，由電腦端讀取評論並回傳分析。</sub>
</td>
</tr>
<tr>
<td width="33%" valign="top">
<a href="assets/demos/zh-TW/downloader.webp"><img src="assets/demos/zh-TW/downloader.webp" alt="從貼文連結下載影片" width="100%" /></a>
<br /><b>從貼文連結下載影片</b>
<br /><sub>貼上貼文連結即可下載影片，也可針對貼文內容提問。</sub>
</td>
<td width="33%" valign="top">
<a href="assets/demos/zh-TW/notion.webp"><img src="assets/demos/zh-TW/notion.webp" alt="匯入並編輯 Notion 頁面" width="100%" /></a>
<br /><b>匯入並編輯 Notion 頁面</b>
<br /><sub>匯入 Notion 頁面，以 AI 協助編輯後同步回 Notion。</sub>
</td>
<td width="33%" valign="top">
<a href="assets/demos/zh-TW/line.webp"><img src="assets/demos/zh-TW/line.webp" alt="查詢本機 LINE 對話內容" width="100%" /></a>
<br /><b>查詢本機 LINE 對話內容</b>
<br /><sub>在本機 LINE 對話中搜尋指定內容，並整理成條列結果。</sub>
</td>
</tr>
<tr>
<td width="33%" valign="top">
<a href="assets/demos/zh-TW/rail.webp"><img src="assets/demos/zh-TW/rail.webp" alt="查詢高鐵班次與票價" width="100%" /></a>
<br /><b>查詢高鐵班次與票價</b>
<br /><sub>查詢高鐵與台鐵的班次及票價，資料取自營運單位。</sub>
</td>
</tr>
</table>
<!-- demos:end -->

---

## 流程

一條流程就是一串步驟，前一步的輸出經由 `{{變數}}` 傳給下一步：

```
排程       每天 09:00
    ↓
LINE      → {{chat}}      昨日至今的群組訊息
    ↓
問 AI     → {{summary}}   摘要，並挑出決議與待辦
    ↓
Telegram  送出 {{summary}}
```

也可以直接描述需求，讓 AI 組出整條流程，每一步之後都能改：

> *「每個平日早上 8 點，摘要我的 RSS 並送到 Telegram。」*

內建 28 條範本可以直接改：有的按排程、有的用熱鍵處理選取的文字、有的用聊天或 Bot 指令觸發。

**步驟：**

- **取得資料** — 網頁、RSS、HTTP API、YouTube 文字稿與訂閱頻道新影片、網路搜尋與深度研究、Google 地圖評論、LINE 對話、Telegram 群組、X 貼文／回覆／趨勢、新信件、行事曆、股票、匯率、天氣、空氣品質、農民曆
- **台灣** — PTT 看板、統一發票對獎
- **使用連接器** — 呼叫已加入連接器的任一工具，例如 Notion 或 Jira
- **擷取清單** — 在網頁上點一則標題，Yobi 找出其他項目
- **操作瀏覽器** — 開分頁、點擊、填表單、擷圖
- **詢問 AI** — Gemini、Claude、ChatGPT、Perplexity 或 BYOK
- **送出結果** — Telegram、LINE、Discord、Slack、寄信、檔案、PDF、圖片、分享連結、剪貼簿、通知
- **執行程式** — 程式、JavaScript、shell、系統與電源控制
- **流程控制** — 迴圈、條件、延遲、提前停止、「有變化才通知」

流程是單純的 `.json` 檔。匯出時不含你填的變數值與 Bot 帳號 ID；匯入前會先列出它會取用什麼。

---

## 連接器

**這台電腦上：**

- **LINE**（Windows）— 從執行中的 LINE 電腦版列出聊天室、搜尋訊息、讀取對話。不會送出任何內容，也不會標成已讀。流程用 **LINE 訊息** 步驟。
- **Thunderbird** — 搜尋、閱讀、撰寫、回覆、轉寄、歸檔郵件，以及行事曆、工作與聯絡人。需要 Thunderbird MCP 擴充功能（**設定 → 連接器**有連結）。流程寄信用 **寄送 Email** 步驟。

**信箱。** 在**設定 → 連接器 → 信箱**加入信箱：Gmail、Yahoo、iCloud 用應用程式密碼，Outlook、Hotmail、Microsoft 365 用**用 Microsoft 登入**，其他填 IMAP／SMTP 伺服器。Agent 會一次搜尋全部信箱，可以讀信、存附件、寫草稿、回覆、寄出、整理與丟垃圾桶；寄出與丟垃圾桶每次都會問。流程用 **讀新信** 與 **寄送 Email**。

**台灣。** 台灣的使用者預設開啟，資料都讀自各營運單位的網站：

- **PTT** — 找看板、依推文數或關鍵字列出文章、讀文章與推文。流程用 **PTT 看板** 步驟。
- **台灣鐵路** — 台鐵、高鐵的時刻與票價，以及七個捷運系統的路線規劃、票價、下一班與營運狀態。

**X（推特）。** 搜尋貼文、看趨勢、讀帳號最新貼文與貼文底下的回覆。在**設定 → 連接器**開啟並登入（搜尋與趨勢需要登入）；訊息裡提到 X 或推特，Agent 就會去 X 查。流程用 **X 追蹤**、**X 貼文與回覆**、**X 熱門趨勢**。未登入只看得到每個帳號最新幾則與少數熱門回覆，也沒有趨勢。

**雲端服務。** 連接一次（多數要登入，GitHub 貼 token，查資料類不用設定）：

- **工作** — Notion · Linear · Asana · Atlassian（Jira 與 Confluence）· Airtable · Dropbox · Zapier
- **開發** — GitHub · Sentry · Vercel · Netlify · Supabase · Neon · Cloudflare
- **設計** — Figma · Webflow · Wix
- **商務** — Stripe · Square · PayPal · Intercom
- **查資料** — Context7 · DeepWiki · Microsoft Learn · Cloudflare Docs · Hugging Face

其他支援 MCP 的服務貼上網址即可。全部預設關閉，在**設定 → 連接器**開啟。會寫入的操作都會先問；**永遠允許這個伺服器**只略過修改類的確認，寄送與刪除每次都問。

---

## 觸發方式

| 觸發 | 適用情境 |
| ---- | -------- |
| **排程** | 每個平日早上送來的摘要 |
| **全域熱鍵** | 在任何 App 按下自訂按鍵；流程拿得到選取的文字 |
| **Bot 訊息** | 傳給 Telegram、LINE、Discord 或 Slack Bot 的 `/指令`；可指定哪些已配對帳號能用 |
| **斜線指令** | 在 App 輸入框輸入 `/你的流程` |
| **新檔案** | 指定資料夾裡每存入、下載或搬進一個檔案，寫完就執行一次 |
| **系統事件** | Yobi 啟動、電腦從睡眠喚醒、螢幕鎖定或解鎖（鎖定與解鎖限 Windows 與 macOS） |

---

## 代理

給 `/agent` 一個目標，而不是一段提示詞。它會規劃、搜尋、呼叫工具、檢查結果，也能把做法存成流程（或修改既有流程）之後按排程執行。新流程存檔時是停用的。它動手前會問什麼，見[安全與隱私](#安全與隱私)。

在聊天中，從輸入框下方的模式選單選 **Agent**，或在同一個選單開啟**網頁**或連接器。全部關閉時就是一般對話，存成可重新開啟的 Markdown 檔。需要查資料才答得出的問題（天氣、股價、匯率）仍會交給 Agent，只限那一則。

`Shift+Tab` 切換服務商與模型，`Ctrl+G` 用外部編輯器寫草稿。回答會渲染 Mermaid 與數學式，可匯出 PNG、WebP、PDF；整段對話可做成端對端加密的分享連結。

個人化記憶保存關於你的短句，例如所在城市、偏好的回答方式。AI 記下時會在回答下方顯示，可按**復原**。在**設定 → 個人化記憶**可以新增、編輯、刪除；**整理**會建議合併與刪除，只套用你勾選的項目。

---

## 開始使用

**1. 安裝：**

```bash
brew install --cask wellwells/tap/yobi   # macOS（Intel 與 Apple Silicon）
```

或從 [Microsoft Store](https://apps.microsoft.com/detail/9nnx8prfstc9)（Windows，自動更新）、[GitHub Releases](https://github.com/WellWells/yobi/releases)（Windows 安裝檔、macOS DMG）下載。GitHub 版本未簽章：Windows 請選**其他資訊 → 仍要執行**；macOS 見[發行說明](https://github.com/WellWells/yobi/releases)。

**2. 試一下：**

1. 預設的 Gemini 與 Perplexity 不用帳號。要用 Claude 或 ChatGPT，到**設定 → AI 模型**按旁邊的**登入**。
2. 在任何 App 選取一段文字。
3. 按 **`Alt+G`**（macOS 為 `⌘⌃G`）。答案會複製到剪貼簿，對話存在**聊天**裡。

**`Alt+J`**（macOS 為 `⌘⌃J`）則是框選螢幕的一塊，再對它提問。

接著到**流程 → 範本**。

<details>
<summary><b>從原始碼執行</b>（Node.js 22.12+）</summary>

```bash
git clone https://github.com/WellWells/yobi.git
cd yobi
npm install   # Windows 沒裝 Visual Studio 時：npm install --ignore-scripts
npm run dev
```
</details>

---

## 畫面截圖

| 流程編輯器 | `/agent` |
| :--------: | :------: |
| <img src="assets/screenshots/flow-editor-rss-step.png" width="400" /> | <img src="assets/screenshots/agent-command-result.png" width="400" /> |
| 抓取、AI 摘要，按排程送到 Telegram | 給它目標，它自己挑工具 |

| 聊天 | 模型選擇 |
| :--: | :------: |
| <img src="assets/screenshots/main-chat-interface.png" width="400" /> | <img src="assets/screenshots/model-selection-menu.png" width="400" /> |
| 透過 AI 的網頁對話 | 切換服務商與模型 |

| 對話紀錄 | 匯出 |
| :------: | :--: |
| <img src="assets/screenshots/chat-history-summary-result.png" width="400" /> | <img src="assets/screenshots/export-options-preview.png" width="400" /> |
| 對話存成 Markdown 檔，可重新開啟 | PNG、WebP、PDF，樣式可自訂 |

---

## 用手機操控

接上 Telegram、LINE、Discord 或 Slack Bot，就能從手機用你的 AI 與流程。Telegram 約兩分鐘：

1. 向 [@BotFather](https://t.me/BotFather) 建立 Bot，複製 token。
2. 在**設定 → Bot 整合**開啟**啟用 Telegram Bot**，把 token 貼到 **Bot Token**，按**儲存 Token**。
3. 按**建立配對碼**，對 Bot 傳 `/start <配對碼>`，或按**開啟 Telegram**。

**LINE：** 在 LINE Developers Console 建立 Messaging API channel，把 **Channel access token** 與 **Channel secret** 填進 LINE 卡片，再開一條通道連到 Yobi 的本機 webhook（卡片上有 `cloudflared` 指令）。配對時按**產生配對碼**，把連結傳給對方。

**Discord 與 Slack** 由這台電腦主動連出，不用開通道。Discord 在 Developer Portal 建立應用程式、貼上 bot token；Slack 用卡片上的設定檔建立 App、貼上兩把 token。配對方式與 LINE 相同。

沒配對的人私訊 Bot 就是申請加入，在**設定 → Bot 整合**允許或封鎖；Telegram 與 LINE 也會傳一張有**允許**與**封鎖**的卡片給你。

| 指令 | 功能 |
| ---- | ---- |
| `/gemini` · `/claude` · `/gpt` · `/pplx` | 指定服務商回答；每把自備金鑰與金鑰群組也有自己的指令（名稱可自訂） |
| `/search` | 搜尋網路並附來源（需要**網路搜尋**權限） |
| `/new` | 開新對話（閒置 6 小時也會自動開新的） |
| `/help` | 列出能用的指令（LINE） |
| `/output <模式>` | 設定所有人的回覆格式：`md` · `compact` · `png` · `webp` · `pdf`（Telegram，管理員） |
| `/status` | 查看工作佇列（Telegram，管理員） |
| `/restart` | 重新啟動 Yobi（Telegram，管理員） |
| `/users` · `/invite` · `/groups` | 處理加入申請與權限、發會過期的邀請連結、決定哪些群組能用 Bot（Telegram 管理員；LINE 只有你本人） |

直接傳訊息會交給 Bot 的**預設模型**，要不要查資料、用工具由 AI 判斷。配對只能聊天與用模型指令；其他權限逐一帳號開：**Agent**、**網路搜尋**、**讀取這台電腦**、**執行指令**（每個指令都要你同意才執行）、連接器、**管理員**（僅 Telegram）。

你和管理員也能在私訊請 Bot 建立或修改流程，例如「每 10 分鐘檢查省錢版，推文超過 20 的通知我」。存檔前 Bot 會先問你。會操作電腦的流程，以及管理員建立、會讀你的資料或代替你動作（存檔、寄信、在你登入的瀏覽器開網頁）的流程，會存成停用，等你在電腦上確認。

流程的 **Bot** 觸發器可以加你自己的指令（例如 `/my_cmd`），每個平台都能用。指令後的文字會帶進流程，可開放給**所有已配對的人**或**指定的人**。

---

## 設定

AI 模型 · AI 回應 · 個人化記憶 · 連接器 · Bot 整合 · 一般 · 外觀 · 通知 · 連結與下載 · 匯出 · 鍵盤快速鍵 · 統計 · 備份與還原。

**BYOK：** 在**AI 模型 → 自備金鑰（API）**按**新增金鑰**，選服務商（OpenAI、Anthropic、Google Gemini、OpenRouter、DeepSeek 等），其他端點（包括本機伺服器）選 **OpenAI-compatible**。金鑰會出現在聊天的模型選單、流程的 AI 步驟，也會變成一個 Bot 指令。**金鑰群組（輪詢）**讓多把金鑰輪流用，某把失敗就換下一把。

**備份與還原**把設定（含金鑰與密碼）、流程、對話與記憶打包成一個 .zip，還原時可挑項目。金鑰與密碼只能在原本那台裝置還原。

---

## Yobi 怎麼運作

預設每個 AI 請求都走服務商的**網頁**：Yobi 在內建瀏覽器視窗把提示詞輸入 Gemini、Claude、ChatGPT 或 Perplexity，再從頁面讀回答案。Gemini 與 Perplexity 不登入也能用；Claude 與 ChatGPT 要在那個視窗登入一次。不用官方 API、也不用本機模型，所以不需要金鑰也不收費。（選用 BYOK 金鑰時，改為直接呼叫該服務商的 API。）

用網頁而非官方 API 不在服務商條款允許的範圍內。Yobi 的做法：

- 瀏覽器視窗以一般瀏覽器的身分出現，不是 Electron。Windows 上，Google 的網站看到的是 Google 官方的 Gemini Windows App，其他網站看到 Chrome；macOS 上 Gemini 看到的是 Firefox。
- 未登入 Perplexity 時，每個新對話前（以及每 30 分鐘）清除 perplexity.ai 的 cookie 與網站資料。若仍被要求註冊，會以新訪客再試一次。
- 不解 CAPTCHA、不換 IP。Claude 或 Perplexity 跳出 Cloudflare 驗證時，停下這次請求並打開視窗讓你完成驗證。DuckDuckGo 要求驗證時暫停搜尋 3 分鐘。Claude 用量到上限時，告訴你幾點可以再用。

請合理使用：不做違法的事，不做大規模或濫用的自動化。個人輕度使用通常只會偶爾遇到驗證。服務商條款可能變動，請自行確認。本文不構成法律建議。

---

## 安全與隱私

- **提示詞**送到你選的 AI：它的網頁，或你的 BYOK 端點。聊天與 Agent 會一併送出個人化記憶與回答偏好，適用該服務商的隱私權政策。
- **沒有伺服器、沒有遙測。** Yobi 沒有帳號、沒有分析追蹤。對話、流程、記憶與匯出檔都是你硬碟上的普通檔案。
- **其他會離開電腦的資料。** 網路搜尋送到 DuckDuckGo，搜到的網頁直接讀取。聊天中除非關掉**網頁**，Agent 可能自己搜尋；流程只在**網路搜尋**與**深度研究**步驟搜尋。分享連結在 App 內加密後才上傳到 PrivateBin（預設 privatebin.net，可改成自己的），金鑰在連結的 `#fragment`，瀏覽器不會送出。連接器只連到你加入的服務；PTT 與台灣鐵路只讀公開網頁。Yobi 啟動時會向 GitHub 檢查新版本（Store 版不會）。
- **Agent 動手前會問。** 讀取不用確認。shell 指令、儲存或修改流程、會變更資料的連接器工具都要你確認；寄出與刪除每次都問，選了**永遠允許這個伺服器**也一樣。它只讀 Yobi 輸出資料夾、文件、下載與桌面，只寫入輸出資料夾。形似金鑰或 token 的內容送入模型前會遮罩。
- **Bot 只有你給的權限。** 在**設定 → Bot 整合**逐一帳號授權；標為**本人**的帳號擁有執行指令與管理員以外的所有權限。檔案、指令與連接器只在私訊可用，從 Bot 變更連接器資料只能在你自己的私訊、確認後才執行。
- **憑證加密。** Bot token、信箱密碼與 Microsoft 登入、API 金鑰、連接器登入與 LINE 資料庫金鑰，都以作業系統的金鑰儲存區（Electron `safeStorage`）加密。

---

## 延伸閱讀

- [Yobi：用內建瀏覽器操作網頁版 AI 的自動化工具，打造專屬 Agent](https://wellstsai.com/post/yobi-free-ai-automation/) — 功能與安裝
- [用 Telegram Bot 自動收 RSS 摘要：不用 API Key 的完整教學](https://wellstsai.com/post/telegram-bot-rss-ai-digest/) — 一條流程從頭做到尾
- [免費 LLM API 金鑰申請教學：Gemini、OpenRouter 額度實測](https://wellstsai.com/post/free-ai-api-key/) — 想用 BYOK 看這篇

---

## 開發

```bash
npm run dev         # 開發模式；改了主程序後按 Enter 重啟 Electron
npm run typecheck   # TypeScript 型別檢查
npm run i18n:check  # 比對 language/*.json 與原始碼；會刪掉沒用到的 key
npm run build:win   # Windows（NSIS 安裝檔）
npm run build:mac   # macOS（DMG）
```

**技術堆疊：** Electron · React + TypeScript · Mantine · Zustand · Vite + electron-builder · grammY · LINE Bot SDK · MCP SDK

---

## 參與貢獻

歡迎 issue 與 PR，送出前確認 `npm run typecheck` 通過。使用者看得到的文字放在 `language/*.json`，en-US、zh-TW、zh-CN 都要補；新增語言見 [language/README.md](language/README.md)。較大的改動請先開 issue。

---

## 授權

[MIT](LICENSE)

---

<div align="center">

如果 Yobi 幫你省下時間，請給個 ⭐ **Star**，能讓更多人找到它！

**[回報問題](https://github.com/WellWells/yobi/issues) · [功能建議](https://github.com/WellWells/yobi/issues) · [討論區](https://github.com/WellWells/yobi/discussions)**

</div>
