# 選択中の仲間カードの配色と公開（2026-10-17）

ユーザーの「枠だけでは選択が分かりにくい、色を変えてデプロイ」の指定で、選択中のカード全体を金色にした。開始前・ゲーム中の仲間メニュー・横送りの対象一覧で共通にし、11:25 JSTに公開した。

## 変更

- `src/orb-bots.css` の選択背景を薄い半透明色から不透明な `#e6b66e`、名前を `#211a10`、状態文字を `#4c3419` へ変更。未選択は従来の暗い背景を保つ。
- カードのホバー指定が選択色より優先していたため、未選択のカードだけに適用。選択中はマウスを重ねても金色を保つ。
- 金色のカードでもキーボード位置を見分けられるよう、選択中のフォーカス輪郭を濃い色にした。選択・全解除・対象切替の処理は既存のまま。
- 前回09:24の公開ソース一覧と今回の一覧を照合し、実行コードの差分はこのCSSのみと確認。

## 公開した版

- 公開先: [cromagnonmmo.com](https://cromagnonmmo.com/)。従来の[workers.dev](https://cromagnonmmo.cro-magnon.workers.dev/)も保持。
- 公開時刻: **2026-10-17 11:25:15 JST**。Version: `9f9bcae5-c1c9-411b-885f-2dfbd13ddd4f`、100%配信。
- 前版: `e4f63b24-31ae-4105-bf5d-a45ec44ac659`。[09:24の公開記録](companion-picker-deploy-2026-10-17.md)と証拠を保持。
- ソース: `219e3bb1a10286791aecb696ddbc97283d22f72b` と前回からの未コミット変更、今回の配色修正。公開直前にもソース全体のSHAと差分を照合。
- Build ID: `5600c00bfd6155280d730820a812f4019272c4631452a01be7e1044cdb3d13e1`。
- 同一公開候補: `output/production-20261017-04/`。771ファイル・144,048,055 bytes、87 GLB、人物14人、Workerモジュール145件。検証後の再ビルドなし。
- 新規6ファイルをアップロード、764ファイルを再利用。ランタイムは `src/runtime-main-ROIREHN3.js`。

11:22:21 JSTに認証済みChromeで専用アカウントのWorkers plansを再読込し、**CRO-MAGNON Free / Free / $0 / Current plan** を画面とアクセシビリティツリーで確認。既存ログインの期限切れは通常の認証更新で解消した。権限・料金プランの変更なし。

## 検証

`npm run verify:production -- --output-root=output/production-20261017-04` が合格。全1,851テスト中1,847合格・失敗0・任意4件スキップ。型・strict・707 JS構文・依存境界・書式・依存監査・公開ビルド・Worker dry-run・実Chromeの保存／再開／無操作／タブ排他／WebGL復帰／保存障害／日英入口も合格。CSSのPrettier検査も合格。

同じ候補と公開サイトで、PC／スマホ相当の開始前・メニュー・対象一覧に選択／未選択を並べ、画面と実際の計算済み色を確認。選択カードの名前と背景のコントラストは3か所とも約9.25:1、状態文字も4.5:1以上。ホバー後も色が維持され、実Tab入力で選択カードのフォーカス輪郭を確認した。初回の測色は既存の0.16秒アニメーション途中を読んで失敗したため、アニメーション完了を待つ観測手順に修正し、同じビルドで再実行して合格した。

公開後は全770配信ファイル・144,047,756 bytesと旧URLの主要20ファイルがSHA・サイズ一致。通常ソロ7項目、仲間15項目、3か所の選択色、GLB応答保留中の入場待機と初回描画11/11匹が合格。ブラウザー例外・ゲームAPI・WebSocketは0。ソロ設定と既存DO namespace `9071351c3ff8445d8ce2eebdb7822cec` を保持。

Windows、Node.js 24.15.0、Chrome 154.0.8037.93で検証。390pxタッチと320px縦／844px横画面を含む。実スマホ・ネイティブSafari・物理パッド・長時間性能は未検証。

ローカル保存2件を公開直前に控え、前後のSHA不変。通常3000番のhealth／statusは前後とも接続できず、再起動していない。通常サーバーの停止／再起動、ユーザー保存の手動編集・再適用、オンライン再開、展示ビルド・配布、commit／pushは行っていない。

## 記録

- [公開receipt](../assets/cloudflare/deployment.json)・[全配信照合](../assets/cloudflare/public-release-qa.json)・[仲間と選択色](../assets/cloudflare/companions-live-qa.json)・[ソロ操作](../assets/cloudflare/solo-live-qa.json)・[初回描画](../assets/cloudflare/companion-entry-live-qa.json)。
- gate: `output/production-20261017-04/verification.json`。Chrome: `output/playwright/production-2026-10-17T02-17-48-799Z/`。
- 候補の色・仲間QA: `output/playwright/companions-candidate-20261017-04-r2/`。
- 公開Chrome: `output/playwright/companions-live-20261017-04/`・`output/playwright/solo-live-20261017-04/`・`output/playwright/companion-entry-live-20261017-04/`。色の画面は `phone-setup-colors.png`・`phone-menu-colors.png`・`phone-target-colors.png`、実Tabは `pc-selected-keyboard-focus.png`。
- Freeプラン画面／AX・ソースSHA・差分・旧receipt・公開ログ・管理情報・保存控え・実行用guardと観測用QA: `output/cloudflare-deploy/deploy-20261017-04/`。
