# 壁画・スマホ操作・仲間表示の公開（2026-10-16）

ユーザーの「commit push all changes、then deploy」により、未コミットの全変更212ファイルをまとめ、mainへpushした後、検証済みの公開ソロ版をデプロイした。制作途中の画像・原画・修復前の素材・検証記録も保持した。

## 公開した版

- URL: https://cromagnonmmo.com/ 。既存のworkers.dev URLも維持。
- ソース: `24a9b07fa9bba7b4a2bbc07e3dbc66029f872eb0`（`24a9b07`）。mainへpushしてから公開。
- 公開時刻: 2026-10-16 22:23 JST、配信割合100%。Version: `42880994-b41b-494e-bb4d-4bb559d4dba6`。
- 前版: `e21b1293-3a66-4d74-871b-4db196111e64`。Worker名と既存DO namespace `9071351c3ff8445d8ce2eebdb7822cec` は保持。
- Build ID: `3b22d16f865af778842dfa1f7b742a447e003099fdaff0e954388baa66eef194`。781ファイル・144,075,536 bytes（137.4 MiB）、87 GLB、人物14人、選択写真137枚、Workerモジュール154件。

壁画は人物と動物の種類ごとの共通縮尺を保ち、左右の壁へ連続して上下に重ねる構図を採用。原画と全24体を比較し、524の黄色い2点など7体の特徴を修復した。現在のポーズと配置は維持し、残り17体は再生成していない。[原画との比較と修復](../assets/camp-cave/identity-r41/README.md)・[構図と追加方法](cave-mural-continuity-2026-10-16.md)。

同時に、スマホの大きいアイコン・歯車からの設定入口・設定内のタイトル復帰・地図の正円ボタン、仲間を見る際の左下の戻る・ピンチ操作・524の初期画角、人物の頭上へ出す524のハートを公開した。[スマホ設定](touch-settings-2026-10-16.md)・[仲間の表示と操作](mascot-touch-view-2026-10-16.md)。3Dモデル、リグ、動作クリップの交換はない。

## 公開前の検証

`npm ci --no-audit --no-fund` 後、`npm run verify:production -- --output-root=output/production-mural-20261016-01` がすべて合格。型・strict、701 JS構文、依存境界、書式、依存監査（脆弱性0）、全1,832テスト中1,828合格・失敗0・任意4件スキップ、公開ビルド、Worker dry-run、実Chromeが対象。スキップはPython/Pillow環境未指定2件と任意ベンチマーク2件。変更したJS・CSS・テストの書式とstaged差分の空白検査も合格した。

同一の配信物について全ファイルSHA、ソロ設定、オンライン入口のDO参照前の拒否、開始・保存・再開・2タブ排他、前面／背面で各35秒の無操作、WebGL復帰、保存失敗と再試行、IndexedDB障害、390pxの実タッチ入力、日英入口を確認した。検証中にruntimeソースの更新はなく、コミット直前に候補のSHAを再照合。追加の変更は制作記録JSONの改行整形だけで、配信物に影響しない。

22:19 JSTに専用アカウントのWorkers plans画面を認証済みChromeで開き、CRO-MAGNON Freeと **Free / $0 / Current plan** を画面とアクセシビリティツリーで確認。15分以内の実見、push済みソース、許可済みの設定、全935配信候補ファイルのSHAを公開直前のguardで照合し、再ビルドせず公開した。31ファイルを新規アップロード、749ファイルを再利用した。料金設定や契約は変更していない。

既存OAuthの最初の読み取りは認証エラーとなったが、Wranglerで既存ログインを通常更新した後の再実行で成功。新規トークン・追加権限は作成していない。

## 公開後の検証

- 独自ドメインの配信対象780ファイル・144,075,237 bytesが全件SHA・サイズ一致。87 GLB・137枚の人物／仲間選択写真を含む。`_headers` は配信対象外。
- 従来のworkers.devは主要20ファイルとソロhealthを照合。新しいr41壁画4枚も対象。HTTP／wwwからの転送は英語ページのパス・クエリーを保持。
- 公開Chromeのソロ操作7項目が合格。開始・自動保存・人物／服を変えた再開・2タブ排他・390pxの別々の人物／仲間選択・実タッチの移動／中断停止／ジャンプ／設定からの保存終了を確認。PCと390pxの画面を目視。
- ブラウザー例外・ゲームAPI・WebSocket通信は0。healthはsolo・SOLO・最大1人。オンライン入口は503、非公開対象経路は404。
- 管理APIで新versionの100%配信と `SERVICE_ENABLED: "false"`、既存namespaceとbindingの保持を確認。クラウド保存自体は読み書きしていない。

実行環境はWindows・Node.js 24.16.0・Chrome 155.0.8059.41。スマホは390pxタッチエミュレーション。実スマホ・ネイティブSafari・物理パッド・長時間性能は未検証。Xカードの追加5ケースは今回再実行せず、前回の記録を履歴として残す。

通常3000番は稼働を維持し、終了時のhealth／statusはともに200。公開前にローカル保存2ファイルを控えた。稼働中の保存は更新されており、SHA不変とは扱わない。手動編集・古い保存の再適用・サーバー再起動はしていない。展示ビルド・ZIP・配布も行っていない。

## 証拠

- [公開receipt](../assets/cloudflare/deployment.json)・[全配信ファイル照合](../assets/cloudflare/public-release-qa.json)・[公開Chrome](../assets/cloudflare/solo-live-qa.json)。
- 公開候補とgate: `output/production-mural-20261016-01/`。公開前Chrome: `C:/Users/yurin/Desktop/projects/CRO-MAGNON/output/playwright/production-2026-10-16T13-13-49-285Z/`。
- 公開Chrome: `output/playwright/solo-live-mural-20261016-01/`。公開前後の管理API・guard・SHA・ログ・旧receipt・ローカル保存控え: `output/cloudflare-deploy/deploy-mural-20261016-01/`。
