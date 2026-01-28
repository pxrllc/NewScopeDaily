# NewsScope Daily

**世界を日々俯瞰するニュースダイジェスト**

NewsScope Dailyは、世界中のニュースソースから情報を収集し、生成AI (Google Gemini) を用いて日本語で要約・整理して配信する自動ニュースアグリゲーターです。
「今、世界のどこで何が起きているか」を地図上で視覚的に把握し、各国の視点を含めたニュース概要を短時間でチェックすることを目的としています。

🔗 **Live Demo:** [https://pxrllc.github.io/NewScopeDaily/](https://pxrllc.github.io/NewScopeDaily/)

---

## 🚀 特徴

*   **完全自動化**: GitHub Actionsにより、毎日日本時間 朝4時に自動更新されます。
*   **AIによる要約と翻訳**: 英語圏だけでなく、世界各地のニュースをAIが日本語に翻訳・要約。
*   **地図による可視化**: ニュースの発生場所を世界地図上にヒートマップとして表示。紛争や災害などの深刻なトピックは赤色で強調表示。
*   **多角的な視点**: ひとつのトピックに対し、異なる国のメディアがどのように報じているかを比較提示。
*   **カテゴリフィルタ**: 政治、経済、エンタメなど、AIが分類したカテゴリでニュースを絞り込み表示。
*   **日次アーカイブ**: 過去のニュースも日付ナビゲーションから簡単に閲覧可能。
*   **レスポンシブ対応**: PCとスマートフォン、それぞれに最適化されたUI構成（アコーディオン表示など）。
*   **サーバーレス構成**: バックエンドサーバーを持たず、GitHub Pagesのみで動作する軽量設計。

## 🛠️ アーキテクチャと実装

このプロジェクトは **「Gitリポジトリをデータベースとして使う」** というコンセプトで構築されています。

1.  **収集 (Fetch)**:
    *   `src/backend/rss-fetcher.ts` が世界中の主要メディアのRSSフィードを取得。
2.  **加工 (Process)**:
    *   `src/backend/gemini-client.ts` がGoogle Gemini APIを使用し、記事の分類・重要度スコアリング・日本語タイトルの生成を行います。
3.  **要約 (Summarize)**:
    *   収集した記事を基に、「世界のトップニュース」と「地域別ニュース」のマークダウン要約を生成します。
4.  **生成 (Generate)**:
    *   フロントエンド用の静的JSONファイルとMarkdownを `public/data/daily/YYYY-MM-DD/` に出力します。
5.  **デプロイ (Deploy)**:
    *   GitHub Actionsが生成されたデータをコミットし、GitHub Pagesにデプロイします。

### 技術スタック

*   **Runtime**: Node.js (TypeScript)
*   **AI**: Google Gemini Pro (v1beta)
*   **Frontend**: Vanilla JS, Leaflet.js (Map), Marked.js (Markdown)
*   **CI/CD**: GitHub Actions
*   **Hosting**: GitHub Pages

## 📦 ローカルでの実行

開発やカスタマイズを行う場合の手順です。

### 前提条件
*   Node.js (v18+)
*   Google Gemini API Key

### セットアップ

```bash
# リポジトリのクローン
git clone https://github.com/pxrllc/NewScopeDaily.git
cd NewScopeDaily

# 依存関係のインストール
npm install

# APIキーの設定
# .env ファイルを作成し、以下を記述
GEMINI_API_KEY=your_api_key_here
```

### コマンド

```bash
# バッチ処理の実行（ニュース収集〜データ生成）
npm run batch

# 開発サーバーの起動（フロントエンド確認用）
npm run dev
```

## 🤝 ライセンスとフォークについて

このプロジェクトは **MIT License** の下で公開されています。

**フォーク、改造、再配布は自由に行っていただけます。**
ご自身の興味のある地域のニュースに特化させたり、デザインを変更したり、学習用として利用したりと、自由にご活用ください。

License詳細は [LICENSE](LICENSE) ファイルをご確認ください。
