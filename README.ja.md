<div align="center">

# 🤖 Yobi

**ChatGPT・Gemini・Perplexity・Duck.ai を、ひとつのホットキーで。ノーコードで自動化。API キーは不要。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-blue)](#-クイックスタート)
[![Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron)](https://www.electronjs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-brightgreen.svg)](https://github.com/WellWells/yobi/pulls)

**[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)**

</div>

---

**Yobi** は、あなたがいつも使っている AI サイト——**ChatGPT・Gemini・Perplexity・Duck.ai**——を、グローバルホットキーひとつで呼び出せるデスクトップアシスタントに、そしてスケジュール実行や Telegram から動かせるノーコード自動化エンジンに変えます。API キーも追加料金も不要。内蔵ブラウザで各サービスの Web ページを、あなた自身が操作するのとまったく同じように動かします。

> ℹ️ 知っておいてほしいこと：これらのサイトの自動化は、提供各社が公式にサポートする使い方ではなく、その利用規約の範囲外です。Yobi は何も回避しません——サイトが CAPTCHA を表示したら、一時停止して操作をあなたに返します。責任を持ってご利用ください。[仕組みはこちら →](#-yobi-の仕組み)

---

## ✨ なぜ Yobi なのか

|     | 特長                   | あなたにとっての意味                                                                 |
| --- | ---------------------- | ------------------------------------------------------------------------------------ |
| ⌨️   | **ひとつのホットキー** | どこでもテキストを選択して `Alt+G`（macOS は `⌘G`）を押すだけ。回答が返り、自動で保存 |
| 🔑   | **API キー不要**       | 有料 API ではなく各サービスの Web ページを使用——登録も支払いも一切不要               |
| 🤖   | **主要な AI をすべて** | ChatGPT · Gemini · Perplexity · Duck.ai をワンクリックで切り替え                      |
| 🔁   | **ノーコード自動化**   | ステップをドラッグしてワークフローを構築——あるいは言葉で説明すれば AI が組み立て     |
| 📱   | **Telegram から実行**  | スマートフォンから AI も自動化も起動                                                  |
| 🎨   | **そのまま共有できる出力** | どんな回答もスタイリッシュな PNG・WebP・PDF にエクスポート                          |
| 🔒   | **あなただけのもの**   | すべてローカルで動作——テレメトリなし、追跡なし、オープンソース                       |
| 🌍   | **9 言語対応**         | English · 繁中 · 简中 · 日本語 · 한국어 · Deutsch · Español · Français · Português    |

---

## 🚀 クイックスタート

**1. ダウンロード** — お使いの OS 向けの最新リリースを入手：

| プラットフォーム | ダウンロード                |
| ---------------- | --------------------------- |
| Windows          | NSIS インストーラー（x64）  |
| macOS            | DMG（Intel & Apple Silicon）|

→ [**Releases ページ**](https://github.com/WellWells/yobi/releases)

**2. 30 秒で最初の回答を：**

1. （任意）アプリ内ブラウザを開き、ChatGPT / Gemini / Perplexity にサインインする。
2. 任意のアプリで、好きなテキストをハイライト選択する。
3. **`Alt+G`** を押す——Yobi が選んだ AI に送信し、回答をタイムスタンプ付きの Markdown ファイルとして保存します。

> ホットキー、AI プロバイダー、トレイの挙動はすべて **設定** でカスタマイズできます。

<details>
<summary><b>ソースから実行する場合</b>（Node.js 20+）</summary>

```bash
git clone https://github.com/WellWells/yobi.git
cd yobi
npm install
npm run dev
```
</details>

---

## 📸 スクリーンショット

|                      メインチャット画面                       |                            モデル選択                          |
| :-----------------------------------------------------------: | :------------------------------------------------------------: |
| <img src="docs/assets/main-chat-interface.png" width="400" /> | <img src="docs/assets/model-selection-menu.png" width="400" /> |
|            Web インターフェース経由で AI とチャット           |       ChatGPT · Gemini · Perplexity · Duck.ai を切り替え       |

|                          チャット履歴と要約                           |                      エクスポートオプション                      |
| :-------------------------------------------------------------------: | :--------------------------------------------------------------: |
| <img src="docs/assets/chat-history-summary-result.png" width="400" /> | <img src="docs/assets/export-options-preview.png" width="400" /> |
|                 タイムスタンプ付きで自動保存される回答                |           PNG・WebP・PDF にカスタムスタイルでエクスポート         |

<div align="center">

![AgentFlow エディタ（RSS ステップ）](docs/assets/agentflow-editor-rss-step.png)

**AgentFlow** — 取得し、AI で要約して、スケジュールで Telegram へ送信——コーディング不要

</div>

---

## 🔗 AgentFlow — ノーコードで自動化

AI・データ・アクションをつなげて、**ホットキー・スケジュール・Telegram コマンド・アプリ内の `/コマンド`** で動く自動化を作れます——しかも 1 つのフローで複数を同時に使えます。

**自動化なんて作ったことがない？ その必要はありません。** やりたいことを普通の言葉で説明するだけで、AI がフロー全体を組み立ててくれます：

> *「毎週平日の午前 8 時に、RSS フィードを要約して Telegram へ送って」* → 🪄 そのまま実行できる完全なフローが生成されます。

細かく調整したい？ どのステップも編集でき、ゼロから自分でドラッグして組むこともできます。

**つなげられるもの：**

- 📥 **データ取得** — Web ページ・RSS・HTTP API・YouTube の字幕、さらに株価 / 為替 / 天気のライブデータまで——API キー不要
- 🌐 **ブラウザ操作** — タブを開く・クリック・フォーム入力・スクリーンショット
- 🧠 **AI に質問** — ChatGPT · Gemini · Perplexity · Duck.ai
- 📤 **結果を送信** — Telegram・メール・ファイル・クリップボード
- 🛠️ **何でも実行** — プログラム・JavaScript・シェル、さらにシステム & 電源の制御
- 🔀 **制御フロー** — ループ・条件分岐・スケジューリング

…**35+ のスキル、さらに増加中**。すべてシンプルな `{{variables}}` でつながり、各ステップの出力が次のステップへ渡されます。

**テンプレートから始めて** カスタマイズ：

| テンプレート                            | 内容                                                       |
| --------------------------------------- | ---------------------------------------------------------- |
| 📰 **RSS → Telegram**                    | フィードを AI で要約して Telegram へ送信                    |
| 🕵️ **Web Monitor → Telegram**            | 任意のサイトの新着を監視し、分析して Telegram へ配信       |
| ▶️ **YouTube Subscriptions → Telegram**  | フォロー中チャンネルの新着動画を、サムネイル付きで要約     |

フローはただの `.json`。ワンクリックでエクスポート・共有・インポートできます。

---

## 📱 Telegram から実行

スマートフォンから AI を使いたい？ Telegram Bot をつなぐだけ——所要およそ 2 分：

1. **Bot を作成** — [@BotFather](https://t.me/BotFather) にメッセージを送り、発行されたトークンをコピーする。
2. **トークンを貼り付け** — **設定 → Telegram** に貼り付ける。
3. **Bot に `/start`** を送り、ペアリングの案内に従う。これで完了。

あとは、どこからでも Bot にメッセージを送るだけ：

| コマンド               | 機能                                                |
| ---------------------- | --------------------------------------------------- |
| `/gpt` · `/gemini` · `/pplx` · `/duck` | そのプロバイダーに質問（コマンドはカスタマイズ可能） |
| `/output <モード>`     | 返信形式を設定 — `md` · `png` · `webp` · `pdf`       |
| `/status`              | エージェントの状態を確認                            |
| `/restart`             | Yobi を再起動（管理者）                             |

AgentFlow で **Telegram トリガー** を使えば、独自のコマンドも作成できます——どんなメッセージでもフローを起動できます。

---

## ⚙️ 設定とカスタマイズ

- **プロンプト設定** — デフォルトのトーンと長さを決め、すべてのプロンプトの先頭に独自の指示を追加できます。
- **キャプチャ & エクスポート** — どんな回答もスタイリッシュな PNG / WebP / PDF に（ライト/ダークのカード、グラデーションパレット、表示するメタデータも自由に選択）。
- **メール（SMTP）** — フローから結果をメールで送信。パスワードは OS のキーチェーンに保存され、フローファイルには書き込まれません。
- **アカウント** — プロバイダーごとにサインイン／サインアウトでき、データをワンクリックでリセットして動かなくなったセッションを復旧できます。
- **外観と挙動** — 11 種類のテーマ、縦並び／横並びレイアウト、スタートアップ起動、トレイへ最小化、応答タイムアウト、テキストズーム。
- **バックアップ** — すべての設定を 1 つの JSON ファイルとしてエクスポート・インポート。

---

## 🔍 Yobi の仕組み

Yobi は、ChatGPT・Gemini・Perplexity・Duck.ai の **Web インターフェース** を自動化します。内蔵のブラウザウィンドウで、各サービスのサイトにプロンプトを入力し、ページから回答を読み取ります——あなたが手作業でやるのと同じことです。ログインが必要なのはそれを求めるサービスだけで、ログインはそのウィンドウ内で行います。**公式 API もローカルモデルも使いません**。だからこそ、API キーも料金も不要なのです。

公式 API ではなく各サービスの Web ページを使うため、これは各サービスの利用規約の範囲外になります。とはいえ Yobi はそれを隠しません——技術的な保護は一切回避しません：CAPTCHA を突破したり、レート制限をかいくぐったり、IP をローテーションしたりはしません。そのため実際に遭遇するのは、せいぜいボット対策——Cloudflare のような「あなたは人間ですか」の確認ページくらいです。その場合、Yobi は一時停止して操作をあなたに返し、あなたが手動で確認を済ませます。

**Yobi は責任を持ってご利用ください**——違法なことはせず、大規模・悪質な自動化もしないでください。軽い個人利用なら、たいていは時々確認画面が出る程度です。大量・悪質な利用こそ、ブロックされる対象です。この前提で使うかどうかは、あなた次第です——本記載は法的助言ではなく、各サービスの規約は変更されることがあるため、ご自身でご確認ください。

---

## 🔒 セキュリティとプライバシー

- **テレメトリなし** — 分析もトラッキングも一切なし。送信したクエリは、あなたが選んだ AI プロバイダーにのみ送られます（各社のプライバシーポリシーに従います）。
- **ローカル & オープンソース** — 自動化ロジックはすべてローカルマシン上で動作し、`src/main/` で監査できます。
- **認証情報の暗号化** — Telegram トークンと SMTP パスワードは、OS のキーチェーン（Electron `safeStorage`）で暗号化されてからディスクに書き込まれます。

---

## 🛠️ 開発

```bash
npm run dev         # dev server with Electron hot-reload
npm run typecheck   # TypeScript type checking
npm run i18n:check  # i18n key audit
npm run build:win   # build Windows (NSIS installer)
npm run build:mac   # build macOS (DMG)
```

**技術スタック：** Electron 42 · React 19 + TypeScript · Mantine 9 · Zustand 5 · Vite 8 + electron-builder · GrammY · node-cron

---

## 🤝 コントリビューション

Issue や PR を歓迎します！ リポジトリを Fork してブランチを作成し（`git checkout -b feat/my-feature`）、`npm run typecheck` が通ることを確認したうえで、明確な説明を添えて PR を送ってください。大きな変更の場合は、まず Issue を開いて方針を相談してください。

---

## 📜 ライセンス

[**MIT**](LICENSE) — 自由に使用・修正・配布できます。

---

<div align="center">

Yobi が時間の節約になったら、ぜひ ⭐ **Star** を——ほかの人が見つけやすくなります！

**[バグ報告](https://github.com/WellWells/yobi/issues) · [機能リクエスト](https://github.com/WellWells/yobi/issues) · [ディスカッション](https://github.com/WellWells/yobi/discussions)**

</div>
