# Yobi AI — Privacy Policy

_Last updated: 9 October 2026_

Yobi AI ("Yobi", "the app") is a desktop application published by wellstsai.com. This policy explains what data the app handles and where it goes.

## The short version

Yobi has no backend. We operate no servers, require no account, and collect no data — no analytics, no telemetry, no crash reporting. The app runs on your device and talks directly to the services you choose; nothing is relayed through us. Apart from the checks described under "Checks Yobi makes on its own", everything that leaves your device is something you send or turn on yourself.

## Data the app handles

- **Text you send to AI services.** When you use a hotkey, the chat, a bot message, or a flow step, the text you selected or typed is sent directly from your device to the AI web service you chose (Google Gemini, Anthropic Claude, OpenAI ChatGPT, or Perplexity), through that service's own web page in a browser session kept on your device (signed in with your own account where the service needs it). When you use Perplexity signed out, Yobi clears Perplexity's cookies and site data before each new conversation and every 30 minutes. The developer never sees this data. Each service processes it under its own terms and privacy policy.
- **AI replies and workflow outputs.** These are stored as files on your device (in your local app data folder). You can delete them at any time.
- **Personal memory.** On by default; switch off **Remember things about me** in Settings → Personal memory to stop it. In the chat, `/agent`, and private chats with bot accounts you marked as **Me**, the AI may save short facts about you — things like your city or what you are working on — on its own or when you ask, and the reply shows a line when it does. Entries are stored locally on your device and added to the prompts you send from those places, so they reach the AI service you chose in the same way the rest of your text does. A flow LLM step reads them only if you tick **Include personal memory** on that step, and never writes. You can read, edit, or delete every entry on the same page. Hotkeys, group chats, and temporary conversations never read or write it.
- **Web search.** The app sends search queries to DuckDuckGo from your device, and fetches the pages it finds, only when web search is in use: you turn on **Web** in the chat, your message asks to search the web, or the Agent decides to look something up (not in a conversation where you switched **Web** off). Bot accounts need the **Web search** permission.
- **Settings.** Stored locally on your device. Sensitive values — your Telegram bot token, LINE channel secret and access token, SMTP passwords, Bring-Your-Own-Key API keys, connector (MCP) authorizations and data source keys, if you configure them — are encrypted at rest using the operating system's credential protection (Windows DPAPI / macOS Keychain).
- **Optional Telegram and LINE integrations.** If you connect your own Telegram or LINE bot, messages and results flow between your device and that platform's API using your own token. Pairing only lets an account chat with the AI. Everything else — web search, reading this computer (files, clipboard, system info), connectors, running commands — is a permission you grant per account in Settings → Bot Integrations; reading this computer, connectors and commands work in private chats only. Each command is shown in the chat and runs only after it is approved there, and a bot can never change data in a connector. Off by default.
- **Optional email (SMTP) step.** If you configure an SMTP account, emails are sent directly from your device through that account. Off by default.
- **Optional Bring Your Own Key (BYOK).** If you add your own API key (OpenAI, Anthropic, Google Gemini, OpenRouter and others, or any OpenAI-compatible endpoint), prompts you send to that key go directly from your device to that endpoint, over HTTPS (or HTTP for a server on your own network). Used only when you pick one of your keys.
- **Optional share links.** If you create a share link for a conversation, the app encrypts that conversation on your device (AES-256-GCM, key derived with PBKDF2-SHA256) and uploads only the ciphertext to a PrivateBin host — `privatebin.net` by default, changeable to any instance you prefer. The decryption key is placed in the link's `#fragment`, which browsers never send to the server, so the host cannot read the content; anyone you give the full link to can. Links expire (one week by default) and can be set to burn after reading. Off until you create a link, and the app asks for your consent the first time.
- **Optional MCP servers.** If you add a remote Model Context Protocol server, the agent can call its tools — the request content it sends goes from your device to that server over HTTPS, using credentials you supply (stored encrypted, as above). You choose which servers to add, and any tool call that writes asks you to confirm first, unless you chose **Always allow this server** for it (deleting and sending still ask every time). Off by default; no servers are preconfigured.
- **Optional built-in connectors.** **LINE (this PC)** and **Thunderbird (this PC)** read data that is already on your device and upload nothing on their own. LINE (this PC) reads your LINE desktop chat database locally (Windows only, LINE must be running); the database key stays on this PC under OS encryption and is deleted when you switch the connector off. Thunderbird (this PC) talks to a Thunderbird add-on running on the same machine to search and organize your mail. **X (Twitter)** reads posts, replies and trends from x.com, from your device; if you sign in to X in Settings → Connectors it reads as that account, and the sign-in stays in a browser session on this PC (the X flow steps use the same sign-in). All three are off by default. What you then ask the AI to do with that content — summarize it, for instance — sends the relevant excerpt to the AI service you chose, like any other prompt.
- **Optional agent access to your files and shell.** If you ask the agent to read files or run commands, it does so on your device. It can read only Yobi's output folder and your Documents, Downloads and Desktop folders, and write only to Yobi's output folder (writes there are not confirmed). A shell command, sending mail, and an MCP tool that writes ask you to confirm first. Text that looks like a key or token is masked before it is included in a prompt.
- **Checks Yobi makes on its own.** Except in the Microsoft Store version, Yobi asks GitHub whether a newer version exists each time it starts; it downloads nothing by itself. About every 12 hours it also opens the Gemini, Claude and ChatGPT pages in its hidden browser window to re-read their model lists, so the model menus stay current; it skips providers you hid or aren't signed in to.
- **Data that flow steps and the agent look up.** Weather comes from Open-Meteo; air quality comes from Open-Meteo, or for places in Taiwan from Taiwan's Ministry of Environment if you add its API key. Exchange rates come from open.er-api.com, stock quotes from Yahoo Finance, and your public IP address, only when asked, from Cloudflare, ipify or Amazon. RSS feeds, web pages, YouTube and Google Maps are read from those sites. These requests carry what you asked about (a city, a symbol, an address), not your conversation.

