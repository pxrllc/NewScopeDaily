# NewsScope Daily — プロジェクト概要

このドキュメントは、**NewsScope Daily** プロジェクトの設計思想、アーキテクチャ、ディレクトリ構成、および開発コマンドをまとめたものです。

---

## 📌 プロジェクトの目的と概要
**NewsScope Daily** は、世界各地のニュースソース（RSSフィード）から情報を自動収集し、Google Gemini API を使って日本語に翻訳・要約・分類を行い、GitHub Pages 上で配信する自動ニュースアグリゲーターです。

単なるニュースの要約ではなく、**「世界地図上で発生場所を視覚的に把握する」** こと、および **「ひとつのトピックに対する各国の報道姿勢や視点の違い（温度差）を比較・俯瞰する」** ことを目的としています。

*   **デモサイト:** [https://pxrllc.github.io/NewScopeDaily/](https://pxrllc.github.io/NewScopeDaily/)
*   **更新頻度:** 毎日日本時間 朝4:00 (UTC 19:00) に GitHub Actions で自動実行

---

## 🛠️ 設計思想とアーキテクチャ
このシステムは **「サーバーレス」** および **「Gitリポジトリをデータベースとして使う」** というコンセプトで設計されており、運用コストを極限まで抑えています。

```
[OPMLのRSSリスト (doc/)] 
       ↓ (取得・重複排除)
[RSSフィード取得 (src/backend/rss-fetcher.ts)]
       ↓
[Gemini API処理 (src/backend/gemini-client.ts)]
       ↓ (分類・スコア・要約・翻訳)
[データ・MD生成 (src/backend/data-generator.ts)]
       ↓
[静的ファイル出力 (public/data/daily/YYYY-MM-DD/)]
       ↓ (GitHub Actions)
[GitHub Pagesでの配信]
```

### 1. 収集 (Fetch)
`doc/global-perspectives.opml` に定義された世界各国の主要メディア（Al Jazeera、Deutsche Welle、Xinhua 等）からRSSフィードを収集します。
*   **レイヤーA (国際基準点):** DW、France 24、The Guardian など
*   **レイヤーB (当事国の主張):** 新華社 (Xinhua)、CGTN など
*   **レイヤーC (ローカル情報):** Al Jazeera、Africanews、allAfrica など

### 2. AIによる加工 (Process & Summarize)
Google Gemini API (Gemini Pro v1beta, 無料枠前提) を利用して、以下の処理を行います。
*   **国判定:** ISO 3166-1 alpha-2 形式での位置判定
*   **ジャンル分類:** 国際情勢、治安・秩序、重大事故・災害、国際機関に限定（スポーツや娯楽は除外）
*   **重要度スコアリング:** 0〜100 の数値で評価
*   **日本語翻訳 & タイトル・要約生成:** 箇条書き2点までの簡潔な日本語要約

### 3. 生成と配信 (Generate & Deploy)
毎日バッチ処理を実行し、`public/data/daily/YYYY-MM-DD/` 配下に JSON (記事一覧・地図データ) と Markdown (世界のトップニュース・地域別サマリー) を生成。フロントエンドはこれらを動的に取得して Vanilla JS で描画します。

---

## 📂 ディレクトリ構成

```
F:/project/global_news/
├── src/backend/               # バックエンド（TypeScript）
│   ├── batch-runner.ts        # メインエントリポイント
│   ├── rss-fetcher.ts         # OPMLからRSSを取得・重複排除
│   ├── gemini-client.ts       # Gemini APIとの連携（翻訳・要約・分類）
│   ├── data-generator.ts      # 静的JSON/Markdownの生成
│   └── types.ts               # 共通の型定義
│
├── public/                    # フロントエンド静的ファイル（GitHub Pages）
│   ├── index.html             # メインUI（地図とニュース一覧）
│   ├── about.html             # プロジェクトについて
│   ├── css/style.css          # Vanilla CSS スタイル
│   ├── js/
│   │   ├── app.js             # フロントエンドのメインロジック
│   │   └── map-renderer.js    # Leaflet.js を使った地図描画
│   └── data/daily/YYYY-MM-DD/ # 毎日自動生成されるデータ
│       ├── feed.json          # 記事詳細データ
│       ├── map.json           # 国ごとのカウントデータ
│       ├── world-summary.md   # 世界のトップニュース要約
│       └── regional-summary.md # 地域別ニュース要約
│
├── doc/                       # ドキュメント・設定
│   ├── global-perspectives.opml  # RSSフィードリスト
│   └── global_news_perspectives_web_service_implementation_spec.md # 設計仕様書
│
├── .github/workflows/
│   └── daily-update.yml       # 朝4時の定期実行ワークフロー
│
└── logs/
    └── execution.log          # バッチの実行ログ
```

---

## ⚙️ 環境設定とコマンド

### 1. 環境変数の設定
ローカル開発時は、プロジェクトルートに `.env` ファイルを作成し、Gemini APIキーを設定します。

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### 2. 開発用コマンド

| コマンド | 説明 |
| :--- | :--- |
| `npm run batch` | RSSの収集からGemini処理、静的データの生成までの一連のバッチを実行 |
| `npm run dev` | フロントエンドを確認するためのローカル開発サーバーを起動 |

---

## 💡 重要な注意事項
*   **フロントエンドのスタック:** TypeScript ではなく Vanilla JS (`public/js/`) で構成されています。
*   **サーバーレス構造:** データベースを持たず、GitHub Actions が生成した JSON ファイルを直接読み込む構造です。
*   **エラーハンドリング:** Gemini API の処理に失敗した場合は、フォールバックとして生データを利用し、バッチ全体の停止を防ぐ設計になっています。
