# Yobi AI — Privacy Policy

_Last updated: 20 September 2026_

Yobi AI ("Yobi", "the app") is a desktop application published by wellstsai.com. This policy explains what data the app handles and where it goes.

## The short version

Yobi has no backend. We operate no servers, require no account, and collect no data — no analytics, no telemetry, no crash reporting. The app runs on your device and talks directly to the services you choose; nothing is relayed through us. Everything below that leaves your device is a feature you turn on yourself.

## Data the app handles

- **Text you send to AI services.** When you use a hotkey, the chat, or a flow step, the text you selected or typed is sent directly from your device to the AI web service you chose (Google Gemini, OpenAI ChatGPT, Anthropic Claude, or Perplexity), using that service's own web interface and your own session. The developer never sees this data. Each service processes it under its own terms and privacy policy.
- **AI replies and workflow outputs.** These are stored as files on your device (in your local app data folder). You can delete them at any time.
- **Optional personal memory.** If you use it, short facts you approve — things like your city or what you are working on — are stored locally on your device and added to the prompts you send, so they reach the AI service you chose in the same way the rest of your text does. Nothing is written without your approval, and you can read, edit, or delete every entry in Settings → Personal memory. You also choose which surfaces may write to it; hotkeys, group chats, and temporary conversations never do.
- **Optional web search.** While the **Web** capability is on, the app sends your search queries to DuckDuckGo from your device and fetches the pages it finds. It is off by default.
- **Settings.** Stored locally on your device. Sensitive values — your Telegram bot token, SMTP password, and any Bring-Your-Own-Key API keys, if you configure them — are encrypted at rest using the operating system's credential protection (Windows DPAPI / macOS Keychain).
- **Optional Telegram and LINE integrations.** If you connect your own Telegram or LINE bot, messages and results flow between your device and that platform's API using your own token. These features are off by default.
- **Optional email (SMTP) step.** If you configure an SMTP account, emails are sent directly from your device through that account. Off by default.
- **Optional Bring Your Own Key (BYOK).** If you add your own API key for an OpenAI-compatible endpoint or the Gemini API, prompts you send to that instance go directly from your device to that endpoint over HTTPS. Off unless you select a BYOK instance.
- **Optional share links.** If you create a share link for a conversation, the app encrypts that conversation on your device (AES-256-GCM, key derived with PBKDF2-SHA256) and uploads only the ciphertext to a PrivateBin host — `privatebin.net` by default, changeable to any instance you prefer. The decryption key is placed in the link's `#fragment`, which browsers never send to the server, so the host cannot read the content; anyone you give the full link to can. Links expire (one week by default) and can be set to burn after reading. Off until you create a link, and the app asks for your consent the first time.
- **Optional MCP servers.** If you add a remote Model Context Protocol server, the agent can call its tools — the request content it sends goes from your device to that server over HTTPS, using credentials you supply (stored encrypted, as above). You choose which servers to add, and any tool call that writes asks you to confirm first. Off by default; no servers are preconfigured.
- **Optional built-in connectors.** Two connectors read data that is already on your device, and neither uploads anything on its own. **LINE (this PC)** reads your LINE desktop chat database locally (Windows only, LINE must be running); the database key stays on this PC under OS encryption and is deleted when you switch the connector off. **Thunderbird (this PC)** talks to a Thunderbird add-on running on the same machine to search and organize your mail. Both are off by default. What you then ask the AI to do with that content — summarize it, for instance — sends the relevant excerpt to the AI service you chose, like any other prompt.
- **Optional agent access to your files and shell.** If you ask the agent to read files or run commands, it does so on your device. File access is limited to folders you allow, writing is narrower than reading, and any action that changes something — a shell command, a file write, sending mail, an MCP tool that writes — asks you to confirm first. Text that looks like a key or token is masked before it is included in a prompt.

## What we do NOT do

- No developer-operated servers; the app never relays your content through us.
- No accounts, no registration.
- No analytics, tracking, or telemetry of any kind.
- No ads.
- No sale or sharing of data — we never possess it in the first place.

## Third-party services

When Yobi automates an AI web service, your use of that service is governed by its own terms and privacy policy (Google, OpenAI, Anthropic, Perplexity, DuckDuckGo, Telegram, LINE, or your email provider). The same applies to any PrivateBin host you publish a share link to and any MCP server you add. Yobi acts only as an automation layer on your device.

## Updates to this policy

Changes will be published at this URL with an updated date.

## Contact

Questions or issues: https://github.com/WellWells/yobi/issues

---

# Yobi AI — 隱私權政策（中文版）

_最後更新：2026 年 9 月 20 日_

Yobi AI（下稱「Yobi」、「本 App」）是由 wellstsai.com 發行的桌面應用程式。本政策說明 App 處理哪些資料、資料流向何處。

## 摘要

Yobi 沒有後端。我們不營運任何伺服器、不要求帳號、不收集任何資料——沒有分析、沒有遙測、沒有錯誤回報上傳。App 在你的裝置上執行，直接與你選擇的服務往來，內容不經由我們轉送。以下所有會離開你裝置的行為，都是你自己開啟的功能。

