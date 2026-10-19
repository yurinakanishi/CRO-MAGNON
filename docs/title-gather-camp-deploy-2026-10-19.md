# タイトル画像・採集判定・焚き火納品削除の公開（2026-10-19）

ユーザーの指示で、[実装・再現・ローカル検証](title-gather-camp-2026-10-18.md)を `728f2b4ae852d573c64d5561c5221baa80384e0a` にコミットし、**2026-10-19 12:12 JST**に[公開サイト](https://cromagnonmmo.com/)へ反映した。タイトル左上に既存のファビコン画像を置き、木材・石・黒曜石の採集可能距離を固い資源の外周から測るよう修正。焚き火への資材納品とその操作・案内・通知を廃止した。調理・休息と既存保存の互換性は維持する。

| 項目 | 結果 |
| --- | --- |
| Cloudflare version | `1f1e98c6-4e8c-4d32-865a-a7375cfb8873`、100%配信 |
| 直前のversion | `d5761636-f979-4665-bdbc-c6352a5e3589` |
| 検証済みbuild ID | `9d95eee946a1b9f36712dc1a5415a34da93009776b52a6c6b70d6ebc4b242555` |
| 候補・配信証跡 | `output/production-gather-camp-20261019-01/`、`output/cloudflare-deploy/deploy-gather-camp-20261019-01/` |
| 静的ファイル | 771件・144,058,458 bytes（実配信770件・144,058,159 bytes）、GLB 87件 |
| Worker | 144モジュール、`SERVICE_ENABLED=false`、既存DO namespaceを保持 |
| アップロード | 変更15件、既存755件を再使用 |

`npm ci` 後に `npm run verify:production -- --output-root=output/production-gather-camp-20261019-01` を実行し、型・strict・JS構文・依存境界・書式・依存監査（脆弱性0）・ビルド・Worker dry-run・実Chromeが合格。**全1,855テスト中1,851合格、失敗0、任意4件スキップ**。検証後はビルドし直さず、同じ候補を配信した。[検証結果](../output/production-gather-camp-20261019-01/verification.json)。

公開後、新versionが100%であること、`SERVICE_ENABLED=false` と同じDO namespaceを確認。公開770ファイルすべてのサイズ・SHA-256、従来のworkers.dev URLの主要29ファイル、両URLのsolo health、オンライン入口の503、非公開パスの404、HTTPS転送が合格した。[全ファイル照合](../assets/cloudflare/public-release-qa.json)。公開URLの実Chromeではソロ開始・自動保存・再開・別タブ排他・390pxのタッチ移動／ジャンプに合格し、ページ例外・consoleエラー・ゲームAPI・WebSocket通信は0。[通常操作](../assets/cloudflare/solo-live-qa.json)。

公開URLで隔離したソロ保存を使い、PCと390pxスマホ相当の両方で左上44px画像、木材・石の採集案内、焚き火納品案内の消失を確認した。数字3とEを押しても納品案内・完成通知は現れなかった。[公開画面の6条件](../assets/cloudflare/gather-camp-live-qa.json)。実際の接近と採集個数、ベリー、保存値不変は同じソースの[ローカル実Chrome検証](title-gather-camp-2026-10-18.md)で確認した。公開URLでは準備した位置からの表示を確認し、木材・石の採集操作そのものは再実行していない。

直前の公開ソースSHA台帳と照合し、新たな配信コード差分は今回の変更だけだった。他作業の未コミット差分は維持した。[ソース差分台帳](../output/cloudflare-deploy/deploy-gather-camp-20261019-01/source-delta.json)。専用アカウントの認証済み料金画面を公開直前に再読み込みし、**CRO-MAGNON Free／$0／Current plan**を確認。有料プラン・従量課金サービスは追加していない。Wranglerの既存OAuthトークンは同じ権限で更新した。

通常3000／8787／4173の停止・再起動、ユーザー保存の編集・再適用、展示ビルド・配布はしていない。ローカル保存2件は直前にコピーし、公開後のSHAが両方とも不変。3000番のhealth／statusは前後とも接続できず、起動していない。実スマートフォン、Safari、物理コントローラーは未検証。コミットはローカルのみで、GitHubへのpushはしていない。
