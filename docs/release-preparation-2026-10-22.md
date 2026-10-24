# 現在の変更のコミット・pushとソロ公開準備（2026-10-22）

**22:59 JST追記：ユーザーのログイン／規約同意・公開承認を受け、Free表示の実際の確認後、同じ候補を22:48 JSTに公開した。公開後の全配信SHAと実Chrome検証も合格。[公開完了記録](solo-release-2026-10-22.md)。以下は21:08 JST時点の準備と承認待ちの記録。**

ユーザー指定「今のchanges all commit then push then release」。現在の全変更をコミットし、既存の未pushコミットとともに `origin/main` へpushした。**公開候補は一括検証・追加Chrome検証に合格。Cloudflareログインの承認と公開直前のWorkers Free表示の確認待ちで、アップロードは未実行。**

## ソースと候補

- ソースコミット：`603e444e932f639b972f31371427fe578bf18859`（80ファイル、Jank0vicさんの共通名簿・壁画・制作資料・関連テスト）。既存の `ab70f43`（大猿の採集・手に持てない槍の保管・火山地帯の黒曜石）もpush済み。
- 公開候補：`output/production-20261022-01/`。ビルドID `8d067fe78294da77f5700abdbcc4d55cf3272606f56b017325ea40af95d345cd`。
- 公開783ファイル、144,153,077 bytes（137.5 MiB）、87 GLB、Worker 154モジュール。ソロのみ、クレジット `full`。既存の非公開・休止モデルの除外を維持。
- 公開先は既存の `https://cromagnonmmo.com/` とworkers.dev。Worker名・DO binding／migration・保存namespace・Custom Domain設定は変えていない。
- 2026-10-17の公開準備候補を上書きせず、今回のソースから新しい候補を作成した。

## 検証

Windows、Node.js **24.22.1**、実Chrome **155.0.8059.85**。既存の検証済みNodeランタイムをこのプロセスのPATHにだけ指定した。通常サーバーは停止・再起動していない。

`npm ci --no-audit --no-fund` 後、`npm run verify:production -- --output-root=output/production-20261022-01` が合格。

- 型・strict・709 JS構文・依存境界・書式、依存監査（脆弱性0）。
- 全1,857テスト中1,853合格・失敗0・任意4件スキップ。
- 公開ビルド、Worker dry-run、937候補ファイルのSHA／サイズ・余分なファイルの不在。Cloudflareのローカル実行環境で、配信対象782ファイル（`_headers` 除外）のSHAとセキュリティ／キャッシュヘッダーを照合。
- 実ChromeでPC／390pxタッチ、初回開始・服を変えた保存再開・2タブ排他・前面／背面各35秒の無操作・WebGL復帰・実タッチ移動とジャンプ・保存失敗と再試行・IndexedDB障害・日英入口を確認。ブラウザー例外・ゲームAPI／WebSocket通信0。
- 同じ公開候補を変更せず、追加の実ChromeでPC 1440×900／タッチ390×844のタイトル18枚・洞窟17枚の名前・X・並び順、プロフィール画像不在、yuriの洞窟一覧からの除外、スクロール到達、世界への開始を確認。Jank0vicさんの配信テクスチャ（149,214 bytes、SHA `eddda2420b627b3e5adbce26e1cc7cf0554448e8da72f26ddcf47901573b29d7`）を実際に読み、SHA照合に合格。原画との似姿・共通縮尺の比較は[制作記録](../assets/camp-cave/jank0vic-r42/README.md)の範囲であり、この追加QAをその代わりとは扱わない。
- 上記のPC名簿・スマホのプレイ画面を直接目視した。実スマホ・Safari・物理パッド・長時間性能・複数人接続は未検証。
- ローカル保存2ファイルは作業前後でSHA一致。読み取り控えだけを作り、保存の手動編集・再適用はしていない。

## 公開前に残る確認

[公開手順](../CLOUDFLARE_DEPLOYMENT.md)は、専用アカウント `a211102818d484cb668c6b62bebff3f9` のWorkers plansで、公開前15分以内の **Free / $0 / Current plan** を実際に確認することを要求する。2026-10-16の既存観測を更新したことにはしていない。

利用可能なChromeの一方は別アカウントしか表示せず、専用アカウントのページはアクセス不可。もう一方ではCloudflareの既存Googleログイン入口を表示できたが、**「Continue as」の操作は自動承認レビューに拒否された**。画面の「続行で利用規約へ同意」という文言のため、ログイン／規約同意の明示的な承認が必要との理由。クリックは実行されておらず、代替のログインや認証更新で回避していない。既存OAuthによる管理APIの読み取りも401になった。

公開版の匿名読み取りは別途実施。2026-10-22 **21:06 JST**、Chromeの標準TLS検証でタイトル表示とソロhealth（`mode: solo`、`room: SOLO`、`maxPlayers: 1`）、現在の洞窟マニフェストを確認した。公開版はr41の素材のまま。Node／.NETの直接読み取りは証明書チェーン検証に失敗したため合格とせず、Chromeでは証明書検証の無効化を一切せず読めた。公開後の全ファイル照合もChromeの通常TLS経由で行うスクリプトを用意した。

## 証拠と再開

- 一括検証：`output/production-20261022-01/verification.json` と各工程のログ。
- Chrome：`output/playwright/production-2026-10-22T11-56-34-490Z/`。
- 追加名簿QA：`output/playwright/release-cast-20261022-01/`。
- 公開準備：`output/cloudflare-deploy/deploy-20261022-01/`。ソースコミット、旧receipt、保存控え、ログイン画面、公開前の匿名観測を保持。
- `deploy-verified.mjs --check-only` は、937候補ファイル・ソース一致・設定を照合して合格した。実公開には新しいFree観測が必要で、guardを弱めていない。公開用コマンドはこのguardを通して同じ候補をアップロードし、再ビルドしない。
- 公開後は管理APIのversion・100%配信・既存namespaceを照合し、`verify-live-browser.mjs https://cromagnonmmo.com` とworkers.devの `--smoke`、`qa-solo-play.mjs --url=https://cromagnonmmo.com/` で配信SHAと実動作を検証してから公開receiptを更新する。

展示ビルド・配布、オンライン再開、有料サービスの追加、通常3000／8787／4173の停止・再起動は実施していない。