## What we do NOT do

- No developer-operated servers; the app never relays your content through us.
- No accounts, no registration.
- No analytics, tracking, or telemetry of any kind.
- No ads.
- No sale or sharing of data — we never possess it in the first place.

## Third-party services

Your use of each outside service Yobi contacts for you is governed by that service's own terms and privacy policy: the AI services (Google, Anthropic, OpenAI, Perplexity), any API endpoint you add your own key for, DuckDuckGo, X, the data sources above, Telegram, LINE, your email provider, the PrivateBin host you publish a share link to, any MCP server you add, and GitHub for the update check. Yobi acts only as an automation layer on your device.

## Updates to this policy

Changes will be published at this URL with an updated date.

## Contact

Questions or issues: https://github.com/WellWells/yobi/issues

---

# Yobi AI — 隱私權政策（中文版）

_最後更新：2026 年 10 月 9 日_

Yobi AI（下稱「Yobi」、「本 App」）是由 wellstsai.com 發行的桌面應用程式。本政策說明 App 處理哪些資料、資料流向何處。

## 摘要

Yobi 沒有後端。我們不營運任何伺服器、不要求帳號、不收集任何資料——沒有分析、沒有遙測、沒有錯誤回報上傳。App 在你的裝置上執行，直接與你選擇的服務往來，內容不經由我們轉送。除了下方「Yobi 自己發出的檢查」所列的項目，所有會離開你裝置的資料，都是你自己送出或開啟的功能。

## App 處理的資料

