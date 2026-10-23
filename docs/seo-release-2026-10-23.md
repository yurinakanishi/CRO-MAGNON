# 2026-10-23 計測・検索設定と壁画r44の公開

ユーザーの「commit then deploy」に従い、実装と既存の壁画r43/r44を `6b1cd2fdcba1184c3e4e130318840d0ffbdbb9c5` にコミットしてから、**2026-10-23 09:08 JST** に [公開サイト](https://cromagnonmmo.com/) へ反映した。pushは実施していない。

## 公開した成果物

- Worker `cromagnonmmo`、バージョン `42e871d6-22a4-4684-ad58-2e04d58ba54b`、トラフィック100%。以前の `7dcdb4a2-fc9b-4419-a805-c757fa0c8480` と成果物は保持。
- `output/seo-production-20261023-r02/`、ビルドID `da8c32bb626df7818d5d9b0789f8189132fa172a3a457c80a6b1009c5093e23b`。全9段階のproduction gateに合格した同じ成果物を、SHA・安全設定・コミットのガード後にアップロード。再ビルドしていない。
- 789静的ファイル（配信788＋`_headers`）、137.5 MiB、87 GLB、14人物、137選択写真。日英canonical/hreflang、robots、4ページのサイトマップ、同意後のみ動作するGA4、日英のプライバシー設定を含む。壁画r44の「！」付きJank0vic画像も公開。
- 専用アカウント `a211102818d484cb668c6b62bebff3f9` の認証済みChromeで、09:07 JSTに **CRO-MAGNON Free / Free / $0 / Current plan** を実確認。CLIの期限切れOAuthは既存の認証範囲内で更新した。追加スコープ・新しい料金契約は作っていない。
- `SERVICE_ENABLED: "false"`、既存DOの `9071351c3ff8445d8ce2eebdb7822cec`、クラス・移行タグv1を公開前後のCloudflare APIで照合。ソロ進行はブラウザー内で処理し、オンライン入口は503。

## 公開後の検証

- 独自ドメインで配信全788ファイル・144,170,546 bytes・87 GLBのSHAが候補台帳と一致。セキュリティヘッダーとGLBのimmutableキャッシュも合格。旧workers.devの主要22ファイルとソロhealthも一致。Chrome標準TLS検証を使用し、証明書を迂回していない。
- `/robots.txt`・`/sitemap.xml`・日英のゲーム/プライバシーページの200・MIME・canonicalを確認。HTMLにnoindexなし、サイトマップ4件。非公開人物・秘密ファイル・不明URLは404。
- 実ChromeのPC・390pxタッチ相当でソロ7項目合格。開始・自動保存・再読込・名前/服/持ち物/場所の保持・競合タブ・タッチ移動/停止/ジャンプ/保存を確認。ブラウザーエラー0、ゲームAPI/WebSocket通信0。
- 最初の公開ソロQAは未選択の同意パネルがスマホの「次へ」へのタップを遮った。QAで実際の「許可しない」を押してから遊ぶ手順へ修正し、全項目を再検証した。保存値を事前注入していない。**公開ランタイムには追加変更なし**。証拠は `output/playwright/solo-live-seo-20261023-01/`（初回）と `solo-live-seo-20261023-02/`（合格）。
- 元のproduction gateはNode 24.22.1で型/strict/714 JS/依存境界/書式・脆弱性0・1,858テスト合格/失敗0/任意4スキップ・Worker dry-run・PC/タッチ/日英/検索メタ/同意を含む全9段階合格。実スマホ・Safari・物理パッド・性能比較は未検証。
- QA手順の追記後も `npm run check`（型/strict/714 JS/依存境界）・`npm run format:check`・変更QAのPrettier・`git diff --check` が合格。JSON記録の書式を整えてから記録コミットした。

## Googleで読み戻した結果

- GA4測定ID **G-4T2Y4X52RH**。使い捨てChromeでGoogleへの同意前通信0、許可後に `google-analytics.com/g/collect` の `page_view` がHTTP **204**。URLは `https://cromagnonmmo.com/` に整形され、QA用クエリー/ハッシュは除かれている。広告パーソナライズ無効も確認。
- 通常Chromeでも公開ページの許可ボタンを操作。認証済みの専用GA4プロパティ **CRO-MAGNON MMO / 560390167** のRealtimeで、**アクティブユーザー1・CRO-MAGNON MMOのビュー1・page_view/first_visit/session_start各1** を実確認。これは動作確認のアクセスであり、一般利用者の実績として扱わない。
- Search Consoleの `sc-domain:cromagnonmmo.com` へ `https://cromagnonmmo.com/sitemap.xml` を提出し、**Success・検出4ページ・最終読込10月23日** を確認。DNS所有権とGA4連携は維持。検索掲載の完了までは確認していない。
- GA4ホームの初期表示は「No data received」だったが、その後のRealtimeで実受信を確認した。各画面の反映時差を設定失敗と混同しない。
- 一時検証コードのFetch `status` 参照ミスはQA側を直して再実行し、成功記録を別に保存した。配信コードの問題ではない。

[Google側の設定と実装詳細](analytics-search-2026-10-23.md)。現在の受信/提出結果は [Google QA記録](../assets/cloudflare/google-site-qa.json)。証拠ディレクトリは `output/cloudflare-deploy/deploy-seo-20261023-01/`（GA4・Search Consoleの画面、通信結果、アップロードログ、前後のバージョン、SHA照合）。

![Search Consoleのサイトマップ取得成功](../output/cloudflare-deploy/deploy-seo-20261023-01/search-console-sitemap-success.png)

![GA4のRealtime受信](../output/cloudflare-deploy/deploy-seo-20261023-01/ga4-realtime-received.png)

## 保存と運用

アップロード直前に `.cro-magnon-save/` の2ファイルを読み取りコピーし、公開後の元ファイルSHAが両方一致することを確認した。保存の編集・チェックポイント再適用・通常3000/8787/4173の再起動・展示物生成は行っていない。既存オンライン保存にはアクセスせず、旧originのブラウザー保存も移行していない。

[デプロイ記録](../assets/cloudflare/deployment.json)、[全ファイル照合](../assets/cloudflare/public-release-qa.json)、[ソロ実Chrome QA](../assets/cloudflare/solo-live-qa.json)。公開後の追記とQA手順のみ、別の記録コミットにまとめる。
