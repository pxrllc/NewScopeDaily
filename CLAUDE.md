# CLAUDE.md — NewsScope Daily

## プロジェクト概要

**NewsScope Daily** は、世界中のRSSフィードから記事を収集し、Google Gemini APIで日本語に翻訳・要約して GitHub Pages に配信する自動ニュースアグリゲーター。

- Live: https://pxrllc.github.io/NewScopeDaily/
- 毎日 JST 4:00 (UTC 19:00) に GitHub Actions で自動実行

## 技術スタック

- **Runtime**: Node.js 20 + TypeScript (ts-node)
- **AI**: Google Gemini API (`@google/generative-ai`)
- **Frontend**: Vanilla JS + Leaflet.js (地図) + Marked.js (Markdown)
- **CI/CD**: GitHub Actions → GitHub Pages
- **構成**: サーバーレス。GitリポジトリをDBとして使用

## ディレクトリ構成

```
src/backend/         # バックエンド処理 (TypeScript)
  batch-runner.ts    # メインエントリポイント (npm run batch)
  rss-fetcher.ts     # OPMLからRSSフィードを取得
  gemini-client.ts   # Gemini APIとのやりとり (翻訳・要約・分類)
  data-generator.ts  # 静的JSONファイルの生成
  types.ts           # 型定義

public/              # GitHub Pages で配信される静的ファイル
  index.html         # メインUI
  about.html
  js/app.js          # フロントエンドロジック
  js/map-renderer.js # Leaflet地図レンダリング
  css/style.css
  data/daily/YYYY-MM-DD/  # 日次生成データ
    feed.json        # 記事一覧
    map.json         # 地図用データ
    world-summary.md / regional-summary.md

doc/
  global-perspectives.opml  # RSSソースリスト

logs/
  execution.log      # バッチ実行ログ

.github/workflows/
  daily-update.yml   # 毎日自動実行のワークフロー
```

## よく使うコマンド

```bash
# バッチ処理の実行（RSS取得 → Gemini処理 → JSON生成）
npm run batch

# 開発サーバー起動（フロントエンド確認）
npm run dev
```

## 環境変数

`.env` ファイルに設定:

```
GEMINI_API_KEY=your_api_key_here
```

GitHub Actions では `secrets.GEMINI_API_KEY` を使用。

## バッチ処理の流れ

1. **Fetch**: OPMLからRSSソースを読み込み、記事取得
2. **Filter**: ソースごと最大10件に絞り込み（合計約150件）
3. **Process**: Gemini APIでバッチ処理（10件ずつ）— 翻訳・分類・重要度スコアリング
4. **Summarize**: 世界トップニュースと地域別サマリー（曜日ローテーション）を生成
5. **Generate**: `public/data/daily/YYYY-MM-DD/` に JSON + Markdown を出力
6. **Manifest**: `available-dates.json` を更新（フロントエンドの日付ナビ用）

## データ品質方針

- Gemini処理済みの記事のみ最終データに含める（生データは含めない）
- バッチ失敗時は生データをフォールバックとして使用し処理継続

## GitHub Actions ワークフロー

- スケジュール: `0 19 * * *` (UTC) = JST 朝4時
- `npm run batch` 実行後、`peaceiris/actions-gh-pages@v3` でデプロイ
- ログと生成データを `main` ブランチにコミット（`[skip ci]` 付き）
- `permissions: contents: write` が必要

## 注意事項

- `tsconfig.json` の `rootDir` は `./src`、`outDir` は `./dist`（ts-node は直接実行）
- フロントエンドは `public/js/` 以下の Vanilla JS（TypeScript ではない）
- `package.json` の依存関係はすべて `devDependencies`（サーバーレス構成のため）
