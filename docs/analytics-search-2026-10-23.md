# Google Analytics・Search Console・検索向け配信設定

2026-10-23、ユーザー指定「Google AnalyticsとGoogle Search Consoleの設定もちゃんとして。ロボットとかサイトマップもちゃんとする。」に対応。

## Google側で完了したこと

- Chromeの既存ログインを使用。Googleアカウントの追加や権限委譲は行っていない。
- 既存のAnalyticsアカウント（57469670）内に専用プロパティ **CRO-MAGNON MMO**（560390167）を作成。日本時間・日本円・Games、目的はアクセスとエンゲージメント。既存サイトのプロパティは変更していない。
- Webストリーム **CRO-MAGNON MMO Web**（16185055742）、対象 `https://cromagnonmmo.com`、測定ID **G-4T2Y4X52RH**。拡張計測は無効。Google側のタグ設定は新規作成後の状態で、広告連携は追加していない。
- Search Consoleの **sc-domain:cromagnonmmo.com** を作成し、DNSのTXT方式で所有権確認に成功。
- Cloudflareの既存Freeアカウント・既存ゾーンに `google-site-verification=L3VGttZGn-Hr7TiFT9PWch6mFnxu8ebzwtZyPWC_fJ4` を1件追加（TTL Auto）。既存のWorker・www・MX・SPFを保持。GoogleへのDNSアカウントのアクセス許可は使っていない。この公開TXTは所有権維持に必要なため消さない。
- 専用GA4プロパティと上記Search Consoleドメインの連携を作成し、**LINK CREATED** と対応するストリームIDを読み戻した。

