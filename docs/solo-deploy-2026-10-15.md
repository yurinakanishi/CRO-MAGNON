# ソロ版の公開 — 2026-10-15

ユーザーの「Deploy」により、同じ公開URLへソロ版を配信した。

- URL: https://cromagnonmmo.cro-magnon.workers.dev/
- Worker: `cromagnonmmo`
- 公開時刻: 2026-10-15 16:08 JST
- Version: `cdbad4d2-3256-426a-a994-1eaee7d0633c`、配信割合100%
- 前版: `173d5535-fec8-44d3-8b1d-e5bd839cf59c`
- Source commit: `f8e42a8ce37173bd5dacbc915285f47c9349338f`
- Build ID: `db33c3d41d1116428127b29be707250f7d0910b45a6d148ba36e5f1a8b36e25b`
- 公開物: 752ファイル、133.5 MiB、86 GLB、分割GLBなし、人物13人、人物写真117枚・マスコット写真11枚、クレジット `full`

## 公開した動作

タイトルは「ソロプレイで始める」が有効、「オンラインで始める」が無効。人物と服の色を選び、別画面で仲間を1匹選ぶ。仲間画面から戻ると人物の選びかけを保持する。人物名、女性・女の子の並び、実物から撮影した色別・実寸比の写真、洞窟の照明と壁画ローディング、朝日南さんを含むクレジットも今回の公開物へ含めた。猫耳のクノイチ・刀とネアンデルタール人は配信対象外のまま、復元用素材をリポジトリに保持する。

ゲームはブラウザー内の専用Workerで進み、IndexedDBへ自動保存する。設定などの小さな値はlocalStorageを使う。保存先は同じURL・同じブラウザープロフィール内で、サイトデータを削除すると保存も失われる。ソロの進行を以前のオンライン保存へ移したり、オンライン保存を読み込んだりしない。

`SERVICE_ENABLED: "false"`、`mode: "solo"`、部屋名 `SOLO`。通常のゲーム操作からゲームAPI・WebSocket・Durable Object・SQLを使わない。旧クライアントの `/api/status` と `/ws` もDO参照の前に503で拒否する。既存DOのbinding・class・migrationとnamespace `9071351c3ff8445d8ce2eebdb7822cec` は変更せず、従来のオンライン保存を保持する。管理APIで識別子を照合したが、クラウド保存データ自体の読み取り・書き込みは行っていない。

## 公開手順と小修正

専用アカウント `a211102818d484cb668c6b62bebff3f9` のWorkers plans画面をChromeで開き、16:06 JSTに **CRO-MAGNON Free / Free / $0 / Current plan** を実見して記録した。料金プランの変更、有料サービスの追加は行っていない。

Prettierが `wrangler.jsonc` に追加する末尾カンマと、既存デプロイガードの `JSON.parse` が合わない点を修正した。同ファイルだけJSONパーサーを指定し、設定値を変えずに公開手順で読める書式を保つ。公開ファイルQAはソロ設定と128枚の写真、休止人物の404を確認するよう更新。ソロChrome QAに実際のHTTPS URLを指定する `--url` を追加した。人物監査レポートの固定値だったローカル定義数も、実際の名簿から取得するようにした。これらは配信ゲームの挙動を変更しない。

`npm run deploy:cloudflare` のガード付きビルド、Wrangler dry-run、公開人物監査、実デプロイが完了。233ファイルを新規アップロードし、518ファイルを再利用。既存OAuthを使い、環境に継承されていたAPI token/keyは実行プロセス内だけで外した。認証情報は記録に含めない。

## 検証

- `npm run check`: 型・strict・670 JavaScript構文・依存境界が合格。
- ソロ／Cloudflare関連11テストが全件合格。DOへの参照を例外にする検証と、実際の公開用handlerでの検証がともに参照0件。
- 公開185ファイルのサイズ・SHAが最終ビルドと一致。ブラウザーバンドル6ファイルと選択写真128枚を含む。休止人物・刀・まるぃも・不要なプロフィール画像等の確認経路は404。
- 実Chromeの独立したストレージで公開URLの6項目が合格。タイトル、人物・色・524の開始と自動保存、移動後の再読み込みと持ち物・位置の復帰、2タブ間の書き込み排他、390pxタッチ操作と青Dot、ゲームAPI・WebSocket通信0件。ブラウザーエラー0件。自動保存表示とスマホ幅のゲーム画面を目視。
- 公開 `/api/health` は200・solo・SOLO・最大1人。`/api/status` と `/ws` は503。管理API上も新バージョン100%と同じDO namespaceを確認。
- 通常3000番のhealth/statusは正常、参加者0人。デプロイ直前の6部屋・10保存セッションと内容一致。サーバーの手動停止・再起動、保存の手編集・再適用はしていない。

初回のローカルhealth確認は実行環境の通信制限でEACCESになり、読み取り権限を得た実行で再確認して合格した。展示用ビルド・ZIP・機体配布は行っていない。今回の公開作業に伴う追加commit/pushは行っていない。

実スマホ、Safari、物理パッド、長時間プレイ、ブラウザーの強制終了時の完全な保存は未検証。今回の公開QAは独立したテスト用ブラウザーストレージを使い、ユーザーのブラウザー保存を変更していない。

## 記録

- [公開receipt](../assets/cloudflare/deployment.json)
- [公開ファイルQA](../assets/cloudflare/public-release-qa.json)
- [ソロ公開QA](../assets/cloudflare/solo-live-qa.json)
- 詳細ログ・公開前後の管理API記録・旧receipt: `output/cloudflare-deploy/deploy-solo-20261015/`
- Chrome画像・結果: `output/playwright/solo-live-20261015/`
- [ソロ保存の設計・障害時検証](solo-play-2026-10-15.md)

以前の `assets/cloudflare/live-qa.json` とSQL persistence QAはオンライン版の過去の記録として残す。ソロ公開時にオンラインの5接続テストやクラウドSQL検証を実行しない。