- **你送給 AI 服務的文字**：使用熱鍵、聊天、Bot 訊息或流程步驟時，你選取或輸入的文字會從你的裝置直接送往你選擇的 AI 網頁服務（Google Gemini、Anthropic Claude、OpenAI ChatGPT、Perplexity），透過該服務自己的網頁，使用存在你裝置上的瀏覽器工作階段（需要登入的服務用你自己的帳號）。未登入使用 Perplexity 時，Yobi 會在每個新對話前與每 30 分鐘清除 Perplexity 的 cookie 與網站資料。開發者完全接觸不到這些內容；各服務依其條款與隱私權政策處理。
- **AI 回覆與流程輸出**：以檔案形式存在你裝置的本機資料夾，可隨時刪除。
- **個人化記憶**：預設開啟，可在「設定 → 個人化記憶」關閉「記住關於我的事」。在聊天、`/agent`，以及你標為「本人」的 Bot 帳號私訊中，AI 可能主動或依你的要求記下關於你的短句（例如你在哪個城市、正在忙什麼），記下時回答會附上一行提示。這些條目存在你的本機裝置，並在你從上述地方送出提示時一併帶上，因此會和你其餘的文字一樣抵達你選擇的 AI 服務。流程的 LLM 步驟只有勾選「帶入個人化記憶」時才會讀取，而且不會寫入。所有條目都可在同一頁查看、編輯或刪除。熱鍵、群組對話與臨時對話一律不讀也不寫。
- **網路搜尋**：只有在用到網路搜尋時，App 才會從你的裝置把查詢字串送往 DuckDuckGo，並抓取找到的頁面：你在聊天中開啟「**網頁**」、訊息明講要上網查，或 Agent 判斷需要查資料時（你在該對話關掉「網頁」就不會）。Bot 帳號需要「網路搜尋」權限。
- **設定**：存於本機。敏感值（Telegram Bot Token、LINE Channel Secret 與 Channel Access Token、SMTP 密碼、BYOK API 金鑰、連接器（MCP）授權與資料來源金鑰，凡你有設定的）以作業系統的憑證保護機制（Windows DPAPI／macOS Keychain）加密存放。
- **選用的 Telegram 與 LINE 整合**：若連接自己的 Telegram 或 LINE Bot，訊息與結果經由你自己的 token 在你的裝置與該平台 API 之間傳輸。配對只讓對方能和 AI 對話；其他能力——網路搜尋、讀取這台電腦（檔案、剪貼簿、系統資訊）、連接器、執行指令——都要你在「設定 → Bot 整合」逐個帳號授予，其中讀取這台電腦、連接器與執行指令只限私訊。每個指令都會先顯示在聊天中，經同意後才執行；Bot 一律不能改動連接器裡的資料。預設關閉。
- **選用的 Email（SMTP）步驟**：若設定 SMTP 帳號，郵件由你的裝置直接經該帳號寄出。預設關閉。
- **選用的 BYOK（自帶金鑰）**：若你加入自己的 API 金鑰（OpenAI、Anthropic、Google Gemini、OpenRouter 等，或任何 OpenAI 相容端點），送往該金鑰的提示會從你的裝置直接送到該端點（HTTPS，或你自己網路上的伺服器用 HTTP）。只有你選用自己的金鑰時才會使用。
- **選用的分享連結**：若你為某段對話建立分享連結，App 會在你的裝置上先加密該對話（AES-256-GCM，金鑰以 PBKDF2-SHA256 導出），只把密文上傳到 PrivateBin 主機——預設為 `privatebin.net`，可自行改成任何你偏好的站台。解密金鑰放在連結的 `#fragment`，瀏覽器不會把它送到伺服器，因此主機無法讀取內容；但拿到完整連結的人可以。連結會過期（預設一週），也可設定為閱後即焚。未建立連結前不啟用，且首次使用時會先徵詢你的同意。
- **選用的 MCP 伺服器**：若你加入遠端 Model Context Protocol 伺服器，代理可呼叫其工具——送出的請求內容會從你的裝置經 HTTPS 傳到該伺服器，使用你自行提供的憑證（比照上述加密存放）。要加入哪些伺服器由你決定，且任何會寫入的工具呼叫都會先請你確認，除非你對該伺服器選了「永遠允許這個伺服器」（刪除與寄出仍每次確認）。預設關閉，不預先設定任何伺服器。
- **選用的內建連接器**：**LINE（本機）**與 **Thunderbird（本機）**讀取的是你裝置上既有的資料，本身不會上傳任何內容。LINE（本機）在本機讀取你的 LINE 電腦版對話資料庫（僅限 Windows，且 LINE 需在執行中）；資料庫金鑰以作業系統加密機制保存在這台電腦，關閉該連接器時即刪除。Thunderbird（本機）與同一台電腦上執行的 Thunderbird 擴充套件溝通，用來搜尋與整理你的信件。**X（推特）**從你的裝置讀取 x.com 上的貼文、回覆與熱門趨勢；若你在「設定 → 連接器」登入 X，就以該帳號讀取，登入狀態只存在這台電腦的瀏覽器工作階段（流程的 X 步驟也用這個登入）。三者皆預設關閉。至於你接下來請 AI 對這些內容做什麼（例如摘要），則會和其他提示一樣，把相關片段送往你選擇的 AI 服務。
- **選用的代理檔案與 shell 存取**：若你要求代理讀取檔案或執行指令，這些動作都在你的裝置上進行。代理只能讀取 Yobi 的輸出資料夾與你的「文件」「下載」「桌面」資料夾，也只能寫入 Yobi 的輸出資料夾（寫入那裡不另外確認）。執行 shell 指令、寄信、會寫入的 MCP 工具，都會先請你確認。看起來像金鑰或 token 的文字，在放進提示之前就會被遮罩。
- **Yobi 自己發出的檢查**：除了 Microsoft Store 版，Yobi 每次啟動都會向 GitHub 詢問是否有新版本，不會自行下載任何東西。另外約每 12 小時，Yobi 會在隱藏的瀏覽器視窗開啟 Gemini、Claude、ChatGPT 的頁面，重新讀取模型清單，讓模型選單保持最新；你隱藏或未登入的服務會略過。
- **流程步驟與代理查詢的資料**：天氣來自 Open-Meteo；空氣品質來自 Open-Meteo，地點在台灣且你填了環境部的 API 金鑰時改用環境部資料。匯率來自 open.er-api.com，股價來自 Yahoo Finance，你的對外 IP（只在被問到時）向 Cloudflare、ipify 或 Amazon 查詢。RSS、網頁、YouTube 與 Google 地圖則直接向那些網站讀取。這些請求只帶你要查的東西（城市、代號、網址），不帶你的對話內容。

## 我們不做的事

- 沒有開發者營運的伺服器；內容永遠不經過我們。
- 不需帳號、不需註冊。
- 沒有任何形式的分析、追蹤、遙測。
- 沒有廣告。
- 不出售、不分享資料——我們從一開始就不持有。

## 第三方服務

Yobi 替你連線的每個外部服務，你的使用都受該服務自身的條款與隱私權政策約束：AI 服務（Google、Anthropic、OpenAI、Perplexity）、你加入自己金鑰的 API 端點、DuckDuckGo、X、上述資料來源、Telegram、LINE、你的郵件供應商、你發布分享連結所使用的 PrivateBin 主機、你自行加入的 MCP 伺服器，以及更新檢查用的 GitHub。Yobi 僅是在你裝置上運作的自動化層。

## 政策更新

變更將於本網址發布並更新日期。

## 聯絡方式

問題回報：https://github.com/WellWells/yobi/issues