## App 處理的資料

- **你送給 AI 服務的文字**：使用熱鍵、聊天或流程步驟時，文字會從你的裝置直接送往你選擇的 AI 網頁服務（Google Gemini、OpenAI ChatGPT、Anthropic Claude、Perplexity），使用該服務自己的網頁介面與你自己的登入工作階段。開發者完全接觸不到這些內容；各服務依其條款與隱私權政策處理。
- **AI 回覆與流程輸出**：以檔案形式存在你裝置的本機資料夾，可隨時刪除。
- **選用的個人化記憶**：若你使用此功能，經你確認過的短句（例如你在哪個城市、正在忙什麼）會存在你的本機裝置，並在你送出提示時一併帶上，因此會和你其餘的文字一樣抵達你選擇的 AI 服務。未經你確認不會寫入任何內容；所有條目都可在「設定 → 個人化記憶」中查看、編輯或刪除。可寫入的來源也由你勾選，熱鍵、群組對話與臨時對話一律不會寫入。
- **選用的網路搜尋**：當「**網頁**」能力開啟時，App 會從你的裝置把查詢字串送往 DuckDuckGo，並抓取找到的頁面。預設關閉。
- **設定**：存於本機。敏感值（Telegram Bot Token、SMTP 密碼，以及你自行設定的 BYOK API 金鑰）以作業系統的憑證保護機制（Windows DPAPI／macOS Keychain）加密存放。
- **選用的 Telegram 與 LINE 整合**：若連接自己的 Telegram 或 LINE Bot，訊息與結果經由你自己的 token 在你的裝置與該平台 API 之間傳輸。預設關閉。
- **選用的 Email（SMTP）步驟**：若設定 SMTP 帳號，郵件由你的裝置直接經該帳號寄出。預設關閉。
- **選用的 BYOK（自帶金鑰）**：若你為 OpenAI 相容端點或 Gemini API 加入自己的金鑰，送往該實例的提示會從你的裝置直接以 HTTPS 送到該端點。除非你選用 BYOK 實例，否則不啟用。
- **選用的分享連結**：若你為某段對話建立分享連結，App 會在你的裝置上先加密該對話（AES-256-GCM，金鑰以 PBKDF2-SHA256 導出），只把密文上傳到 PrivateBin 主機——預設為 `privatebin.net`，可自行改成任何你偏好的站台。解密金鑰放在連結的 `#fragment`，瀏覽器不會把它送到伺服器，因此主機無法讀取內容；但拿到完整連結的人可以。連結會過期（預設一週），也可設定為閱後即焚。未建立連結前不啟用，且首次使用時會先徵詢你的同意。
- **選用的 MCP 伺服器**：若你加入遠端 Model Context Protocol 伺服器，代理可呼叫其工具——送出的請求內容會從你的裝置經 HTTPS 傳到該伺服器，使用你自行提供的憑證（比照上述加密存放）。要加入哪些伺服器由你決定，且任何會寫入的工具呼叫都會先請你確認。預設關閉，不預先設定任何伺服器。
- **選用的內建連接器**：有兩個連接器讀取的是你裝置上既有的資料，兩者本身都不會上傳任何內容。**LINE（本機）**在本機讀取你的 LINE 電腦版對話資料庫（僅限 Windows，且 LINE 需在執行中）；資料庫金鑰以作業系統加密機制保存在這台電腦，關閉該連接器時即刪除。**Thunderbird（本機）**與同一台電腦上執行的 Thunderbird 擴充套件溝通，用來搜尋與整理你的信件。兩者皆預設關閉。至於你接下來請 AI 對這些內容做什麼（例如摘要），則會和其他提示一樣，把相關片段送往你選擇的 AI 服務。
- **選用的代理檔案與 shell 存取**：若你要求代理讀取檔案或執行指令，這些動作都在你的裝置上進行。檔案存取限制在你允許的資料夾內，可寫入的範圍比可讀取的更窄；任何會改動東西的動作——執行 shell 指令、寫檔、寄信、會寫入的 MCP 工具——都會先請你確認。看起來像金鑰或 token 的文字，在放進提示之前就會被遮罩。

## 我們不做的事

- 沒有開發者營運的伺服器；內容永遠不經過我們。
- 不需帳號、不需註冊。
- 沒有任何形式的分析、追蹤、遙測。
- 沒有廣告。
- 不出售、不分享資料——我們從一開始就不持有。

## 第三方服務

Yobi 自動操作 AI 網頁服務時，你對該服務的使用受其自身條款與隱私權政策約束（Google、OpenAI、Anthropic、Perplexity、DuckDuckGo、Telegram、LINE 或你的郵件供應商）。你發布分享連結所使用的 PrivateBin 主機、以及你自行加入的任何 MCP 伺服器，亦同。Yobi 僅是在你裝置上運作的自動化層。

## 政策更新

變更將於本網址發布並更新日期。

## 聯絡方式

問題回報：https://github.com/WellWells/yobi/issues
