# 仲間の対象選択と開始前の読み込みを公開（2026-10-17）

ユーザーの「Deploy」指定で、[仲間一覧と読み込みの修正](companion-picker-loading-2026-10-17.md)を09:24 JSTに公開した。一覧は対象選択だけにし、外側を押すと選択を保って閉じる。「見る・撫でる」は下側の通常ボタンを使う。選択した仲間のモデル・装備・描画用の身体を洞窟とローディング中に揃えてからゲーム画面へ移る。

## 公開した版

- 公開先: [cromagnonmmo.com](https://cromagnonmmo.com/)。既存の[workers.dev URL](https://cromagnonmmo.cro-magnon.workers.dev/)も維持。
- ソース: `219e3bb1a10286791aecb696ddbc97283d22f72b` と今回の未コミットの修正。ソース全体のSHA一覧と差分を証拠フォルダーに保存し、公開直前にも一致を確認した。
- 公開時刻: **2026-10-17 09:24:33 JST**。Version: `e4f63b24-31ae-4105-bf5d-a45ec44ac659`、配信割合100%。
- 前版: `2d445663-ccb4-484f-ab8e-6588e6043ee9`。[08:01 JSTの公開記録](companions-deploy-2026-10-17.md)と配信物を保持。
- Build ID: `bf97b70f4c56fc82e265f02e8ea68b32cbf31b088b8938d6fe7ba81cfdc1462b`。
- 公開候補: `output/production-20261017-03/`。公開ファイル771件・144,047,859 bytes、87 GLB、人物14人、Workerモジュール145件。
- 実際のランタイム: `src/runtime-main-VAHWF2S5.js`。検証した候補を再ビルドせず公開し、新規9ファイルをアップロード、761ファイルを再利用した。

## 公開前の検証

`npm run verify:production -- --output-root=output/production-20261017-03` が合格。

- 型・strict・707 JS構文・依存境界・書式・依存監査（脆弱性0）。
- 全1,851テスト中1,847合格、失敗0、任意4件スキップ。
- 公開ビルド、Worker dry-run、全916候補ファイルのSHA・サイズ・設定と余分なファイルの不在。
- 同じ候補の実Chromeでソロ開始・自動保存・再開・2タブ排他、前面／背面各35秒の無操作、WebGL復帰、保存失敗／再試行、IndexedDB障害、タッチ操作、日英入口。
- 追加の冷キャッシュ検証ではりもねこのGLB応答を保留し、洞窟の「世界へ進む」が無効で回転表示になることと、応答後の最初の世界描画に11匹全員が存在することを確認。

09:21:36 JSTに認証済みChromeで専用アカウント `a211102818d484cb668c6b62bebff3f9` のWorkers plans画面を再読込し、**CRO-MAGNON Free / Free / $0 / Current plan** を画面とアクセシビリティツリーで確認した。公開guardが15分以内のプラン確認とソース・設定・全ファイルの一致を再照合した。

管理情報の初回取得でOAuthの期限切れが発生し、既存の認証更新で解消した。最初の公開試行はアップロード前の管理情報取得でCloudflare内部認証エラー10500となり、同じ候補を再検証して再試行し成功した。権限拡張・料金プラン変更は行っていない。失敗試行と成功試行のログを両方保持。

## 公開後の検証

- 独自ドメインの全770配信ファイル・144,047,560 bytesがSHA・サイズ一致。`_headers` は直接配信対象外。workers.devの主要20ファイルも一致。
- 両URLのhealthはソロ専用。`/api/status` と `/ws` はDO参照前に503。非公開素材は404。HTTPとwwwからの転送はパス・クエリーを保持。
- 通常ソロ7項目と仲間15項目が合格。PC／スマホ相当で全選択／全解除・戻る・対象切替・一覧外タップと選択保持・下側の見る／戻る／撫でるの1回タップ・横スワイプ・11匹の連続投げ／呼び戻し・保存／再読込を確認。
- 公開された実ランタイムのSHA一致を確認してから、使い捨てChrome内だけに読み取り用観測フックを加えた。GLB保留中の入場待機と、最初の世界描画の生成済み／表示対象11/11匹を確認。一覧内の行動ボタン0、下側の見る／撫でる表示、外側タップによる閉鎖も合格。全員がカメラ内で重ならず見えるという意味ではない。
- 320×568・390×844の縦画面と844×390の横画面、44px操作域を確認。待機画面・到着画面・対象一覧・りもねこ近接・PC／スマホのソロ画面を直接確認した。
- ブラウザー例外・ゲームAPI・WebSocket通信は0。管理APIで新versionの100%配信と `SERVICE_ENABLED: "false"` を確認。

既存DO namespace `9071351c3ff8445d8ce2eebdb7822cec`、binding／class／migration、独自ドメインを維持。クラウドのゲーム保存は読み書きしていない。ローカル保存2件は公開前に控え、公開後のSHAも不変。通常3000番のhealth／statusは前後とも接続できず、再起動していない。通常3000／8787／4173の停止・再起動、保存の手動編集・再適用、オンライン再開、展示ビルド・配布、commit／pushは行っていない。

実行環境はWindows、Node.js 24.15.0、Chrome 154.0.8037.93。実スマホ・ネイティブSafari・物理パッド・長時間性能は未検証。

## 記録

- [公開receipt](../assets/cloudflare/deployment.json)・[配信ファイル照合](../assets/cloudflare/public-release-qa.json)・[通常ソロ操作](../assets/cloudflare/solo-live-qa.json)・[仲間操作](../assets/cloudflare/companions-live-qa.json)・[開始前の読み込み](../assets/cloudflare/companion-entry-live-qa.json)。
- gateと配信物: `output/production-20261017-03/`。gateのChrome: `output/playwright/production-2026-10-17T00-17-08-339Z/`。
- 同一候補の入場QA: `output/playwright/companion-entry-candidate-20261017-03/`。
- 公開後Chrome: `output/playwright/solo-live-20261017-03/`・`output/playwright/companions-live-20261017-03/`・`output/playwright/companion-entry-live-20261017-03/`。
- プラン画面／AX、ソースSHAと差分、全配信SHA、管理API、公開ログ、旧receipt、ローカル保存控え、実行用guard／QA: `output/cloudflare-deploy/deploy-20261017-03/`。