管理画面：[GA4](https://analytics.google.com/analytics/web/#/a57469670p560390167/admin)・[Search Console](https://search.google.com/search-console?resource_id=sc-domain%3Acromagnonmmo.com)。画面の証拠は `output/seo-20261023/`（`ga4-property.png`、`search-console-verified.png`、`search-console-property.png`、`ga4-search-console-linked.png`）。

## サイト側の変更

- `public/index.html`・`public/en/index.html` のcanonical・OG URL・共有画像・相互hreflangを `https://cromagnonmmo.com` に統一し、x-defaultを追加。言語ボタンでURLを切り替えた後もcanonical・locale・説明を一致させる。従来workers.devのブラウザー保存はそのまま。
- `public/robots.txt` は検索クローラーを許可し、ゲームAPI・WebSocket入口のみクロール対象外。描画に使うJS/CSS/画像/モデルをブロックしない。サイトマップの絶対URLを掲載。
- `public/sitemap.xml` は日本語 `/`、英語 `/en/`、日英のプライバシーページ `/privacy`・`/en/privacy` の4件と対応言語を掲載。実際の更新日ではないlastmodや、評価されないpriority等は追加しない。
- 公開ビルドにrobots・XML・計測スクリプト・CSS・日英プライバシーページを明示的に含める。XMLのMIME型をローカルとCloudflareで指定。実行資源はクロール可能なまま `X-Robots-Tag: noindex`。存在しないURLは404のまま。
- `cloudflare/site-config.json` にGoogle発行の測定IDを保存。秘密鍵・認証情報は含まない。Search ConsoleはDNS確認を採用したためHTML確認タグは未設定（null）。
- 初期HTMLの空の測定IDに、公開ビルドが検証してIDを注入する。localhost・従来workers.dev・その他のoriginでは保存済みの同意があっても計測しない。計測の例外がゲームの起動を妨げない独立したスクリプト。
- 同意前・拒否後はGoogleのスクリプトもpingも送らない。許可後のみGA4を読み込み、広告ストレージ・広告データ・広告パーソナライズをdenied、Google signalsも無効。手動のページビューを1回だけ送信し、言語の切替で重複しない。
- ページURLはクエリー・ハッシュを取り除き、参照元はoriginのみ。ゲームの名前・保存・持ち物は送らない。ホスト限定のGA Cookieを使う。同意はlocalStorageの専用キーに保存し、撤回するとCookieを削除し、Google公式の `ga-disable` で収集を停止。同じブラウザーの別タブにも撤回を反映。ゲーム中のタブを再読込せず、再同意でもタグを二重に読み込まない。
- 日英のプライバシー説明と、タイトルから開く計測設定へのリンクを追加。ゲームの進行用IndexedDBと既存設定は変更しない。

## 検証

- 関連41テスト合格。サンドボックス内のlocalhost通信制限による4件の失敗は、同じテストを通常環境で実行して解消した。
- `qa-site-analytics.mjs`：PC・390pxタッチ相当の実Chromeで同意前/拒否後の通信0、許可時のタグ1本とページビュー1回、URLの個人データ除外、広告設定、2タブでの同意撤回、ゲーム設定保持、local/旧originの計測無効を確認。Googleへのリクエストは全てQA用に遮断しており、Googleの実受信を証明する検査ではない。
- `qa-site-metadata.mjs`：隔離した公開候補をMiniflareで配信し、8入口の200・MIME・HEAD・ファイル/SHA台帳一致、canonical・Google ID、実行資源のnoindexと404を確認。
- `qa-og-language.mjs`：日英の静的メタ情報、言語の実ボタン・履歴・保存、タイトルから人物選択、エラー0・ゲームAPI/WebSocket通信0を確認。
- 最初の計測QAはテスト準備のabout:blankへのlocalStorage操作で失敗した。準備処理を修正して9項目合格。最初のメタ情報QAは仮Workerが意図的に500を返すため404検査が失敗した。実配信と同じASSETSへの転送に直して9項目合格。どちらも本番への通信・保存操作なし。
- 一括検証に本番デプロイが含まれるとの自動承認レビュー拒否が1回発生。スクリプトの全呼出しを読み直し、Wranglerが `deploy --dry-run` だけである証拠を提示して同じコマンドを再申請し、承認された。実デプロイへの迂回は行っていない。

最終production gateは **2026-10-23 09:00 JSTに全9段階合格**（Node.js **24.22.1**）。型・strict・714 JS構文・依存境界・書式、依存監査（脆弱性0）、全1,862テスト中1,858合格・失敗0・任意4件スキップ、Worker dry-run、実ChromeのPC/390pxタッチ・保存/再開・無操作2区間・排他・WebGL復帰・保存失敗/再試行・日英入口、検索メタ情報、計測同意を検証した。

最終候補は `output/seo-production-20261023-r02/`、ビルドID `da8c32bb626df7818d5d9b0789f8189132fa172a3a457c80a6b1009c5093e23b`。789ファイル（HTTP配信788ファイル＋`_headers`）・137.5 MiB・87 GLB。全配信ファイルのSHAとセキュリティ/キャッシュヘッダーをローカルCloudflare経由で照合済み。`verification.json` がstatus `passed`、全段階code 0。ブラウザー証拠は `output/playwright/production-2026-10-22T23-52-51-954Z/`。

これとは別に、最終候補の配信ディレクトリを直接指定した計測同意QAも9項目合格（`output/playwright/site-analytics-20261023-exact-r02/`）。元スクリプトと配信スクリプトのSHAは同じ `827e688d2e7290a4550dc41c775f66452972876f7dbcccc9460bca5f5958244d`。Googleの実ネットワークは遮断した検証なので、本番のGA4受信を証明したものではない。実スマホ・Safari・物理パッドは未検証。

初回の一括検証r01は既定のNode 24.16.0で動作したため参考記録として残し、以前のリリースと同じ検証済みNode 24.22.1をこのプロセスのPATHだけに指定してr02を実行した。システムのNodeや通常サーバーは変更していない。公開する場合は**r02の同一候補**を使い、r01を代用しない。

## 公開時の残作業

現時点ではサイト側の変更は**未公開**。GA4のデータ受信も未確認。Search Consoleの所有権とGA4連携は完了しているが、サイトマップはまだ提出していない。未配信URLを先に提出して取得失敗を作らない。

`AGENTS.md` の「デプロイはユーザーの明示的な指示でのみ行う」に従い、公開は別途指示後に行う。公開候補には、作業開始時からあった別作業の未公開壁画r44も含まれるため、公開対象を承認時に明示する。commit/push、通常3000/8787/4173の停止・再起動、ユーザー保存の編集、展示ビルドは実施していない。

公開後は公開候補と配信物のSHA・MIME・canonical・robots・サイトマップを照合する。`https://cromagnonmmo.com/sitemap.xml` をSearch Consoleへ送信し、Google側の取得結果を確認。使い捨てChromeで同意してGA4の実送信とRealtime/DebugViewを確認する。Googleによる検索への掲載やデータ処理の完了は、ファイル配信成功とは分けて扱う。

## 参照した一次資料

- [Googleのrobots.txtの説明](https://developers.google.com/search/docs/crawling-indexing/robots/intro)
- [サイトマップの作成と送信](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Search Consoleの所有権確認](https://support.google.com/webmasters/answer/9008080)
- [GA4設定項目](https://developers.google.com/analytics/devguides/collection/ga4/reference/config)
- [Googleの計測無効化フラグ](https://developers.google.com/tag-platform/security/guides/privacy)
- [ページビューの計測](https://developers.google.com/analytics/devguides/collection/ga4/views)
