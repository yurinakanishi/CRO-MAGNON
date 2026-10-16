# 最新mainのソロ版公開と独自ドメインの接続 — 2026-10-16

ユーザーの「git pull、Namecheapで購入したドメインの設定、最新mainをデプロイ」の依頼により、最新mainの公開と `cromagnonmmo.com` の接続・検証を完了した。最初はNamecheapのログイン待ちとなったが、ユーザーのログイン完了後に設定を続行した。

## 公開した版

- 公開URL: https://cromagnonmmo.com/
- 従来のURLも維持: https://cromagnonmmo.cro-magnon.workers.dev/
- 公開時刻: 2026-10-16 13:37 JST、配信割合100%
- Worker: `cromagnonmmo`、専用アカウント `a211102818d484cb668c6b62bebff3f9`
- Version: `715d3160-6fac-4396-bf74-275f10bba71a`
- 前版: `cdbad4d2-3256-426a-a994-1eaee7d0633c`
- Source commit: `a410715ce8594a1c2481e680b1a3702ea08690b9`
- Build ID: `00d3f8c78cdf8b28e0be0dab398f54dc90466f6eb5ba21c1c4084cbdec1aabaa`
- 公開物: 778ファイル・143,742,899 bytes（137.1 MiB）、87 GLB、分割GLBなし、人物14人、選択写真137枚、クレジット `full`

作業開始時のmainは変更なし。`git pull --ff-only` で `4a13780` から `a410715` へ進めた。ゲームコードは追加変更せず、資源の近距離表示、ソロの保存失敗時の再試行、無操作による退出を行わない修正など、取り込んだmainをそのまま公開した。commit／pushは行っていない。

## 公開前の検証と配信物の同一性

`npm ci --no-fund` 後、`npm run verify:production -- --output-root=output/production-domain-20261016` が全段階合格した。

- 型・strict、682 JavaScript構文、依存境界、書式が合格。npm auditは脆弱性0件。
- 1,798テスト中1,794合格、失敗0、条件付き4件スキップ。内訳はPython/Pillowの任意2件と、`CRO_BENCH` の任意ベンチ2件。
- 公開用ビルド、Worker dry-run、配信物の全SHA、非公開モデルの除外、ソロ用handlerが合格。旧オンラインの入口はDOを参照する前に拒否。
- 実ChromeでPC・390pxタッチ操作、35秒の無操作を前面と別タブで各1回、保存／再開、2タブ排他、WebGL復帰、保存エラーと終了再試行、IndexedDB障害、日英の入口を確認。エラー・ゲームAPI・WebSocket通信0件。

13:32 JSTに専用アカウントのWorkers plans画面をChromeで開き、**CRO-MAGNON Free / Free / $0 / Current plan** を実見した。画像と実見時刻を保存し、プランの変更や有料サービスの追加は行っていない。

今回は検証済みの分離した配信物を再ビルドせず、同じ `wrangler.json` で公開した。既存ガードと同じFreeプランの15分制限・アカウント・Worker・許可設定・保存binding／migrationを確認し、さらに検証成功、mainのcommit、コード差分がないこと、全931個の公開／WorkerファイルのSHAを照合してからWranglerを実行した。174ファイルを新規アップロードし、603ファイルを再利用。通常の `dist-cloudflare` と `dist-cloudflare-worker` は置き換えていない。

検証／配信に使った台帳は `output/production-domain-20261016/cloudflare-build.json`。既定の `qa-cloudflare-release.mjs` が読む `output/cloudflare-build.json` は今回の配信物へ切り替えていないので、後者を今回の公開版の台帳と混同しない。公開後の照合は前者を明示的に読む保存済みの `verify-live.mjs` で行った。

## 公開後の検証

- 配信対象777ファイル・143,742,600 bytesのサイズ／SHAが台帳と全件一致。87 GLBを含み、セキュリティヘッダーとGLBのimmutable cacheも合格。`_headers` は配信ファイルではないため対象外。
- 公開URLの独立したChromeで7項目合格。開始・自動保存・人物／服の色の変更を伴う再開、2タブ排他、390pxの人物／仲間の別画面、実タッチ入力による移動／中断停止／ジャンプ／保存終了を確認した。エラー・ゲームAPI・WebSocket通信0件。タイトル、ゲーム画面、保存表示、スマホ幅の画面を目視した。
- `/api/health` は200・solo・SOLO・最大1人。`/api/status` と `/ws` は503。休止人物・刀・まるぃも・私用ファイル等の対象経路は404。
- 管理APIで新versionの100%配信と `SERVICE_ENABLED: "false"` を照合。従来のDO namespace `9071351c3ff8445d8ce2eebdb7822cec` が公開前後で一致。クラウドの保存データ自体は読み書きしていない。

ChromeはこのWindows PCの155.0.8059.41。スマートフォンは390pxのタッチエミュレーションであり、実スマホ・ネイティブSafari・物理パッド・長期連続稼働は未検証。今回の公開後QAではfps比較や無操作試験を繰り返しておらず、それらの実施範囲は同じ配信物の公開前gateの記録を参照する。

