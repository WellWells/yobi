# Yobi AI — Privacy Policy

_Last updated: 6 August 2026_

Yobi AI ("Yobi", "the app") is a desktop application published by wellstsai.com. This policy explains what data the app handles and where it goes.

## The short version

Yobi has no backend. We operate no servers, require no account, and collect no data — no analytics, no telemetry, no crash reporting. The app runs on your device and talks directly to the services you choose; nothing is relayed through us. Everything below that leaves your device is a feature you turn on yourself.

## Data the app handles

- **Text you send to AI services.** When you use a hotkey, the chat, or a flow step, the text you selected or typed is sent directly from your device to the AI web service you chose (Google Gemini, OpenAI ChatGPT, Perplexity, or Duck.ai), using that service's own web interface and your own session. The developer never sees this data. Each service processes it under its own terms and privacy policy.
- **AI replies and workflow outputs.** These are stored as files on your device (in your local app data folder). You can delete them at any time.
- **Settings.** Stored locally on your device. Sensitive values — your Telegram bot token, SMTP password, and any Bring-Your-Own-Key API keys, if you configure them — are encrypted at rest using the operating system's credential protection (Windows DPAPI / macOS Keychain).
- **Optional Telegram and LINE integrations.** If you connect your own Telegram or LINE bot, messages and results flow between your device and that platform's API using your own token. These features are off by default.
- **Optional email (SMTP) step.** If you configure an SMTP account, emails are sent directly from your device through that account. Off by default.
- **Optional Bring Your Own Key (BYOK).** If you add your own API key for an OpenAI-compatible endpoint or the Gemini API, prompts you send to that instance go directly from your device to that endpoint over HTTPS. Off unless you select a BYOK instance.
- **Optional share links.** If you create a share link for a conversation, the app encrypts that conversation on your device (AES-256-GCM, key derived with PBKDF2-SHA256) and uploads only the ciphertext to a PrivateBin host — `privatebin.net` by default, changeable to any instance you prefer. The decryption key is placed in the link's `#fragment`, which browsers never send to the server, so the host cannot read the content; anyone you give the full link to can. Links expire (one week by default) and can be set to burn after reading. Off until you create a link, and the app asks for your consent the first time.
- **Optional MCP servers.** If you add a remote Model Context Protocol server, the agent can call its tools — the request content it sends goes from your device to that server over HTTPS, using credentials you supply (stored encrypted, as above). You choose which servers to add, and any tool call that writes asks you to confirm first. Off by default; no servers are preconfigured.

## What we do NOT do

- No developer-operated servers; the app never relays your content through us.
- No accounts, no registration.
- No analytics, tracking, or telemetry of any kind.
- No ads.
- No sale or sharing of data — we never possess it in the first place.

## Third-party services

When Yobi automates an AI web service, your use of that service is governed by its own terms and privacy policy (Google, OpenAI, Perplexity, DuckDuckGo, Telegram, LINE, or your email provider). The same applies to any PrivateBin host you publish a share link to and any MCP server you add. Yobi acts only as an automation layer on your device.

## Updates to this policy

Changes will be published at this URL with an updated date.

## Contact

Questions or issues: https://github.com/WellWells/yobi/issues

---

# Yobi AI — 隱私權政策（中文版）

_最後更新：2026 年 8 月 6 日_

Yobi AI（下稱「Yobi」、「本 App」）是由 wellstsai.com 發行的桌面應用程式。本政策說明 App 處理哪些資料、資料流向何處。

## 摘要

Yobi 沒有後端。我們不營運任何伺服器、不要求帳號、不收集任何資料——沒有分析、沒有遙測、沒有錯誤回報上傳。App 在你的裝置上執行，直接與你選擇的服務往來，內容不經由我們轉送。以下所有會離開你裝置的行為，都是你自己開啟的功能。

## App 處理的資料

- **你送給 AI 服務的文字**：使用熱鍵、聊天或流程步驟時，文字會從你的裝置直接送往你選擇的 AI 網頁服務（Google Gemini、OpenAI ChatGPT、Perplexity、Duck.ai），使用該服務自己的網頁介面與你自己的登入工作階段。開發者完全接觸不到這些內容；各服務依其條款與隱私權政策處理。
- **AI 回覆與流程輸出**：以檔案形式存在你裝置的本機資料夾，可隨時刪除。
- **設定**：存於本機。敏感值（Telegram Bot Token、SMTP 密碼，以及你自行設定的 BYOK API 金鑰）以作業系統的憑證保護機制（Windows DPAPI／macOS Keychain）加密存放。
- **選用的 Telegram 與 LINE 整合**：若連接自己的 Telegram 或 LINE Bot，訊息與結果經由你自己的 token 在你的裝置與該平台 API 之間傳輸。預設關閉。
- **選用的 Email（SMTP）步驟**：若設定 SMTP 帳號，郵件由你的裝置直接經該帳號寄出。預設關閉。
- **選用的 BYOK（自帶金鑰）**：若你為 OpenAI 相容端點或 Gemini API 加入自己的金鑰，送往該實例的提示會從你的裝置直接以 HTTPS 送到該端點。除非你選用 BYOK 實例，否則不啟用。
- **選用的分享連結**：若你為某段對話建立分享連結，App 會在你的裝置上先加密該對話（AES-256-GCM，金鑰以 PBKDF2-SHA256 導出），只把密文上傳到 PrivateBin 主機——預設為 `privatebin.net`，可自行改成任何你偏好的站台。解密金鑰放在連結的 `#fragment`，瀏覽器不會把它送到伺服器，因此主機無法讀取內容；但拿到完整連結的人可以。連結會過期（預設一週），也可設定為閱後即焚。未建立連結前不啟用，且首次使用時會先徵詢你的同意。
- **選用的 MCP 伺服器**：若你加入遠端 Model Context Protocol 伺服器，代理可呼叫其工具——送出的請求內容會從你的裝置經 HTTPS 傳到該伺服器，使用你自行提供的憑證（比照上述加密存放）。要加入哪些伺服器由你決定，且任何會寫入的工具呼叫都會先請你確認。預設關閉，不預先設定任何伺服器。

## 我們不做的事

- 沒有開發者營運的伺服器；內容永遠不經過我們。
- 不需帳號、不需註冊。
- 沒有任何形式的分析、追蹤、遙測。
- 沒有廣告。
- 不出售、不分享資料——我們從一開始就不持有。

## 第三方服務

Yobi 自動操作 AI 網頁服務時，你對該服務的使用受其自身條款與隱私權政策約束（Google、OpenAI、Perplexity、DuckDuckGo、Telegram、LINE 或你的郵件供應商）。你發布分享連結所使用的 PrivateBin 主機、以及你自行加入的任何 MCP 伺服器，亦同。Yobi 僅是在你裝置上運作的自動化層。

## 政策更新

變更將於本網址發布並更新日期。

## 聯絡方式

問題回報：https://github.com/WellWells/yobi/issues
