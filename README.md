# Keycommander

Obsidian のコマンドパレットを、[Keyfiler](https://github.com/yukixiii/keyfiler) と同じキーボード操作（vim 風の Insert / Normal モード）で使えるようにするプラグインです。
コマンドは **UI 言語の名前（日本語など）でも英語名でも** 検索できます。

## 機能

- 日本語 UI でも `split right` で「右に分割」が見つかる。`右に` でも見つかる。
- 「ファイル new folder」のように、プレフィックスと本体で日英を混ぜても検索できる。
- `#{{n}} のタブに移動` のような補間付きの名前も英語名にできる（`Go to tab #3`）。
- 各行に元の名前・英語名（薄く表示）・ホットキーを表示する。マッチした部分は、マッチした方の名前の中でハイライトされる。
- クエリが空のときは、コアのコマンドパレットでピン留めしたコマンド → 最近使ったコマンド → その他 の順に並ぶ。
- 今実行できるコマンドだけを表示する（コアのパレットと同じ）。
- 英語名は Obsidian 本体に読み込まれている翻訳リソース（i18next）から求める。コミュニティプラグインのコマンドは元から英語名のものが多く、その場合はそのまま検索される。

## 呼び出し方

- **Replace core command palette**（デフォルト ON）: コアの「コマンドパレット: コマンドパレットを開く」の実行を Keycommander に差し替える。Ctrl+P、他のプラグイン、vimrc の `obcommand command-palette:open` などはそのまま Keycommander を開く。OFF にするか、プラグインを無効にすると元に戻る。
- コマンド `Keycommander: Open command palette` にホットキーを割り当ててもよい。

## デフォルトのキー

すべて **設定 → Keycommander → Keymap** で変更できます（`j`、`gg`、`<C-n>`、`<S-Tab>` のような vim 記法）。

| Insert | Normal | 動作 |
|---|---|---|
| `<Down>` `<C-n>` `<C-j>` | `j` | 下へ |
| `<Up>` `<C-p>` `<C-k>` | `k` | 上へ |
| | `<C-d>` / `<C-u>` | 半ページ下 / 上 |
| | `gg` / `G` | 先頭 / 末尾 |
| `<CR>` | `<CR>` `l` | 実行 |
| `<Esc>` | `i` `a` `/` | モード切り替え |
| `<C-c>` | `<Esc>` `q` | 閉じる |

- IME で変換中のキー（変換を確定する Enter など）は無視します。
- Normal モードに入ったときに IME をオフにできます（設定の **IME off command**。Linux のデフォルトは `fcitx5-remote -c`）。

## 設定

Replace core command palette、Start mode、Show English names、Max results、Recent commands to remember、IME、Keymap。

## 開発

```sh
npm install
npm run build   # main.js を生成
npm test        # vitest
```

ビルドに成功すると、このマシンの Vault（Obsidian の `obsidian.json` に載っているもの）のうち、すでに `<vault>/.obsidian/plugins/keycommander/` フォルダがあるものに自動でインストールされます。Vault で使い始めるときは、そのフォルダを一度作ってください。
コピーするのは `main.js`、`manifest.json`、`styles.css` だけで、Vault の `data.json` には触りません。開発ディレクトリへのシンボリックリンクになっている Vault はスキップします。
`OBSIDIAN_VAULTS`（Windows では `;` 区切り）で Vault を明示的に指定することもできます。

### リリース（他のマシン向け）

```sh
npm version patch   # package.json、manifest.json、versions.json を更新してタグを打つ（"v" は付けない）
git push --follow-tags
```

タグを push すると `.github/workflows/release.yml` がテスト・ビルドし、3 つのファイルを GitHub リリースに添付します。他のマシンでは BRAT プラグインでインストール・更新できます。

非公開 API（`app.commands`、`app.hotkeyManager`、`app.internalPlugins`、`window.i18next`）を使っています。翻訳リソースが読めない場合は、元の名前だけで検索します。
