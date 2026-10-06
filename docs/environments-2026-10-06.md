# ローカル検証・展示・MMOの分離

共通ソースから用途ごとの配布物を作る。用途別のコピーや長期ブランチで別々にゲームを改修しない。

| 用途              | 起動・更新                                                                    | URL                     | 保存                                              | 手のカメラ認識   |
| ----------------- | ----------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------- | ---------------- |
| ローカル検証      | `npm run dev:local`。変更を監視して再ビルド                                   | `http://localhost:3100` | `.cro-magnon-save/environments/local`             | 有効             |
| 展示の1台確認     | `npm run build:exhibition` → `npm run preview:exhibition -- <完成フォルダー>` | `http://localhost:4173` | メモリー上。終了時に体験をリセット                | 有効             |
| MMOのローカル確認 | `npm run build:mmo` → `npm run preview:mmo`                                   | `http://localhost:8787` | `.wrangler/state/mmo`。CloudflareのローカルSQLite | 配布対象から除外 |

`npm run start:local` は監視なしのローカル検証。各用途は別プロセス・別ポート・別Originなので、ブラウザーの設定と再開トークンも混ざらない。ポートを使っている別プロセスを終了・置換する操作はしない。

従来の `npm start` / `npm run dev` と3000番の保存先は互換維持。今回のローカル検証は従来保存を読み込まない。モデル、保存の形式・バージョン、所属、`local-visibility.json`、公開用の人物除外設定は保持する。

## 展示の固定版

`npm run build:exhibition` は `output/environments/exhibition/build-<UTC日時>` に新しいフォルダーを作る。既存ビルドを上書きしない。完成したフォルダーを指定して確認する。

```powershell
npm run build:exhibition
npm run preview:exhibition -- output/environments/exhibition/build-<表示された日時>
```

1台確認ではキャラクターと開始場所を選ぶ展示用の画面・ルールで動く。手操作の機能は含むが、実カメラ・照明・体格・展示PCでの性能確認は別途必要。

完成フォルダーの `start-exhibition-host.bat` / `start-exhibition-client.bat` と既存の有線LAN運用を保持。モデル・コード・ランタイムはSHA-256、参加時はビルドIDで照合する。新しいソースの変更は、以前作ったフォルダーへ反映されない。展示の実機への配布はこのビルドとは別の明示的な作業。

今回作成した固定版は `output/environments/exhibition/verification-20261006-r05`。ビルドIDは `e7e308e949ed674c231dda9b4b2de374ff7cfca98c589e484befe873922edcdb`、547ファイル・107 GLB・789.5MiB。次のコマンドで起動できる。

```powershell
npm run preview:exhibition -- output/environments/exhibition/verification-20261006-r05
```

## MMOの機能と公開

`src/hand-controls.ts` を手操作の入口とする。MMO用ビルドはこの入口を認識コードへの依存がない無効実装へ置き換える。`src/motion-*`、専用CSS、`public/motion`、MediaPipeのJS・WASMを含めない。HTMLの専用CSS参照も外し、`Permissions-Policy: camera=(), microphone=()` を付ける。プレイヤーのURLや設定から再有効化する仕組みはない。

キーボード、パッド、スマホの移動パッド・行動ボタン、通常の自動視点設定は保持する。NPCのアニメーションや3D描画のカメラは、この手認識機能とは別である。

生成後、静的import、再export、動的import、モジュールWorkerのURLの依存を検査する。認識ファイルや認識APIが混ざったMMO版は検査で停止する。公開用の人物カタログが除外したモデルへの条件付きimportも、ビルド時に外す。

`build-profile.json` と生成された `src/build-profile.js` に用途・機能・日時を記録。MMOの確認起動は公開アセットとWorker両方のSHA-256とビルドIDを確認し、`wrangler dev --local` で起動する。本番のDurable Objectには接続しない。ソースを編集しても、明示的なMMOビルドを行うまでは確認版は更新されない。

