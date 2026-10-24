# ソロ公開：壁画・採集・槍・黒曜石（2026-10-22）

ユーザーの「今のchanges all commit then push then release」と、続くCloudflareログイン／規約同意・リリースの明示承認により、**2026-10-22 22:48 JST** に既存の[公開サイト](https://cromagnonmmo.com/)へ反映した。**公開後の全配信ファイルのSHA、PC・タッチ操作、名簿の検証がすべて合格。同日22:59 JSTに公開receiptを確定した。**

## 公開した成果物

- ソース：`603e444e932f639b972f31371427fe578bf18859`。全変更80ファイルと、既存の大猿・槍・黒曜石の修正を `origin/main` へpushした後に公開。検証準備の記録は `ebb3727`。
- 同一候補：`output/production-20261022-01/`、ビルドID `8d067fe78294da77f5700abdbcc4d55cf3272606f56b017325ea40af95d345cd`。検証後の再ビルドなし。
- 公開783ファイル、144,153,077 bytes（137.5 MiB）、87 GLB、選べる人物14人、写真137枚、Worker 154モジュール。
- version：`7dcdb4a2-fc9b-4419-a805-c757fa0c8480`。管理APIで100%配信を確認。直前の実配信versionは `1f1e98c6-4e8c-4d32-865a-a7375cfb8873`（10月19日作成）であり、古い保存済みreceiptの10月16日versionを直前の実測とは扱っていない。
- 公開先：`https://cromagnonmmo.com/` と既存のworkers.dev。Custom Domain・DNS・Worker名は変更していない。

内容は、Jank0vicさんの共通名簿と洞窟の壁画r42、大猿が木・石を採れる距離の補正、自分の攻撃を持つ人物も槍を作って保管できる修正、西アジアの火山地帯の黒曜石3か所。前回の公開準備に含まれたソロの仲間の複数選択・カメラ修正や、PCの文字付き行動ボタンもこのソースに含まれる。3Dモデルの新規制作・交換はない。[壁画制作](../assets/camp-cave/jank0vic-r42/README.md)・[採集と黒曜石](changelog/2026-10.md)。

## 料金・保存・公開方法

22:45 JSTに、専用アカウント `a211102818d484cb668c6b62bebff3f9` のWorkers plansを認証済みChromeで開き、アカウント名 **CRO-MAGNON Free** と **Free / $0 / Current plan** をAXと画面で実際に確認した。再開時には既存セッションが認証済みだったため、ログインボタンの再操作は不要だった。プラン・請求・権限の変更なし。Wranglerの既存OAuthを通常更新して公開した。

`deploy-verified.mjs` が、ソース・設定・一括検証結果・937候補ファイルのSHA／サイズ・余分なファイルの不在・15分以内の実際のFree観測を照合してから、同じ候補をアップロードした。追加／変更した静的ファイルは24件、既存758件を再利用。Workers Paidや従量課金サービスを追加していない。

ソロのみで `SERVICE_ENABLED: "false"` を維持。既存のDO binding／class／migrationと保存namespace `9071351c3ff8445d8ce2eebdb7822cec` は公開前後の管理APIで一致した。オンラインの保存の読み出し・編集・移行はしていない。プレイ中の保存先はブラウザーのIndexedDB。

ローカル保存は公開直前に読み取り控えを作成し、2ファイルとも公開後のSHAが一致した。通常3000／8787／4173の停止・再起動、保存の手動編集・再適用、オンライン再開、展示ビルド・配布は実施していない。

## 検証

公開前はNode.js 24.22.1で `npm ci` と一括production gateが合格。型・strict・709 JS構文・依存境界・書式・依存監査（脆弱性0）、全1,857テスト中1,853合格・失敗0・任意4件スキップ、公開ビルド、Worker dry-run、ローカルCloudflareで全782配信ファイルのSHA・ヘッダー、実ChromeのPC／タッチ・保存／再開・無操作・2タブ排他・WebGL復帰・保存失敗／再試行・日英入口を確認した。[公開準備と証拠](release-preparation-2026-10-22.md)。

公開後はカスタムドメインの全782配信ファイル（GLB 87件、144,152,778 bytes。配信されない `_headers` を除く）のSHA・サイズ・`nosniff`、GLBのimmutable cacheがすべて一致した。workers.devの主要22ファイルもSHA一致。両方でソロhealthと、オンライン入口503・非公開／休止モデルや私有パス404を確認した。

初回の全件照合は同時取得6件・45秒のリクエストで通信タイムアウトとなった。SHA不一致は検出されていない。同時取得2件・90秒・通信失敗のみ最大3回の再試行とし、対象ファイル・再試行・部分結果を記録する検証へ修正した。サイズ・SHA・ヘッダーの不一致は再試行で隠さず失敗する。**最終の全782件と主要22件はいずれも再試行0回で合格**した。最初の失敗とスクリプトは削除せず残した。

実Chrome **155.0.8059.85** の公開サイトで以下が合格した。ブラウザーは毎回独立した保存を使い、配信コードやゲーム状態を差し替えていない。

- PCのソロ開始、自動保存、タイトル／リロードからの同じ人物・持ち物・位置での再開と服の変更、2タブの書き込み排他。
- タッチ390×844の人物と仲間の別画面、戻ったときの選びかけの保持、開始、ネイティブタッチによる移動・中断・ジャンプ、メニュー保存。
- タイトル18人／洞窟17人の名前・X・順序一致、画像や補足文字の不在、yuriの洞窟一覧からの除外、カードへのスクロール到達。Jank0vicさんの実配信画像149,214 bytesのSHA一致と、PC／タッチでの世界への開始。
- 上記のプレイQAのゲームAPI・WebSocket通信0、ブラウザー例外／console error 0。
- PCのプレイ画面・390pxのプレイ画面・新しい名簿の保存画面を直接目視し、人物・文字付きボタン・タッチ操作の表示とはみ出しがないことを確認した。

Node／.NETの直接HTTPS読み取りは証明書チェーンの検証で失敗したため合格に数えず、Chromeの標準TLS検証で確認した。`ignoreHTTPSErrors` や証明書検証の無効化は使っていない。実スマホ・Safari・物理パッド・性能比較・長時間性能・複数人接続は未検証。

## 証拠

- 公開receipt・配信／ブラウザーQA：`assets/cloudflare/deployment.json`、`public-release-qa.json`、`solo-live-qa.json`。
- 一括検証とSHA台帳：`output/production-20261022-01/verification.json`、`cloudflare-build.json`。
- 公開前後のversion／配信割合／namespace、Freeの画面、uploadログ、全ファイル照合：`output/cloudflare-deploy/deploy-20261022-01/`。旧receiptと最初の照合失敗も保持。
- 公開の実Chrome：`output/playwright/solo-live-20261022-01/` と `output/playwright/live-cast-20261022-01/`。
- 保存控えと前後SHA：同じ公開証拠内の `save-before-upload/` と `local-state-after-deploy.json`。
