<div align="center">

# vault-panel

**Your Claude Code usage, calendar and todos, always in view.**<br>
**Claude Code の右側に、使用量・予定・Todo を常時表示。**

A Claude Code mod that keeps your rate-limit usage, today's Google Calendar events and your Markdown Todos in a pane next to the conversation.

**Limits: the labels are in Japanese only, and times use Japan Standard Time (UTC+9).** Unofficial community project, not affiliated with Anthropic, Google or Obsidian.<br>
**制限：表示は日本語のみ、時刻は日本時間（UTC+9）です。** 非公式のコミュニティ作品で、Anthropic、Google、Obsidian とは関係ありません。

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Version 0.8.3](https://img.shields.io/badge/version-0.8.3-blue.svg)](.claude-plugin/plugin.json)
[![Claude Code mod](https://img.shields.io/badge/Claude%20Code-mod-orange.svg)](https://code.claude.com/docs/en/plugins/mods/overview)
[![Calendar and Todos: read-only](https://img.shields.io/badge/calendar%20%26%20todos-read--only-lightgrey.svg)](#faq-and-limits)

[English](#english) · [日本語](#日本語)

<img src="images/panel.png" alt="vault-panel sample drawn with fictional data: usage bars, today's events, todos and next items" width="320">

<sub>The image is a sample drawn with fictional data. The labels are in Japanese; the colors follow your terminal theme.<br>
画像は架空のデータで描いた見本です。実際の色は端末のテーマに合わせて変わります。</sub>

</div>

---

<a id="english"></a>

## English

[日本語はこちら](#日本語)

vault-panel is a [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview). It opens a small pane beside the conversation (or above the prompt in a narrow terminal) and keeps four things in view:

- **Usage**: your 5-hour and weekly limits as bars on one line. The row below shows when each limit resets (a clock time for the 5-hour limit, a date for the weekly one) whenever Claude Code provides the time. The bar turns yellow at 70% and red at 90%, and the frame changes color with it.
- **Calendar**: today's events (finished ones are dimmed), the first event tomorrow, and the number of later events within the next 7 days.
- **Todos**: read from Markdown files with front matter, sorted by due date, then priority. Overdue items are red, items due today are yellow, and what does not fit becomes "ほか N件" (N more).
- **Next**: the unfinished `- [ ]` items under the first `##` heading of a work-log file you choose (keep the newest entry at the top).

It is read-only for your calendar and your Todo files. The pane fits itself to the available height (framed sections, then colored bands, then plain rows). Todos and the work log refresh after each turn; calendar events refresh every 10 minutes. Type `/panel` to reopen the pane, refresh it, and print every "next" item.

At the start of a session it also prints a short summary (at most once every 10 minutes). The first start of a day adds today's events.

### Requirements

- **Claude Code with mod support.** Anthropic's documentation says mods need Claude Code v2.1.287 or later in the terminal (v2.1.286 or later in the desktop app; extension 2.1.299 or later in VS Code). See [Turn mods on or off](https://code.claude.com/docs/en/plugins/mods/overview#turn-mods-on-or-off). Tested with Claude Code 2.1.317 on Windows 11. macOS and Linux are not tested.
- **A folder of Markdown files** for your Todos (an Obsidian vault works; the Obsidian app itself is not needed). Each Todo is one `.md` file directly inside one folder.
- **The Google Calendar connector** connected to your Claude account, if you want the calendar section. Without it the calendar section says it cannot read events; the rest still works.
- **Python** only if you set `diaryScript` (optional).

### Install

In a Claude Code session:

```
/plugin install vault-panel --marketplace R76H94/vault-panel
```

This needs Claude Code v2.1.275 or later. Claude Code shows the plugin's details; choose a scope, then fill in the options (see [Settings](#settings)). `vaultPath` is required.

From your shell (needs v2.1.292 or later):

```
claude plugin install vault-panel --marketplace R76H94/vault-panel
```

If you install from the shell while a session is open, run `/reload-plugins` in that session.

Or add the marketplace first and install by name:

```
/plugin marketplace add R76H94/vault-panel
/plugin install vault-panel@vault-panel
```

In the desktop app, see [Install plugins](https://code.claude.com/docs/en/plugins/install).

To check that the mod loaded, run `/plugin`: a line under the tabs lists the active mods.

Update and remove:

```
claude plugin update vault-panel@vault-panel
claude plugin uninstall vault-panel@vault-panel
```

Auto-update is off by default for third-party marketplaces, so run the update command (or use **Update now** in `/plugin`) when a new version is out.

### Settings

Claude Code asks for these when you install. You can change them later in `/plugin` (Installed tab, choose vault-panel, then **Configure options**).

| Option | What it is | Default |
|---|---|---|
| `vaultPath` | Absolute path of the folder that holds your notes (required). Example: `C:/Users/you/ObsidianVaults/my-vault` | none |
| `todoDir` | Todo folder, relative to the vault. Each `.md` file directly in it is one Todo; subfolders are ignored | `todo` |
| `worklogFile` | Work-log file for the "Next" section, relative to the vault. The unfinished `- [ ]` items under the first `##` heading are shown. Empty turns it off | empty |
| `diaryDir` | Diary folder laid out as `YYYY/MM/YYYY-MM-DD.md`, relative to the vault. If a day's file has no `## 振り返り` heading, a reminder is shown at start (the reminder text is written for the author's setup). Empty turns it off | empty |
| `diaryScript` | A script (relative to the vault) that is run with `python` on the first start of each day. Empty means nothing is run | empty |
| `calendarServer` | Name of your Google Calendar connector | `claude.ai Google Calendar` |

A Todo file needs front matter like this:

```markdown
---
title: Buy milk
status: 未着手
due: 2026-11-05
priority: 中
---
```

- `title`: shown in the pane (the file name is used if missing).
- `status`: a Todo is hidden only when this is `完了` (done) or `中止` (cancelled). Any other value, including `Done`, keeps it visible. No value counts as `未着手` (not started).
- `due`: `YYYY-MM-DD`. A different format is reported as "要確認 N件" (N to check). No `due` means it sorts last.
- `priority`: `高` (high), `中` (medium), `低` (low). Anything else, or nothing, counts as `中`.

### FAQ and limits

**Is it safe to install?** A mod runs inside Claude Code with your permissions and is not sandboxed ([Anthropic's note on trusting a mod](https://code.claude.com/docs/en/plugins/mods/overview#decide-whether-to-trust-a-mod)). vault-panel is one small file, `hooks/register.mjs`. It reads Markdown files under `vaultPath` and asks your calendar connector for events (`list_events` only). Calendar events come through the Google Calendar connector you connected (Claude Code talks to it). Apart from that, the mod's own code makes no network requests and does not write to your calendar or your files. If you set `diaryScript`, that script runs with your permissions and can do anything your account can. To list what it does before installing, clone the repository and run `claude plugin validate` on it.

**The labels are in Japanese.** The pane text ("今日", "明日", "超過", "次", "ほか") and the start-of-session messages are Japanese only. There is no language option yet.

**Times use Japan Standard Time (UTC+9).** "Today", "tomorrow", event times and reset times are calculated in Japan time, whatever your own time zone is.

**Todo values are Japanese.** See the status and priority values above.

**The usage bars say "使用量 応答後に表示" (shown after a reply).** The bars appear once Claude Code has reported your limits, after the first reply. If your account does not report limits, the bars may not appear (not tested).

**The pane does not appear.** Check that your Claude Code version supports mods and that the terminal is wide enough for a side pane (in a narrow terminal it sits above the prompt). Run `claude --debug` and look for lines about `vault-panel` ([Troubleshoot a mod](https://code.claude.com/docs/en/plugins/mods/troubleshoot)). Mods do not load with `--safe-mode` or `--bare`, or when `disableAllHooks` is set.

**"予定を読めません" (cannot read events).** Connect the Google Calendar connector, check that `calendarServer` matches its name, then run `/panel`.

**Which systems are tested?** Claude Code 2.1.317 on Windows 11. macOS and Linux are not tested.

**It may break after a Claude Code update.** Mod events and methods can change between Claude Code releases ([Create a mod](https://code.claude.com/docs/en/plugins/mods/create#share-your-mod)). Please open an issue with your Claude Code version.

vault-panel is an unofficial community project, not affiliated with or endorsed by Anthropic, Google or Obsidian.

### License

[MIT](LICENSE)

---

<a id="日本語"></a>

## 日本語

[English](#english)

vault-panel は [Claude Code の Mod](https://code.claude.com/docs/ja/plugins/mods/overview) です。会話の横（狭い端末ではプロンプトの上）に小さなペインを開き、次の4つを常時表示します。

- **使用量**：5時間と週の枠を横棒で1行に。その下の行に、回復の時刻（5時間枠は時刻、週の枠は日付）を出します（Claude Code が時刻を渡したとき）。70%で黄、90%で赤になり、枠の色も変わります。
- **予定**：今日の予定（終わったものは薄く）、明日の最初の予定、7日以内のそれ以降の件数。
- **Todo**：フロントマターのある Markdown から読み、〆切の近い順、次に優先度の順。超過は赤、今日〆切は黄。入りきらない分は「ほか N件」。
- **次**：自分で決めた作業記録のファイルで、最初の `##` 見出しの下にある未完了の `- [ ]` の項目（新しい記録を上に書く使い方を想定）。

予定と Todo のファイルは読み取り専用で、変更しません。縦の長さに合わせて表示を詰めます（枠つき、色の帯、素の行の順）。Todo と「次」は応答のたびに、予定は10分ごとに更新します。`/panel` でペインを開き直して最新にし、「次」を全部出します。

セッションの開始時には、短いまとめも出します（10分に1回まで）。その日の最初の起動では、今日の予定も加わります。

### 必要なもの

- **Mod が使える Claude Code**。公式の文書では、端末は v2.1.287 以降、デスクトップアプリは v2.1.286 以降、VS Code の拡張は 2.1.299 以降が必要です（[Mod のオンとオフ](https://code.claude.com/docs/ja/plugins/mods/overview)）。動作を試した環境：Claude Code 2.1.317、Windows 11。macOS と Linux は未確認です。
- Todo を入れる **Markdown のフォルダ**（Obsidian の Vault で使えます。Obsidian のアプリは不要です）。Todo は、1つのフォルダの直下にある `.md` 1件が1つです。
- 予定を出すには、Claude のアカウントに **Google Calendar のコネクタ**を接続してください。接続がなければ予定の区画に読めないと出ますが、ほかの区画は動きます。
- **Python**：`diaryScript` を使うときだけ（任意）。

### 入れ方

Claude Code の入力欄で：

```
/plugin install vault-panel --marketplace R76H94/vault-panel
```

Claude Code v2.1.275 以降が必要です。プラグインの詳細が開くので、適用範囲を選び、設定の項目を入れます（下の「設定」）。`vaultPath` は必須です。

シェルから（v2.1.292 以降が必要）：

```
claude plugin install vault-panel --marketplace R76H94/vault-panel
```

セッションを開いたままシェルから入れたときは、そのセッションで `/reload-plugins` を実行してください。

先にマーケットプレイスを追加して、名前で入れることもできます：

```
/plugin marketplace add R76H94/vault-panel
/plugin install vault-panel@vault-panel
```

デスクトップアプリは、[Install plugins](https://code.claude.com/docs/ja/plugins/install) を見てください。

読み込まれたかは `/plugin` で確かめられます。タブの下の行に、動いている Mod が出ます。

更新と削除：

```
claude plugin update vault-panel@vault-panel
claude plugin uninstall vault-panel@vault-panel
```

自作のマーケットプレイスは、既定では自動更新がオフです。新しい版が出たら、更新のコマンドを実行する（または `/plugin` の **Update now**）してください。

### 設定

入れるときに聞かれます。あとから `/plugin` の Installed タブで vault-panel を選び、**Configure options** で変えられます。

| 項目 | 内容 | 既定 |
|---|---|---|
| `vaultPath` | ノートを入れたフォルダの絶対パス（必須）。例：`C:/Users/you/ObsidianVaults/my-vault` | なし |
| `todoDir` | Todo のフォルダ（Vault 内の相対パス）。直下の `.md` 1件が Todo 1件。サブフォルダは読みません | `todo` |
| `worklogFile` | 「次」に出す作業記録のファイル（Vault 内）。最初の `##` 見出しの未完了 `- [ ]` を出す。空なら出さない | 空 |
| `diaryDir` | `YYYY/MM/YYYY-MM-DD.md` の形の日記のフォルダ（Vault 内）。その日のファイルに `## 振り返り` がなければ、起動時に知らせる（知らせの文面は作者の環境向け）。空なら知らせない | 空 |
| `diaryScript` | 1日の最初の起動で `python` で実行するスクリプト（Vault 内）。空なら何も実行しない | 空 |
| `calendarServer` | Google Calendar のコネクタ名 | `claude.ai Google Calendar` |

Todo のファイルには、次のようなフロントマターが必要です。

```markdown
---
title: 牛乳を買う
status: 未着手
due: 2026-11-05
priority: 中
---
```

- `title`：ペインに出す件名（なければファイル名）。
- `status`：`完了` と `中止` のときだけ表示しません。それ以外の値は表示します。値がなければ `未着手` として扱います。
- `due`：`YYYY-MM-DD`。形式が違うと「要確認 N件」と出ます。なければ最後に並びます。
- `priority`：`高`、`中`、`低`。それ以外や空は `中` として扱います。

### よくある質問と制限

**入れて安全ですか。** Mod は Claude Code の中で、あなたの権限で動き、サンドボックスの外です（[公式の注意](https://code.claude.com/docs/ja/plugins/mods/overview)）。vault-panel は小さなファイル `hooks/register.mjs` 1つです。`vaultPath` の下の Markdown を読み、カレンダーのコネクタに予定を頼みます（`list_events` だけ）。予定は、接続した Google Calendar のコネクタを通して取ります（通信は Claude Code が行います）。それ以外に Mod 自身がネットワークへ接続することはなく、予定やファイルを書き換えません。diaryScript を設定した場合、そのスクリプトはあなたの権限で動き、何でも実行できます。入れる前に何をするか確かめたいときは、リポジトリを取得して `claude plugin validate` を実行してください。

**表示は日本語だけです。** ペインの文字（「今日」「明日」「超過」「次」「ほか」）と起動時の案内は日本語のみで、言語の設定はまだありません。

**時刻は日本時間（UTC+9）です。** 「今日」「明日」、予定の時刻、回復の時刻は、あなたの時間帯にかかわらず日本時間で計算します。

**使用量の棒に「使用量 応答後に表示」と出ます。** Claude Code が枠の情報を知らせたあと、最初の応答のあとに棒が出ます。アカウントによって枠の情報が出ない場合は、棒が出ないかもしれません（未検証）。

**ペインが出ません。** お使いの Claude Code の版が Mod に対応しているか、端末の幅が足りているか（狭いとプロンプトの上に出ます）を確かめてください。`claude --debug` で起動して `vault-panel` の行を探します（[Mod のトラブル対応](https://code.claude.com/docs/ja/plugins/mods/troubleshoot)）。`--safe-mode`、`--bare`、`disableAllHooks` の設定では、Mod は読み込まれません。

**「予定を読めません」と出ます。** Google Calendar のコネクタを接続し、`calendarServer` がその名前と合っているか確かめて、`/panel` を実行してください。

**どの環境で試しましたか。** Claude Code 2.1.317、Windows 11 です。macOS と Linux は未確認です。

**Claude Code の更新で動かなくなることがあります。** Mod のイベントやメソッドは、Claude Code のリリースで変わることがあります。動かなくなったら、Claude Code の版を書いて Issue を立ててください。

vault-panel は非公式のコミュニティ作品で、Anthropic、Google、Obsidian とは関係がなく、承認も受けていません。

### ライセンス

[MIT](LICENSE)