`build:mmo` は既存モデルの正確なGLBを使う確認版。25MiBを超えるものは既存方式で分割する。これは性能改善を主張するビルドではない。公開用の `build:cloudflare` / `deploy:cloudflare` は従来の軽量化・公開人物設定とアカウント検査を保持する。既存の軽量化一覧には `/models/mae/model-r01.glb` など最新モデルが不足し、現時点で軽量化ありの公開ビルドは停止する。公開前に一覧の更新・性能確認が必要。

`preview:mmo` は公開操作を行わない。オンラインの本番更新は既存の公開手順で明示的に行う。展示の配布とオンラインの公開を一緒に実行するコマンドは追加していない。

今回のMMO確認版は476ファイル・105 GLB（5件は分割）・635.5MiB。ビルドIDは `53c3a4a28b912216fb3394a3b54468702f7820136627576e7c54bde92c975007`。洞窟の入れ子になった壁画テクスチャと、共通カタログに指定された9botのカード画像も両用途の梱包へ含める。

## 検証

新規テストは、用途・機能・保存先、MMO無効入口、実出力の依存関係、認識混入・欠落、起動設定、独立した保存復元、固定版の改変拒否を確認する。

関連61テスト（今回の新規9件を含む）が成功。型・strict・496 JS構文・依存境界・対象書式・差分空白を確認。実WorkerのWrangler dry-runも成功。結果は `output/environment-related-tests-final-20261006.log`。

全体の初回一括実行は980件中971件成功、舟・マンモス関連の既存9件が失敗。変更前のNodeエントリーと未変更のドメイン・テストを独立フォルダーで実行し、同じ9件を再現した。今回そのゲーム規則は変更していない。その後追加した壁画・bot画像の2件は上記の関連検証に含む。記録は `output/environment-tests-20261006.log` と `output/environments/baseline-20261006/test.log`。

実ブラウザー確認は `scripts/qa-environment-profiles.mjs`。ローカルと固定展示は保存なしの独立したNode、MMOは本番と別のメモリー上のMiniflareで確認する。カメラAPIを検査用に遮断し、実カメラ映像は取得しない。結果・画像は `output/playwright/environments-20261006` に保持する。

最終の実Chrome確認は `output/playwright/environments-20261006/final-r07/result.json` で成功。用途ごとの画面・手操作UIの有無、実MMOアセットの認識URL404・カメラ禁止、キーの移動と停止・攻撃・ジャンプ・メニュー、合成パッド、390×844のタッチ移動と停止・メニュー、2人同期と世界の分離、各版の仲間画像、再読み込みとURL指定からの再有効化拒否を確認した。ページ例外・コンソールエラー・MMOの認識アセット要求・カメラAPI呼び出しは0。

初回の梱包に不足した壁画・bot画像を修正し、検査のカード生成前の画像待ちを修正。複数の重い3D画面で検査中に再接続した際、古い接続記録だけでキーを送る待機条件も修正した。画面確認を順番に行い、現在の接続状態を待ってから操作する。MMOの2画面は同時接続を保持。途中の失敗・画像・展示ビルドは削除していない。単独の展示Chromeでもメニューを確認。負荷下の切断の発生条件・長時間の性能は別途検証が必要。

再実行例（dry-runは公開しない）：

```powershell
npm run build:mmo
node node_modules/wrangler/bin/wrangler.js deploy --dry-run --outdir output/cloudflare-dry-run
node scripts/qa-environment-profiles.mjs output/playwright/environments-check output/environments/exhibition/verification-20261006-r05
```

今回の作業で、オンライン公開・展示PCへの配布・通常3000番の手動再起動・既存保存の手編集・commit/pushは行わない。

実カメラ、展示PC・実スマホ、Safari、持続FPSは今回未検証。3000番は最後の読み取り照合で未起動だったため、起動・再起動はせず独立環境だけを確認した。