通常3000／8787／4173番の手動起動・停止・再起動、保存の手編集や再適用、展示作成／配布は行っていない。ローカル保存はgit pull後・公開前に控えた。この実行にはpull直前の控えがなく、pull前後の保存内容一致は主張しない。最初の通常サンドボックスでのpullとnpm ciは環境の書き込み／通信制限で失敗し、許可された実行で完了した。これらを成功した検証に数えていない。

## 独自ドメインの接続と検証

Namecheapの既存タブはログイン画面へ転送され、Chromeの拡張機能のログイン補助画面が自動操作を止めたため、ユーザーへログインを依頼した。完了の返信後、別タブのログイン済みダッシュボードで購入名が `cromagnonmmo.com` であることを確認した。認証の迂回やパスワードの変更は行っていない。

Cloudflareの同じ専用アカウントへ無料zone `aea4d49230f05d07c13065cdb428616a` を作成し、Namecheapのnameserverを `dns1.registrar-servers.com`／`dns2.registrar-servers.com` から `leif.ns.cloudflare.com`／`nora.ns.cloudflare.com` へ変更・保存した。DNSSECは元から無効で変更なし。既存のメール転送先は0件。既定のMX 5件とSPFのTXT 1件を取り込んで保持し、公開DNSでも一致を確認した。

駐車ページ用のルートAレコードを、既存Worker `cromagnonmmo` のProduction Custom Domainへ置き換えた。`www` は同じルートへのproxied CNAMEとし、無料のSingle Redirect `WWW to HTTPS apex` を有効化した。ルールIDは `345d8394090042d995af08ca108978cc`、`https://www.cromagnonmmo.com/*` → `https://cromagnonmmo.com/${1}`、301、クエリー保持。Always Use HTTPSも有効化した。Bot Preference Syncは無効で、配信HTMLやrobots.txtの追加改変は設定していない。

Cloudflareのzone有効化とUniversal証明書のActiveを実見し、13:49 JSTにルートHTTPSの200を確認。Workers管理の証明書も自動発行されたが、Advanced Certificate Managerの購入・有効化はしていない。Freeプランを維持し、登録移管・新規購入・課金サービスの追加はない。

- 1.1.1.1と8.8.8.8の両方でNS、ルートIPv4／IPv6、wwwのIPv4、MX／SPFを確認。
- ルート／wwwの両ホストで、通常の検証を有効にしたTLS 1.3接続が合格。証明書のホスト名、有効期間、fingerprintを記録した。
- HTTPルート、HTTP www、HTTPS wwwから、`/en/?lang=en&qa=domain%20check` のパス／クエリーを保持してHTTPSルートの200へ到達。ループなし。
- 新ドメインの777ファイル・87 GLBが同じ公開台帳のSHAと全件一致。ソロhealth、旧オンライン入口の503、非公開経路の404も合格。
- 新ドメインの独立した実ChromeでPC・390pxタッチの7項目合格。開始・自動保存・再開・排他・移動／中断停止／ジャンプ／保存終了を確認し、エラー・ゲームAPI・WebSocket通信0件。新URLを通常のChromeでも開いてタイトルを目視した。

準備中のTLSハンドシェイク未完了は成功に数えず、証明書発行後に通常の検証で合格した。DNS診断の初回はNodeのMX応答に追加された`type`属性によって検査側が失敗し、必要なexchange／priorityを照合するよう修正して全項目を再実行した。DNS設定をこの検査のために変更してはいない。

ドメイン接続によるゲームコード変更・再ビルド・Workerの再デプロイはなく、versionは `715d3160-6fac-4396-bf74-275f10bba71a` のまま。Custom Domainはdashboard管理とし、`wrangler.jsonc` に `route`／`routes` を加えていない。後の公開でもこの管理方針を保持する。

ソロのIndexedDB保存はURLのoriginごとに別で、従来のworkers.dev側の保存と、新ドメイン側の保存は共有されない。従来URLを有効なまま残し、ユーザーの保存を移行・削除していない。wwwからはルートへ転送し、新ドメインの入口を統一した。

公開記録・JSON・新規文書の書式と `git diff --check` は合格。`README.md` と `docs/README.md` の全体書式は変更前からPrettierの警告があり、既存の表を一括整形せず、追記・更新した段落の書式が合格することを別に確認した。比較は `output/cloudflare-deploy/deploy-domain-20261016/document-format-qa.json`。

設定方法は[CloudflareのFull setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)、[Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)、[wwwからルートへの転送](https://developers.cloudflare.com/rules/url-forwarding/examples/redirect-www-to-root/)を参照した。

## 記録

- [公開receipt](../assets/cloudflare/deployment.json)
- [全配信ファイルQAの要約](../assets/cloudflare/public-release-qa.json)
- [公開Chrome QA](../assets/cloudflare/solo-live-qa.json)
- [独自ドメインのDNS・TLS・転送・Chrome QA](../assets/cloudflare/custom-domain-qa.json)
- 公開候補・gate: `output/production-domain-20261016/`
- 公開前Chrome: `output/playwright/production-2026-10-16T04-31-15-305Z/`
- 公開後Chrome: `output/playwright/solo-live-domain-20261016/`
- 独自ドメインの公開後Chrome: `output/playwright/solo-cromagnonmmo-com-20261016/`
- 管理APIの前後記録、旧receipt、Freeプラン画像、全配信SHA、公開ガード、コマンドとログ: `output/cloudflare-deploy/deploy-domain-20261016/`
