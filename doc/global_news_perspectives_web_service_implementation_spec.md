# Global News Perspectives Web Service

## 目的
世界各地で起きている出来事を、**地域・立場ごとの視点差**が分かる形で把握できる静的ウェブサービスを構築する。

- 日本の主張・世論
- 当事国（例：中国・中東諸国など）の主張
- 第三者（欧州・国際メディア）の視点
- 日本では流入しにくい地域（アフリカ・南米等）の動向

を **同一日・同一地図上**で俯瞰できることを目標とする。

---

## 全体アーキテクチャ（思想）

- フロントエンド：**完全静的**（HTML / CSS / 最小限のJS）
- ロジック：**すべてビルド時（バッチ処理）に実行**
- 更新頻度：**1日1回（JST基準）**
- ホスティング：GitHub Pages / Cloudflare Pages

```
RSS → バッチ生成 → JSON / HTML → 静的配信
```

---

## 情報取得方針（RSSレイヤー設計）

### レイヤーA：国際基準点（Baseline）
重大事故・紛争・外交イベントを漏らさないための軸

- Deutsche Welle (DW) – Top / All
- France 24 (EN)
- The Guardian – World / Regional

### レイヤーB：当事国・主張箱
国家立場・プロパガンダ含めた公式視点

- 中国：Xinhua (EN), CGTN
- （将来）ロシア・中東公式メディア

### レイヤーC：地域温度（Local Reality）
日本に入りにくい現地情報

- 中東：Al Jazeera
- アフリカ：Africanews, allAfrica
- 南米：BBC / Guardian の Americas カテゴリ

> 初期段階では **各地域2〜4 RSS** に制限する

---

## ジャンル制限（情報量制御）

取得後、以下ジャンルのみを採用する：

- 国際情勢（外交・制裁・戦争・国際会議）
- 治安・秩序（紛争・テロ・暴動・重大犯罪）
- 重大事故・災害（鉄道・航空・地震・洪水）
- 国際機関（国連等）

※ 市場・娯楽・スポーツ等は初期では除外

---

## Gemini API 利用方針（無料枠前提）

### 利用目的
- 国判定（ISO 3166-1 alpha-2）
- ジャンル分類
- 重要度スコア（0–100）
- 日本語タイトル生成
- 日本語要約（箇条書き2点まで）

### 制約
- **1日1回実行**
- 採用記事数：最大 **300件 / 日**
- Gemini API 呼び出し：**5〜6回 / 日**（50〜60件まとめ処理）
- 無料枠（Free tier）想定

---

## データ構造設計

### ディレクトリ構成

```
/
├─ index.html                # 最新日トップ
├─ daily/
│   └─ YYYY-MM-DD/
│       ├─ index.html        # 当日ページ
│       ├─ feed.json         # 記事一覧
│       └─ map.json          # 国別集計
├─ country/
│   └─ JP/
│       ├─ index.json        # 日付インデックス
│       └─ YYYY-MM-DD.json   # 国×日
├─ assets/
│   ├─ countries.json        # 国コード→座標
│   ├─ map.js
│   └─ style.css
└─ sources/
    └─ global.opml
```

---

### feed.json（当日記事）

```json
{
  "date": "2026-01-26",
  "items": [
    {
      "id": "hash",
      "country": "NG",
      "region": "Africa",
      "source": "Africanews",
      "category": "Security",
      "importance": 82,
      "title": "Original title",
      "titleJa": "日本語タイトル",
      "summaryJa": "・要点1\n・要点2",
      "url": "https://...",
      "publishedAt": "2026-01-26T03:20:00Z"
    }
  ]
}
```

---

### map.json（地図用）

```json
{
  "date": "2026-01-26",
  "byCountry": {
    "NG": { "count": 3 },
    "BR": { "count": 1 }
  }
}
```

---

## フロントエンド仕様

### レイアウト

- 上部：Google Maps（世界地図）
- 下部：ニュース一覧（カード or リスト）

### インタラクション

- ニュース一覧 hover → 該当国を地図上でハイライト
- 地図 hover → 国名・件数表示
- 地図 click → `/country/{CODE}/` へ遷移
- 国ページ：日付ページング（JST基準）

### 地図

- Google Maps JavaScript API
- 国境 GeoJSON を使用
- Geocoding / Places API は使用しない（無料枠維持）

---

## バッチ処理フロー（1日1回）

1. OPML 読み込み
2. RSS 全取得
3. 重複排除（URL / GUID）
4. Gemini にまとめて投入
   - 分類 / 国判定 / スコア
   - 翻訳 / 要約（上位のみ）
5. 採用上限でカット（300件）
6. JSON / HTML 生成
7. 静的サイトへデプロイ

---

## 非ゴール（初期ではやらない）

- リアルタイム更新
- 全文スクレイピング
- 個人最適化 / レコメンド
- コメント / SNS機能

---

## この設計の狙い

- ニュースを「事実」ではなく「**視点の違い**」として読む
- 日本にいながら、世界の“温度差”を毎日確認できる
- コスト・運用負荷を極小に抑え、長期運用可能

---

## 次フェーズ案（任意）

- 同一トピックの多国比較（クラスタリング）
- 年/月単位の地政学ヒートマップ
- 翻訳ON/OFF切替

---

*This document defines a build-time–driven, perspective-oriented global news service.*

