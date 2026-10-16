# 仲間の複数選択・カメラ修正の公開準備（2026-10-17）

ユーザーの `deploy` により、現在の変更をソロ公開候補へまとめて検証した。**公開候補は全検証合格、デプロイは未実行。対象アカウントのWorkers Free表示の直前確認待ち。**

## 候補と現在の公開版

- 公開先: https://cromagnonmmo.com/ 。既存workers.dev URL、Worker `cromagnonmmo`、既存DO namespace `9071351c3ff8445d8ce2eebdb7822cec` を維持する候補。
- 候補: `output/production-companions-20261017-03/`。Build ID: `2951d4486b8473bfa249e7b7c8d3d285d716a9f762f716d218670ccc4646fbbd`。
- 公開ファイル783件・144,111,170 bytes、GLB 87件、Workerモジュール154件。配信対象の782件（`_headers` を除く）をローカルCloudflare実行環境でSHA・サイズ・ヘッダー照合。
- ベースコミット `4d93877808c715c8727099bfc3234e00c93c4918` と当時の未コミット変更を含む。公開準備時にはcommit／pushを行わず、ソース差分とSHAを保存した。その後の `git push` 指定で、検証済み52ファイルのSHA一致を再確認し、変更一式をコミット対象にまとめた。検証後に追加したのは作業記録のみで、公開候補のファイルは変えていない。
- 公開前の読み取り確認: 2026-10-17 01:35 JST、現在の公開versionは `42880994-b41b-494e-bb4d-4bb559d4dba6`、配信100%。既存namespaceと `SERVICE_ENABLED: "false"` を確認。この作業からのアップロードはない。

内容は、ソロの仲間11匹の複数選択・全選択／全解除、横送りの「見る・撫でる」対象切替、連続投げと保存復帰、地面際でカメラが真下へ落ちる問題と仲間の足元の補正、全9種類のdot表記、スマホの肉球アイコン。[仲間の仕様](solo-mascots-2026-10-16.md)・[カメラの原因と修正](companion-ground-camera-2026-10-16.md)。3Dモデル・リグ・動作クリップの交換はない。

## 検証

`npm ci --no-audit --no-fund` 後、`npm run verify:production -- --output-root=output/production-companions-20261017-03` が合格。

- 型・strict・705 JS構文・依存境界・書式・依存監査（脆弱性0）。全1,846テスト中1,842合格・失敗0・任意4件スキップ。
- 公開ビルド、Worker dry-run、全937候補ファイルのSHAと余分なファイルの不在。
- ソロ起動と保存、人物／服を変えた再開、2タブ排他、前面／背面各35秒の無操作、WebGL復帰、保存失敗と再試行、IndexedDB障害、実Chromeタッチ操作、日英入口。
- 同じ候補の追加Chrome12項目: PC／スマホ相当で11匹の全選択・全解除・戻る・個別変更・全11匹を1回ずつ連続投げ・全員呼び戻し・対象切替・猫だけを撫でる・保存とリロード。320px／390px縦画面と844px横画面の小窓、44px操作域、ネイティブタッチの横スワイプを確認。
- 実配信候補の全9種類のdot表記と肉球SVGを照合。PCとスマホの選択一覧・小窓・肉球の画面を直接確認。ブラウザー例外・ゲームAPI・WebSocket通信0。

最初のgateでは旧期待値3件が失敗した。人物の絵を期待していたテストを肉球へ修正し、モデル採用履歴では指定された9件の `name` 変更だけを明示的に許容した。各モデルの他の全フィールドと、共通／個別マニフェストの一致を引き続き検証する。関連36件が合格。

次のgateでは旧ブラウザーQAが、復帰済みの524を再クリックして解除していた。未選択のときだけ選ぶ手順に修正し、保存された選択配列も検証するようにした。同じ候補で7項目を確認してから、上記の最終gateを最初から実行し合格。失敗ログを削除せず保持した。

実行環境はWindows・Node.js 24.16.0・Chrome 155.0.8059.41。スマホはタッチエミュレーション。実スマホ・Safari・物理パッド・長時間性能は未検証。地面際の詳細な再現／修正比較は前記カメラ記録を参照し、今回の候補では関連回帰テストと通常の「見る」操作を確認した。

## 公開直前に残る確認

[公開手順](../CLOUDFLARE_DEPLOYMENT.md)は、デプロイ前15分以内に専用アカウントの[Workers plans画面](https://dash.cloudflare.com/a211102818d484cb668c6b62bebff3f9/workers/plans)で **Free / $0 / Current plan** を確認し、その実際の観測を記録することを要求している。保存済みの観測は2026-10-16 22:19 JSTで、今回には古すぎる。

CUAおよびnode_replが `failed to write kernel assets: The system cannot find the path specified. (os error 3)` で起動せず、リセット・再試行後も管理画面を読めなかった。ユーザーへ現在の表示を質問済み。アカウントの名前、zoneのFree契約、権限一覧、古い観測の日時を根拠にWorkers Freeの現在の確認済みとは扱っていない。現在の公開receiptとプラン確認時刻は更新していない。

既存の環境APIトークンには対象Workerの権限がなく、期限切れOAuthも最初は401になった。Wranglerの通常の認証確認で既存OAuthを更新した後、公開前のversion／namespaceの読み取りは成功。新規認証情報や追加権限は作っていない。

候補を再ビルドしない公開用guardと公開後の全配信ファイル／実Chrome検証を準備済み。`deploy-verified.mjs --check-only` で937ファイルとソース一致を確認した。実際の公開コマンドには新しいプラン観測が必要で、今回実行していない。確認後に同じ候補を公開し、公開後のSHA・version・ソロ操作を検証してから公開完了と記録する。

通常3000／8787／4173の停止・再起動、ユーザー保存の手動編集・再適用、オンライン再開、展示ビルド・配布は行っていない。ローカル保存2ファイルを公開前控えとして読み取り複製した。

## 証拠

- 最終gate: `output/production-companions-20261017-03/verification.json`。初回／第2回の失敗: 同名末尾 `-01`／`-02`。
- 全体のChrome証拠: 最終gate内 `verification.json` の `evidence`。
- 仲間の追加QA: `output/playwright/companions-release-20261017-01/`。旧QA修正後の7項目: `output/playwright/companions-qa-correction-20261017/`。
- ソース差分・SHA、公開前の管理API、旧receipt、保存控え、公開guard／公開後検証スクリプト: `output/cloudflare-deploy/deploy-companions-20261017-01/`。
