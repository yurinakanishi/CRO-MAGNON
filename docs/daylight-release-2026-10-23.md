# 2026-10-23 洞窟の人物・仲間を昼の光で照らす変更の公開

ユーザーの「追加の変更をamendし、pushしてデプロイ」に従い、洞窟照明の実装・テスト・検証記録を `7771c74c3cb3335275da93547022c545eb5a93b5` にまとめ、GitHubの `origin/main` へpushした。**2026-10-23 10:49 JST** に [公開サイト](https://cromagnonmmo.com/) へ反映し、バージョン `7223c0f8-2c6e-4eb2-a1b4-92463cbdb840` が100%配信されていることをAPIで確認した。

人物と仲間は洞窟内でも屋外の昼の光を受け、洞窟の松明や焚き火では顔が白飛びしない。岩・壁画・床には従来どおり松明が当たる。ソロ・ブラウザー内のIndexedDB保存を継続し、オンライン入口は無効。

## 公開前

- 10:47 JSTに正確な公開先アカウントのダッシュボードを実際に開き、CRO-MAGNON Free / Free / $0 / Current planを確認した。プラン・課金・権限は変更していない。
- Node 24.22.1で `npm ci` と `npm run verify:production -- --output-root=output/daylight-production-20261023-r01` を実行し、全9段階合格。型・strict・JS構文・依存境界・書式・依存監査（脆弱性0）・1,867テスト（合格1,863、失敗0、任意スキップ4）・公開ビルド・Worker dry-run・実ChromeのPC/タッチ/日英/保存/排他/無操作/復旧/検索メタ/同意を確認した。
- 検証済み成果物のbuildIdは `86f5a029353687c97aebe78faa70ab11d61c9587a0a5cbbd7131756db61cef9e`。amend時の追加は記録のみで、検証済みランタイムとの差分がないこと、全ファイルのSHA、設定、Freeの確認時刻をガードで照合し、再ビルドせずに同じ成果物をアップロードした。
- 公開ビルドは790ファイル、約137.5 MiB、87 GLB、人物14種類。fullクレジットと公開除外を維持。元のGLBは変更していない。

## 洞窟照明の実Chrome確認

大人の男性・ちびの女性・子グマずきんの女の子・ライオンの男の子と524を、アプデの洞窟・ゲーム中の焚き火の近く・入口近くで撮影した。最初の再実行は、ランダムな待機アニメーションの異なる時刻を比較した男性の左右差判定で失敗した。この失敗は `output/playwright/daylight-release-20261023-01/report.json` に保持した。

元のQAをコピーし、撮影直前に全員のIdle_Loopを0秒へ揃えた独立した検証では全4種類・全項目合格。松明の点灯/消灯で顔と524の測定値が完全一致し、白飛び0。男性の左右差は洞窟1.65倍／屋外1.61倍。屋外では、追加照明を使った顔と従来の場面照明だけの顔が全画素一致した。松明は引き続き洞窟を照らし、ブラウザーエラー・失敗リクエスト0。公開ランタイムはこの再検証のために変更していない。

証拠と実行用コピー：`output/playwright/daylight-release-controlled-20261023-01/`、`output/cloudflare-deploy/deploy-daylight-20261023-01/qa-controlled-daylight.mjs`。元の非固定QAには待機ポーズに依存する判定の揺れが残る。

## 公開後

- 実Chromeの標準TLS検証で、独自ドメインの配信789ファイル（`_headers`を除く全件、87 GLBを含む）のSHA・サイズが台帳と一致。再試行0。既存workers.dev URLでも主要22ファイルとsolo healthが一致した。
- 公開ソロのPC・390pxタッチ7項目が合格。実際の同意拒否操作の後、開始・人物/服/仲間・自動保存/再読込・別タブ排他・ネイティブタッチ移動/キャンセル/ジャンプ/保存を確認した。ブラウザーエラー・ゲームAPI要求・WebSocket要求0。
- `/api/health` は `cloudflare-free / solo / SOLO / maxPlayers: 1`。`/api/status` と `/ws` は503。まるぃも・クノイチ・ネアンデルタール人の旧公開入口などは404。
- `SERVICE_ENABLED: "false"` と既存DO名前空間 `9071351c3ff8445d8ce2eebdb7822cec` を保持。クラウドの保存データは読み出し・編集していない。既存ローカルサーバーは再起動せず、`.cro-magnon-save/` の2ファイルは直前の退避とSHAが一致。展示用ビルドや配布物は作成していない。

公開記録：[デプロイ情報](../assets/cloudflare/deployment.json)、[全ファイル照合](../assets/cloudflare/public-release-qa.json)、[PC・タッチ確認](../assets/cloudflare/solo-live-qa.json)。成果物と検証結果は `output/daylight-production-20261023-r01/`、アップロード・前後バージョン・保存退避は `output/cloudflare-deploy/deploy-daylight-20261023-01/`。PC/タッチの実画面は `output/playwright/solo-live-daylight-20261023-01/`。以前の成果物と証拠は保持した。

検証範囲はWindowsとChrome 155.0.8059.85のPC・タッチエミュレーション。実スマートフォン・Safari・物理パッド・長時間の性能比較は未検証。GoogleのRealtimeやSearch Consoleは今回再操作せず、[同日09:08の公開時の検証記録](seo-release-2026-10-23.md)を保持した。
