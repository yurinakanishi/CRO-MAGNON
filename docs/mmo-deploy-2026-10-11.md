# MMO公開版を更新（2026-10-11）

ユーザーの「wanna deploy to cloudflare mmo」により、現在のmain `e1ebeca5b1f1befad1cf41aa5f580364b0016be0` を既存の[公開MMO](https://cromagnonmmo.cro-magnon.workers.dev/)へデプロイした。公開日時は2026-10-11 15:10 JST、バージョンは `2627baca-0d33-4952-a0b6-09953cac8b0d`。前版は `d525625d-e3bc-4438-b845-1777a28e9992`。人物・世界の配信用軽量化、起動時のワールド計算の事前生成、入場準備の短縮、音源・BGMの更新、現在の人物・仲間・クレジット設定を反映した。

## 公開先と保存

専用アカウント `a211102818d484cb668c6b62bebff3f9`（CRO-MAGNON Free）のWorkers plans画面をChromeで開き、15:02:15 JSTに **Free / $0 / Current plan** をAXと画面で確認した。実際の確認時刻を `assets/cloudflare/account-verification.json` へ記録し、15分の鮮度検査と公開先のguardを持つ通常の `npm run deploy:cloudflare` を実行した。

Worker名 `cromagnonmmo`、binding `GAME`、class `FreeGameRoom`、migration `v1` を保持。公開前後のバージョンAPIでDurable Object namespace `9071351c3ff8445d8ce2eebdb7822cec` の一致を確認した。契約変更、有料サービス追加、保存データの手編集はない。既存Wrangler OAuthを使用し、当該コマンドの環境変数だけでAPI token/keyを除外した。

## ビルドと配信

- ビルドID: `9b34ad3b3a5ad39cc07c868e795f7bd46e38a20c5d9d3e104cfc3e792a50d1ae`
- 公開ファイル593件、126,702,775 bytes（120.8 MiB）、公開人物7人、クレジット `full`。まるぃもは公開対象外、Howkeyは選択人物から除外された休止中の仲間という既存設定を維持。
- 配信用GLB81件、66.1 MiB。正本101件の変換・LOD同梱を含む。分割配信0件。元モデルは変更しない。
- Workerモジュール144件。bundle 5,248.59 KiB、gzip 694.16 KiB、Wranglerが報告した起動時間133 ms。
- 静的ファイル404件をアップロード、188件を再利用（`_headers` は配信設定）。バージョンの配信率100%を公開後のAPIで確認。

最初の検証用ビルドとguardによる再ビルドを比較し、144 Workerモジュールと実Worker bundleのSHAが一致した。bundle SHA256は `630e95b45cb74d5b71d77f5c7fd723eaa57666c54e05c6f8cb68b3732c37b685`。ブラウザー側の差分はビルド情報とそれを含むバンドル名・参照だけで、公開後に最終ビルドのSHAを再照合した。

`qa-cloudflare-release.mjs` が旧起動ファイル `/src/boot.js` を固定で期待していたため、実ビルドの `browserBundle.entry` と全出力ファイルを確認するよう修正した。現在の `/src/boot-bundle.js` と2つのchunkも配信サイズ・SHAの検査に含める。一時ポートのローカル静的配信と公開URLの両方で合格した。

## 検証

- 全体テスト: 1,463件中1,459件合格、失敗0、条件付き4件スキップ。
- `npm run check`: 型・strict、608 JS構文、依存境界に合格。変更したQAスクリプトの構文と書式も合格。
- 公開人物の除外監査: 737ファイルと実Worker bundle、公開7人物とローカル9定義、旧外観の正規化と持ち物保持を確認。
- 独立したローカルSQLite emulator: 旧v2 checkpointの復帰、元checkpointの完全一致バックアップ、持ち物とキャンプ、利用上限、保存失敗時の停止と前checkpoint保持に合格。既存のRPC stub破棄警告はログに残るが、検査は成功。
- 空室を確認して実WebSocketの5人接続、6人目の拒否、移動、攻撃、再接続を確認。公開GLB81件のSHAが全件一致し、テスト接続をすべて明示終了した。
- 公開静的52ファイル（起動バンドル3件を含む）のサイズ・SHA、洞窟画像10件、監修者4人の画像とクレジット、QRと非公開人物のURL拒否に合格。
- 実Chromeでタイトル、7人物の選択、洞窟の3D描画、通常世界へのオンライン入場と描画を確認。警告・エラーログ0。メニューからタイトルへ戻して検証接続を閉じた。
- 15:13:43 JSTの最終health/statusは200、EMBERは0/5人、worldVersion 4。

性能の比較測定、長時間プレイ、実スマホ、Safari、物理パッド、音の試聴は今回行っていない。Chromeの確認はデスクトップでの入場・描画のスモーク検証であり、実機の性能保証ではない。

## 記録

`assets/cloudflare/deployment.json` と各QA記録を更新した。以前の記録は `output/cloudflare-deploy/deploy-mmo-20261011/*-before.json`、ビルド・比較・テスト・CLIログ・公開前後の版情報は同じ作業フォルダーに保持する。ブラウザーのAXと画面確認はこのチャットのCUA出力に記録されている。

通常3000・ローカルMMO8787・展示4173は準備時に停止状態だった。既存サーバーを停止・再起動せず、公開用の標準ビルド出力を更新し、前の出力はビルダーの保管先へ残した。展示ビルド・配布、commit、pushは行っていない。
