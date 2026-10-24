# 最新コミットのソロ仲間更新を公開（2026-10-17）

ユーザーの「今新たにリモートにコミットされたからそれプルしてその最新でデプロイして」により、mainを `4d93877` から `219e3bb` へfast-forwardし、この端末で検証した同じ公開候補をCloudflareへデプロイした。公開後のファイル照合と実Chrome操作も合格した。

## 公開した版

- 公開先: [cromagnonmmo.com](https://cromagnonmmo.com/)。既存の[workers.dev URL](https://cromagnonmmo.cro-magnon.workers.dev/)も維持。
- ソース: `219e3bb1a10286791aecb696ddbc97283d22f72b`。公開直前にもリモートmainと一致を確認した。
- 公開時刻: **2026-10-17 08:01 JST**。Version: `2d445663-ccb4-484f-ab8e-6588e6043ee9`、配信割合100%。
- 前版: `42880994-b41b-494e-bb4d-4bb559d4dba6`。
- Build ID: `e39c1a19c1610d7fa2b9fbd6f147ecccf313d0a7057c7823f32662d7b4ef788c`。
- 公開候補: `output/production-20261017-02/`。公開ファイル771件・144,045,328 bytes、87 GLB、人物14人、Workerモジュール145件。

ソロの仲間11匹の複数選択・全選択／全解除、横送りの対象切替、連続投げと保存復帰、近接カメラと足元の補正、9種類のdot表記、スマホの肉球アイコンを公開した。[仲間の仕様](solo-mascots-2026-10-16.md)・[カメラ修正](companion-ground-camera-2026-10-16.md)。今回の作業ではゲームコード・3Dモデル・リグ・動作クリップを変更していない。

## 公開前の検証

`npm ci --no-audit --no-fund` は通常環境で成功。制限付き環境での初回取得はDNSエラーとなった。新しいpullに依存定義・lockfileの変更はなく、同じ固定依存を使用した。旧ソースの検証はユーザーの待機指示で中断し、最新ソースで `npm run verify:production -- --output-root=output/production-20261017-02` を最初から実行した。

- 型・strict・705 JS構文・依存境界・書式・依存監査（脆弱性0）が合格。
- 全1,846テスト中1,842合格、失敗0、任意4件スキップ。
- 公開ビルド、Worker dry-run、全916候補ファイルのSHAと余分なファイルの不在を確認。
- ソロ開始・自動保存・人物／服を変えた再開・2タブ排他、前面／背面各35秒の無操作、WebGL復帰、保存失敗／再試行、IndexedDB障害、Chromeのタッチ操作、日英入口を確認。
- 同じ公開候補で仲間の追加13項目が合格。元の `scripts/qa-solo-mascots.mjs` の操作と判定を維持し、配信先とSHA照合先をこの候補へ切り替えた実行用コピーを証拠フォルダーに保存。dot表記と肉球の判定も追加した。

08:00:11 JSTに認証済みChromeで専用アカウントのWorkers plans画面を再読込し、**CRO-MAGNON Free / Free / $0 / Current plan** をアクセシビリティツリーと画面で確認。実際の観測時刻と証拠を保存した。公開直前のguardでソース・設定・全SHAと15分以内のプラン確認を再照合し、再ビルドせず公開。新規33ファイルをアップロード、737ファイルを再利用した。

## 公開後の検証

- 独自ドメインの配信対象770ファイル・144,045,029 bytesがすべてSHA・サイズ一致。`_headers` は配信対象外。87 GLBを含む。
- workers.devの主要20ファイルもSHA一致。両URLのhealthはsolo・SOLO・最大1人。オンライン入口は503、非公開モデル等の経路は404。
- HTTPとwwwからの転送は英語ページのパス・クエリーを保持。
- 公開Chromeの通常ソロ操作7項目と仲間操作13項目が合格。PC／スマホ相当で11匹の選択・対象切替・見る／撫でる・1匹ずつの連続投げ・全員呼び戻し・保存／リロードを確認。320px／390px縦画面と844px横画面、実タッチの横スワイプも確認。
- ブラウザー例外・ゲームAPI・WebSocket通信は0。PC／スマホのゲーム画面、仲間メニュー、近接表示の画像を直接確認。
- 管理APIで新versionの100%配信、`SERVICE_ENABLED: "false"` と既存DO namespace `9071351c3ff8445d8ce2eebdb7822cec` の保持を確認。クラウドのゲーム保存は読み書きしていない。

実行環境はWindows、Node.js 24.15.0、Chrome 154.0.8037.93。実スマホ・ネイティブSafari・物理パッド・長時間性能は未検証。地面際の詳細なカメラ再現比較は既存の[修正記録](companion-ground-camera-2026-10-16.md)を参照し、今回は回帰テストと通常の「見る」操作を検証した。

ローカル保存2ファイルを公開前に控え、公開後もSHA不変。通常3000番のhealth／statusは作業前後とも接続できず、再起動は行っていない。通常3000／8787／4173の停止・再起動、保存の手動編集・再適用、オンライン再開、展示ビルド・配布、commit／pushは行っていない。

## 記録

- [公開receipt](../assets/cloudflare/deployment.json)・[配信ファイル照合](../assets/cloudflare/public-release-qa.json)・[通常ソロ操作](../assets/cloudflare/solo-live-qa.json)・[仲間操作](../assets/cloudflare/companions-live-qa.json)。
- gateと配信物: `output/production-20261017-02/`。gateのChrome: `output/playwright/production-2026-10-16T22-52-23-180Z/`。
- 仲間の公開前QA: `output/playwright/companions-candidate-20261017-02/`。
- 公開後Chrome: `output/playwright/solo-live-20261017-02/`・`output/playwright/companions-live-20261017-02/`。
- プランの画面／AX、ソースID、全配信SHA、管理API、公開ログ、旧receipt、ローカル保存控え、実行用guard／QA: `output/cloudflare-deploy/deploy-20261017-02/`。
- [別環境での先行準備と当時の確認待ち](companions-release-2026-10-17.md)は履歴として保持。
