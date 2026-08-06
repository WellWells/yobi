# Language Packs / 語言包

Yobi's UI text lives in flat JSON files — one file per language. Anyone can add a language **without rebuilding the app**.

- **Built-in (maintained):** `en-US.json`, `zh-TW.json`, `zh-CN.json` — kept complete by the maintainer; every release ships them.
- **Community (`community/`):** packs contributed and maintained by the community. They are **not bundled** into releases and may lag behind — missing keys automatically fall back to English, so a partially translated pack still works.
- **User-installed:** any pack you drop into your personal languages folder (see below).

## Install a language pack / 安裝語言包

1. In Yobi, open **Settings → Language** and click the **folder icon** — it opens your personal languages folder (created on first click). Or navigate manually:
   - Windows: `%APPDATA%\yobi\languages\`
   - macOS: `~/Library/Application Support/yobi/languages/`
2. Copy a pack into it — e.g. download `community/ja.json` from this repository.
3. Back in Settings, the language appears in the dropdown. Select it. Done.

A user-installed pack with the same filename as a built-in one **overrides** it — this also lets you locally fix a translation you disagree with.

## Create a new language pack / 建立新語言包

1. Copy `en-US.json` (it is the source of truth — always complete).
2. Rename it to your language's BCP-47 tag: `de.json`, `pt-BR.json`, `ja.json`, …
3. Translate the **values only**. Never change the keys.
4. Keep `{{placeholders}}` exactly as they are — they are filled in at runtime:
   ```json
   "search.progress.fetching": "Reading {{count}} articles…"
   ```
5. Set the pack's display name (its own native name) — this is what the language dropdown shows:
   ```json
   "language.name.self": "Deutsch"
   ```
6. Drop the file into your personal languages folder (step 1 above) and select it in Settings.

You don't have to translate everything at once: any missing key falls back to English.

## Contribute upstream / 貢獻給社群

Open a pull request that adds or updates a file under `language/community/`. Notes:

- `community/` packs are exempt from the repo's key-parity check (`npm run i18n:check`), so a partial translation is acceptable — English fills the gaps.
- A community pack that stays complete and maintained can be promoted to built-in.
- The maintainer actively maintains only English and Chinese; community packs are reviewed for obvious problems but not for translation quality.

---

## 中文說明

Yobi 的介面文字放在扁平的 JSON 檔中,一個語言一個檔案。任何人都可以**不重新編譯**就新增語言:

**安裝**:設定 → 語言,點旁邊的**資料夾圖示**開啟個人語言資料夾(Windows:`%APPDATA%\yobi\languages\`;macOS:`~/Library/Application Support/yobi/languages/`),把語言包 JSON 丟進去,回設定頁下拉選單即可選用。與內建同名的檔案會**覆蓋內建翻譯**。

**建立**:複製 `en-US.json`(它永遠是完整的事實來源)→ 改名為 BCP-47 代碼(如 `ja.json`)→ 只翻譯 value、不動 key、保留 `{{占位符}}` → 把 `language.name.self` 設為該語言的原生名稱(下拉選單顯示用)→ 丟進個人語言資料夾。沒翻完也沒關係,缺的 key 自動以英文顯示。

**貢獻**:對 `language/community/` 發 PR。社群包不受 `i18n:check` 的 key 同步檢查約束,允許部分翻譯;持續維護的社群包可升格為內建。維護者本人只主力維護中文與英文。
