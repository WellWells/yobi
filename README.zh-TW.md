<div align="center">

# 🤖 Desktop Agent Center

**免費、無需 API 金鑰的 AI 自動化桌面應用程式**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-blue)](#-快速上手)
[![Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron)](https://www.electronjs.org/)
[![No API Key](https://img.shields.io/badge/API%20金鑰-免費使用-brightgreen)](#-特色功能)
[![PRs Welcome](https://img.shields.io/badge/PRs-歡迎-brightgreen.svg)](https://github.com/WellWells/desktop-agent-center/pulls)

**[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)**

</div>

---

**Desktop Agent Center（DAC）** 是一款本機優先的開源 AI 自動化工具，直接在你的桌面上執行。它將系統剪貼簿與全域熱鍵直接串接主流 AI 服務——**ChatGPT、Gemini、Perplexity、Duck.ai**——無需 API 金鑰，無需訂閱方案，無需信用卡。

不同於 OpenClaw、Zapier AI、n8n 雲端版等從第一天就開始收費的付費自動化平台，DAC **完全免費**，直接沿用你瀏覽器中已開啟的 AI 網頁介面。安裝完成後，按下熱鍵，剪貼簿內容立即交由 AI 處理。

---

## 目錄

- [特色功能](#-特色功能)
- [快速上手](#-快速上手)
- [截圖預覽](#-截圖預覽)
- [預先建置下載](#-預先建置下載)
- [AgentFlow](#-agentflow--視覺化工作流程自動化)
- [Telegram Bot](#-telegram-bot-整合)
- [設定與自訂](#️-設定與自訂)
- [DAC vs. 付費工具](#️-dac-vs-付費工具)
- [安全性與隱私權](#-安全性與隱私權)
- [開發指南](#️-開發指南)
- [貢獻指南](#-貢獻指南)
- [開源授權](#-開源授權)

---

## ✨ 特色功能

|     | 功能              | 說明                                                                        |
| --- | ----------------- | --------------------------------------------------------------------------- |
| 🆓   | **零成本**        | 無 API 金鑰、無信用卡、無訂閱費——永久免費                                   |
| ⌨️   | **全域熱鍵**      | `Alt+G`（Windows）/ `Command+G`（macOS）擷取選取文字或剪貼簿，立即傳送給 AI |
| 🤖   | **多服務供應商**      | ChatGPT · Gemini · Perplexity · Duck.ai                                     |
| 🔁   | **AgentFlow**     | 視覺化無程式碼工作流程建構器，內建 12 種自動化技能                          |
| 📱   | **Telegram 整合** | 透過 Telegram Bot 從手機遠端操控 AI 代理                                    |
| 💾   | **自動儲存**      | 結果以 Markdown 格式附帶時間戳記儲存至本機                                  |
| 🎨   | **擷取與匯出**    | 將 AI 回應匯出為精美的 PNG、WebP 或 PDF 檔案                                |
| 🔒   | **本機優先**      | 所有邏輯在本機執行，無遙測、無追蹤                                          |
| 🌍   | **9 種介面語言**  | English、繁中、简中、日本語、한국어、Deutsch、Español、Français、Português  |

---

## 🚀 快速上手

### 環境需求

- **Node.js 20+**（[下載](https://nodejs.org/)）

### 安裝與執行

```bash
git clone https://github.com/WellWells/desktop-agent-center.git
cd desktop-agent-center
npm install
npm run dev
```

### 首次使用（4 步驟）

1. **登入**（可選）——在內建瀏覽器視窗中登入 ChatGPT / Gemini / Perplexity。
2. **開啟系統匣**——前往 **設定 → 一般 → 系統匣**，啟用縮小至系統匣，讓 DAC 在背景持續執行。
3. **選取文字**——在任意應用程式中反白選取文字。
4. **按下 `Alt+G`**——DAC 將內容傳送給 AI，結果自動寫回剪貼簿並儲存。

> **提示：** 熱鍵可在 **設定 → 一般 → 熱鍵** 中自訂。macOS 預設為 `Command+G`。

---

## 📸 截圖預覽

| 主要聊天介面 | 模型選擇選單 |
|:---:|:---:|
| ![主要聊天介面](docs/assets/main-chat-interface.png) | ![模型選擇選單](docs/assets/model-selection-menu.png) |
| 與 AI 對話——無需 API 金鑰 | 在 ChatGPT · Gemini · Perplexity · Duck.ai 間切換 |

| 對話紀錄與摘要 | 匯出選項 |
|:---:|:---:|
| ![對話歷史摘要](docs/assets/chat-history-summary-result.png) | ![匯出選項預覽](docs/assets/export-options-preview.png) |
| 附時間戳記自動儲存的回應 | 匯出為 PNG、WebP 或 PDF，支援自訂樣式 |

| 自訂提示詞設定 | Telegram Bot 配置 |
|:---:|:---:|
| ![自訂回應設定](docs/assets/settings-custom-your-own-response.png) | ![Telegram Bot 設定](docs/assets/settings-telegram-bot-config.png) |
| 設定語調、長度與自訂指示 | 幾秒內完成 Bot 連線設定 |

<div align="center">

![AgentFlow 編輯器（RSS 步驟）](docs/assets/agentflow-editor-rss-step.png)

**AgentFlow** — 擷取各網址內容、以 LLM 逐項摘要，並推播至 Telegram——無需撰寫程式碼

</div>

---

## 📦 預先建置下載

從 [**Releases**](https://github.com/WellWells/desktop-agent-center/releases) 頁面下載最新版本：

| 平台    | 格式                                   |
| ------- | -------------------------------------- |
| Windows | NSIS 安裝程式 · 可攜式 `.exe`（x64）   |
| macOS   | DMG · ZIP（x64 & Apple Silicon arm64） |

---

## 🔗 AgentFlow — 視覺化工作流程自動化

AgentFlow 是 DAC 的視覺化自動化引擎。將 **LLM 呼叫、資料來源與 Telegram 輸出**串接成全自動化流程管線——無需撰寫任何程式碼。可透過熱鍵、排程或 Telegram 指令觸發。

### 觸發方式

| 觸發方式       | 說明                                           |
| -------------- | ---------------------------------------------- |
| ⌨️ **熱鍵**     | 專屬的全域鍵盤快速鍵                           |
| ⏰ **排程工作** | 每日 / 每週 Cron 排程，支援彈性重複設定        |
| 🤖 **Bot 指令** | 自訂 Telegram Bot 指令（如 `/my_cmd <input>`） |
| ▶️ **手動執行** | 在 AgentFlow 介面依需求執行                      |

### 技能

| 技能                  | 說明                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------- |
| 🧠 **LLM**             | 向 ChatGPT、Gemini、Perplexity 或 Duck.ai 傳送提示詞；可選擇匯出回應為 PNG / WebP / PDF |
| 🌐 **瀏覽器**          | 擷取並解析任意 URL 的文字內容                                                           |
| 📡 **RSS**             | 監控 RSS/Atom 訂閱——僅傳回上次執行後的新項目                                            |
| 🕵️ **網路爬蟲** | 透過 CSS 選擇器從任意網頁擷取連結與標題，輸出為 JSON |
| 🐚 **Shell**           | 執行 Shell 指令（Windows 支援 cmd / PowerShell；macOS 支援 bash / zsh）                 |
| 📋 **剪貼簿**          | 讀取或寫入系統剪貼簿的文字內容                                                          |
| 📨 **Bot**             | 向 Telegram 聊天室傳送訊息或檔案                                                        |
| 🔁 **迴圈 / 結束迴圈** | 逐行疊代清單項目                                                                        |
| 🛠️ **公用程式**        | 新增延遲或匯出渲染快照（PNG / WebP / PDF）                                              |
| ⏹ **停止**            | 當變數為空時，有條件地中止工作流程                                                      |
| 💬 **備註**            | 為步驟新增說明文字（不執行）                                                            |

### 變數系統

每個步驟將結果寫入命名變數，後續步驟透過 `{{變數名稱}}` 引用：

```
RSS 訂閱        → 輸出: rss_1
LLM 提示        → "請摘要：{{rss_1}}"   → 輸出: llm_1
Telegram Bot   → 訊息: "{{llm_1}}"
```

### 內建工作流程範本

| 範本                      | 說明                                          |
| ------------------------- | --------------------------------------------- |
| 📰 **RSS → Telegram**      | 擷取 RSS 訂閱，LLM 摘要，傳送至 Telegram      |
| 🕵️ **網路爬蟲 → Telegram** | 爬取任意網站新內容，LLM 分析後推播至 Telegram |

工作流程可匯出為 `.json` 檔案**分享**，亦可透過檔案或 URL **匯入**。

---

## 📱 Telegram Bot 整合

將 DAC 連接至 Telegram，隨時隨地遠端操控你的 AI 代理：

1. **建立 Bot**——在 Telegram 中向 [@BotFather](https://t.me/BotFather) 傳送訊息，取得 Bot Token。
2. **填入 Token**——進入 **設定 → Telegram**，貼上 Token。
3. **綁定帳號**——向你的 Bot 傳送 `/start` 並完成綁定流程。

### 內建 Bot 指令

| 指令               | 說明                  |
| ------------------ | --------------------- |
| `/gpt <提示詞>`    | 傳送提示給 ChatGPT    |
| `/gemini <提示詞>` | 傳送提示給 Gemini     |
| `/pplx <提示詞>`   | 傳送提示給 Perplexity |
| `/status`          | 查看代理狀態          |

在 AgentFlow 中使用 **Bot 指令觸發器**，可建立完全自訂的工作流程。

---

## ⚙️ 設定與自訂

### 提示詞偏好設定

自訂每次傳送給 AI 的提示詞方式：

| 選項         | 可選值                                 |
| ------------ | -------------------------------------- |
| **語調**     | 預設 · 專業 · 輕鬆 · 直接              |
| **長度**     | 自動 · 精簡 · 詳細                     |
| **自訂指示** | 自由格式的系統級引導，套用於每次提示詞 |
| **範本**     | 儲存並重複使用你自己的提示詞範本       |

### 擷取與匯出

將任何 AI 回應匯出為精美的圖片或 PDF：

- **格式**：PNG · WebP · PDF
- **選項**：漸層調色盤、排列方向、顯示/隱藏提示詞文字、服務商名稱及時間戳記

### 一般設定

| 設定              | 說明                               |
| ----------------- | ---------------------------------- |
| **佈景主題**      | 淺色 · 深色 · 自動（跟隨系統）     |
| **版面配置**      | 堆疊 · 並排顯示                    |
| **回應逾時**      | AI 回應的最長等待時間              |
| **開機自動啟動**  | 電腦開機時自動啟動 DAC             |
| **關閉至系統匣**  | 關閉視窗時縮小至系統匣而非結束程式 |
| **Markdown 縮放** | 調整回應文字大小（70%–200%）       |

### 設定備份

透過 **設定 → 進階** 將完整設定匯出或匯入為 JSON 檔案。

---

## ⚖️ DAC vs. 付費工具

|                | Desktop Agent Center           | OpenClaw / n8n Cloud / Zapier AI |
| -------------- | ------------------------------ | -------------------------------- |
| 費用           | **永久免費**                   | 付費訂閱 / 用量計費              |
| API 金鑰       | **免費使用**                   | 通常需要                         |
| AI 服務商      | ChatGPT、Gemini、PPLX、Duck.ai | 依方案而定                       |
| 工作流程自動化 | ✅ AgentFlow（視覺化）          | ✅（付費）                        |
| Telegram 整合  | ✅ 內建                         | 不一定                           |
| 資料隱私權     | **本機優先**                   | 雲端處理                         |
| 開源           | ✅ MIT                          | 不一定                           |

---

## 🔒 安全性與隱私權

- **無遙測** — 零分析、零追蹤腳本、零使用者行為資料收集。
- **本機執行** — 所有自動化均在本機執行，資料直接傳送給你所選擇的 AI 服務商。
- **加密憑證** — Telegram Bot Token 使用 Electron `safeStorage`（作業系統層級金鑰圈）加密後才寫入磁碟。
- **第三方服務商政策** — ChatGPT / Gemini / Perplexity 所處理的查詢受其各自隱私權政策規範，作者對這些平台無控制權。
- **開源可稽核** — 所有自動化邏輯均可在 `src/main/` 目錄中查閱。

---

## 🛠️ 開發指南

```bash
# 啟動開發伺服器（含 Electron 熱重載）
npm run dev

# TypeScript 型別檢查
npm run typecheck

# i18n 金鑰稽核
npm run i18n:check

# 建置 Windows（NSIS + 可攜式版）
npm run build:win

# 建置 macOS（DMG + ZIP）
npm run build:mac
```

### 技術堆疊

| 層次      | 技術                      |
| --------- | ------------------------- |
| 執行環境  | Electron 42 + Node.js 20  |
| 前端      | React 19 + TypeScript     |
| UI 元件庫 | Mantine 9                 |
| 狀態管理  | Zustand 5                 |
| 建置工具  | Vite 8 + electron-builder |
| Telegram  | GrammY                    |
| 排程工作  | node-cron                 |

---

## 🤝 貢獻指南

歡迎提交 Issue、功能需求與 Pull Request！

1. **Fork** 本儲存庫並建立功能分支（`git checkout -b feat/my-feature`）。
2. 完成修改——確保 `npm run typecheck` 無錯誤通過。
3. 提交 **Pull Request**，附上清楚的說明。

重大變更請先開 **Issue** 討論實作方案。

---

## 📜 開源授權

本專案基於 **[MIT 授權條款](LICENSE)** 開源——自由使用、修改與散布。

---

<div align="center">

如果 DAC 為你節省了時間或費用，請 ⭐ **Star** 這個儲存庫——讓更多人發現它！

**[回報錯誤](https://github.com/WellWells/desktop-agent-center/issues) · [功能建議](https://github.com/WellWells/desktop-agent-center/issues) · [討論區](https://github.com/WellWells/desktop-agent-center/discussions)**

</div>
