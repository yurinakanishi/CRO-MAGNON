# Cloudflare公開版・2026-10-01

公開URLを [cromagnonmmo.cro-magnon.workers.dev](https://cromagnonmmo.cro-magnon.workers.dev/) へ変更し、まるぃもを公開用のファイルと人物定義から除外した。ローカル版は全9人物を保持する。

- 公開バージョン: `2024e6ad-e30e-47de-9679-1daa52789715`。専用アカウント CRO-MAGNON Free の Workers Free / $0 / Current plan を実画面で確認してから更新した。
- 公開Worker自体をダッシュボードで `cro-magnon-free` から `cromagnonmmo` へ変更。既存のSQLite Durable Object namespace `9071351c3ff8445d8ce2eebdb7822cec` と保存を保持。1部屋 EMBER・同時5人のまま。外部DB/D1/R2や有料契約は追加していない。
- 旧URLは404。新URLのhealth/statusは200、検査終了後の19:36 JSTに参加者0/5を確認した。
- 公開ホームは「開発者 yuri」「友情出演 R-524」のみ。監修者の名前・QR・アイコン8ファイルは引き続き除外。ローカルは全クレジットを表示する。
- `cloudflare/public-release.json` の `credits` を `full` にしてFree確認後に再デプロイすると監修者を公開に戻せる。`excludedCharacters: ["maruimo"]` は独立した設定なので、クレジットを戻してもまるぃもは公開に入らない。
- `shared/character-profiles.mts` に全9人物を保持し、公開用には8人物だけの定義を生成する。モデルを読む前に除外し、まるぃものGLB・LOD・分割断片・顔画像・manifest・portrait CSS・専用octopus-poseをコピーしない。
- 公開用Workerも `dist-cloudflare-worker` の同じ8人物の定義を使う。静的出力とWorkerの521ファイル、および実アップロード用バンドルを監査。公開コードにまるぃもの識別子・名前がないことを確認した。偽の選択要求や旧保存の人物も正規化し、持ち物11個を保持したまま通常人物として復帰できる。検査はローカルだけで行い、非公開モデルのバイト列を外へ送っていない。
- 公開版は404ファイル・500.2MiB、81 GLB。25MiBを超える女性2人とHowkeyの3個だけ24MiB以下に分割し、元のSHA-256とバイト列を保持する。その他のモデル・UV・リグ・動作、洞窟の外部PNG3枚は保持。
- 新URLの5人接続・6人目拒否・移動・攻撃・再接続と全81 GLB SHAが成功。静的26ファイルのハッシュ、監修者8画像とまるぃもの旧7ファイルの404も確認した。
- 実Chromeで公開の8人物とHowkeyのオンライン1/5・3D表示を確認。警告/エラー0。ブラウザーのread-only評価範囲ではResource Timingを取得できないため、通信全件の観測とは扱わず、別の出力/バンドル監査とHTTP検査で除外を確認している。
- 全771テスト、normal/Cloudflare/strict型検査、依存境界、JS構文、変更ファイル書式が成功。ローカルSQLiteで旧worldVersion 2の復元・元JSONの完全一致バックアップ・再起動・利用上限・保存失敗時の停止が成功。
- 無料上限での停止を維持。継続移動の送信は公開だけ140msで、停止とキーボード/ゲームパッドの方向変更は即送信。別の無料上限へ先に達する可能性があり、長時間稼働や実端末性能は未検証。
- 検査用ブラウザーと接続は終了。通常3000番のサーバーは未再起動、ユーザー保存は編集していない。commit/pushなし。

初回の公開版ではまるぃもをすでに配信していた。今回の変更は現在の配信と新しいアップロードからの除外であり、受信済みブラウザーやCloudflareの非公開バージョン履歴の消去を意味しない。Preview URLは無効のまま。

手順: [CLOUDFLARE_DEPLOYMENT.md](../CLOUDFLARE_DEPLOYMENT.md)。通常の `public` ディレクトリを直接アップロードせず、除外監査付きの `npm run deploy:cloudflare` を使う。

記録: `assets/cloudflare/deployment.json`、`live-qa.json`、`public-release-qa.json`、`character-privacy-qa.json`、`persistence-qa.json`。
追加検査: `output/cloudflare-deploy/tests-with-public-exclusion-final.log`、`cromagnonmmo-readonly-check.json`、`cromagnonmmo-browser-qa.json`、`deploy-public-exclusion.log`。
画像: `output/cloudflare-deploy/screenshots/cromagnonmmo-eight-characters.png`、`cromagnonmmo-howkey.png`、`free-plan-url-change.png`。
前の公開記録と手順は `output/cloudflare-deploy/deployment-before-url-change.json`、`release-notes-before-url-change.md` へ保持した。

CLIでは実行プロセス内だけCLOUDFLARE_API_TOKEN/API_KEYを外し、既存Wrangler OAuthを使用。認証情報・権限・契約は変更していない。
