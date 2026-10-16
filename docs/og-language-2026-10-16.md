# OG文言の短縮と日本語・英語の共有URL（2026-10-16）

ユーザー指定「og text シンプルにする。日本語と英語で分けられる？」に対応。

| 共有先のパス | 説明文                       | OGの言語 |
| ------------ | ---------------------------- | -------- |
| `/`          | 原始の世界を自由に冒険。     | `ja_JP`  |
| `/en/`       | Explore a prehistoric world. | `en_US`  |

タイトルは両方とも `CRO-MAGNON MMO`。以前の「三つの国と湾」「作物」「オンライン」の長い説明を置き換え、通常のdescription・OG・X用のdescriptionを各言語でそろえた。各HTMLに異なる `og:url` とcanonical、相互のhreflangと代替localeを指定。同日の追加指定により、下記のタイトル画像を共有画像として指定した。

## 配信とゲームの言語

- `public/index.html` と `public/en/index.html` を用意し、JavaScriptを実行しなくても言語別の本文を取得できる。ゲーム本体・CSS・素材は共通。
- ローカル静的配信では `/en` と `/en/` を英語HTMLへ対応させた。公開用ビルドにも英語HTMLを含め、両言語で同じバンドル置換・カメラ機能除外を適用する。Cloudflareは静的アセットの既存のHTMLルーティングで配信し、WorkerルートやDO/SQLを追加しない。
- `/en/` は保存済みの日本語設定より優先して英語で起動。通常URLは従来どおり保存済みの言語を引き継ぐ。
- タイトルの言語ボタンで、URLも `/` または `/en/` に切り替わる。query・hash・history stateを保持し、再読み込みや再接続は行わない。アドレス欄のURLを共有すると対応する静的HTMLを取得できる。
- 保存されている展示向けの構成にはURL切替を適用しない。展示用ビルド・ZIP・配布は実行していない。

## タイトル画像をOG画像へ指定（同日の追加依頼）

ユーザー指定「og image should be title image」に対応。両言語の `og:image` と `twitter:image` に、ゲームのタイトルで実際に使用する `https://cromagnonmmo.cro-magnon.workers.dev/title/cro-magnon-mmo-transparent.webp` を設定。1536×1024、`image/webp` を明示し、画像説明は各言語にした。Xのカードは `summary_large_image`。

既存の画像をそのまま参照し、生成・加工・追加素材なし。WebPは1,771,796 bytes、SHA-256 `4e18b0480e684c39b556cdb06d5ab1c1b8d24605c98da1b25f68c747c26d0647`。タイトル画面と共有画像が同じ素材を読む。

関連8テストと `npm run check`（型・strict・675 JS構文・依存境界）が合格。分離した公開用ビルドは778ファイル・137.1 MiB。保存を使わない一時ローカルサーバーとMiniflare、実Chromeで7項目合格。両言語のクローラー向け静的HTML、OG/Xタグ、画像のMIME・配信SHA、実タイトル画像のデコードと寸法一致を確認。ブラウザーエラー・ゲームAPI・WebSocketは0件。ユーザー保存2ファイルのSHA不変。通常サーバーの起動・再起動、公開デプロイ、展示生成・配布、commit/pushは行っていない。SNS側の本番カード表示は未検証。証拠は `output/og-title-image-20261016/`。

## 言語別OGの検証

- 関連49テスト合格。実HTTPでの日本語・英語・`/en`・直接HTML・query付きURL・HEAD・404、HTMLバンドル処理、言語初期化、タイトルの引継ぎ、既存の静的配信、公開用機能除外を確認。
- `npm run check` 合格（型・strict・675 JavaScriptの構文・依存境界）。変更ファイルのPrettierと `git diff --check` を実施。
- `npm run build:mmo -- --output-root=output/og-language-20261016/final-build` で公開用ビルドを通常の配信先から分離して生成。777ファイル、137.1 MiB。公開デプロイなし。
- `scripts/qa-og-language.mjs` の実Chrome headlessで11項目合格。保存を使わないローカルサーバーと、生成した公開アセットを配るMiniflareで確認。Miniflareの動的Workerは常に500を返す検証用実装とし、ゲームWorkerやDBを起動せず両言語の静的配信が成功することを確認した。
- QA用ブラウザーだけに日本語設定を準備し、英語URLへのアクセス・実ボタンでの往復・reload・通常URLからの設定継承・英語の人物選択を操作。PC 1280×800とモバイル相当390×844で撮影。ブラウザーエラー・ゲームAPI・WebSocketは0件。HTMLは実HTTP応答と元ファイルのSHAが一致。
- ユーザー保存の2ファイルは作業前後でSHA一致。通常3000番と8787番は最終確認時に接続拒否のため、その配信SHAは未照合。起動・停止・再起動は行っていない。

最初の公開用ビルドでは、カメラ機能除外がルートのindex.htmlだけを対象にしていたことを監査が検出した。言語別index.htmlにも同じ処理を適用して解消。初回HTTPテストはサンドボックスのloopback拒否で中断し、独立した検証として許可された実行で49件合格。初回Chrome検証は人物画面と仲間画面の同名セレクターが競合して停止したため、可視の人物見出しを指定して再実行した。

証拠は `output/og-language-20261016/`（ビルド・check・テスト・保存SHA・既存サーバー照合）、`output/playwright/og-language-20261016/final/`（最終Chrome結果・画像・配信SHA）。実スマホ・Safari・SNS側の本番カード表示・全体テストは未検証。ソースと通常のコンパイル出力を更新し、公開先と通常の公開用出力フォルダーの差し替え、commit/pushは行っていない。

参照仕様：[Open Graph](https://ogp.me/)のdescription・locale・URL、[CloudflareのHTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/)のディレクトリーindex配信。
