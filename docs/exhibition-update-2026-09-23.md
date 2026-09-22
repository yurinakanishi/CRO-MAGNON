# 2026-09-23 全変更の統合と展示更新

ユーザー指定で、未コミットだった全38ファイルを
`f01aaa4525daa7fdefad7e7132d1f365c374b12a` としてmainへコミット・pushし、
GitHubのmainも同じSHAであることを確認した。

524の自然な追従・手で撫でる動作・回転とハート、展示の操作表記とメニュー、
マンモス到着地点の木の移動・地点名、操作ガイドPDFと素材、展示HUDの
2人上限・1日目表示・焚き火の会話撤去を含む。

## 検証済み配布版

- 版名：`exhibition-20260923-complete-r01`
- ビルドID：`cb5f3115fe62f2062269ce80ee858608f9457154ed9dfc870a549b19cde0e918`
- ZIP：`output/exhibition-20260923-complete-r01.zip`
- ZIP SHA-256：`45aa2116845585daee8ffc143e9e29a1dc65d98708b701324429857946924c57`
- 411ファイル、78 GLB、展開時509.7 MiB、同梱Node v24.16.0。
- ビルド・型／strict、全596テスト、375JS構文・依存境界・変更コード書式成功。
- 素材総合検証成功。ログ `output/exhibition-20260923-assets.log`。
- 同梱ランタイムのホスト／クライアント起動4項目成功。
  `output/exhibition-20260923-complete-launch-qa.json`。
- 完成した配布パッケージの実Chrome2画面＋通信3人で、展示メニュー・人物変更・
  食事・全6地点ワープ・縦横画面・タイトル復帰・再読込の14検証群成功。
  `output/playwright/exhibition-menu-1790114858655/`。
  検査専用サーバーは同期観測のため5人を許可。実展示ランチャーの上限は2人。
- HUDの実Chrome展示2画面＋通常1画面で9検証群成功。
  `output/playwright/exhibition-hud-20260923/`。

## 配布状況

### 最終結果：PC1/PC2の切替と実機同期確認が完了

ユーザーの再試行指定後、PC1（YURIALIENWARE）・PC2（LAPTOP-HS5HI3E4）とも
標準CRO-MAGNONユーザーでSSH接続できた。同じ検証済みZIPを両台へ配布・照合し、
記録された旧展示の停止を確認してから選択版を変更。PC1ホスト、PC2クライアントの
順に標準タスクで起動し、両方の稼働ビルドが上記r01と一致することを確認した。

- 配布・切替記録：`output/exhibition-fleet/20260923-074239-deploy-e7e7738c480847f5a340cd092163e27c.json`
- 切替後の照合：`output/exhibition-fleet/20260923-074545-verify-8f0dd658572047e38976de150fac9be8.json`
  PC0の予備コピー、PC1、PC2それぞれ全411ファイル・78GLBが一致。
- 実機同期：`output/exhibition-complete-20260923/pc1-live.json` と `pc2-live.json`。
  各PCの同梱Nodeから独立した検査部屋 `QA230747` へ接続し、双方の移動・攻撃を相互確認。
  ゲーム画面用の配信16ファイルのSHA、524素材、2人上限とビルドIDを照合。
  PC1はPS4表記、PC2はSwitch Pro表記を保持。

PC0は最新版の予備コピーを保持し、別途稼働中のローカル展示と選択版は変更していない。
PC3はユーザー指定に従い今回未配布。物理コントローラーと実展示画面の目視は未検証。
全ゲーム変更 `f01aaa4`、初回配布記録 `cbe754b`、セットアップ修正 `96b3063` はmainへpush済み。

### その後のPC2復旧とセットアップ修正

ユーザーの診断でPC2はsshdがRunning、TCP22が待ち受け中だが、有線LANがPublicと判明。
旧セットアップ再実行はタスク再登録の手前で「Stop the exhibition at a visitor break
before registering its launcher」で中断した。このエラーを報告した機体はPC2。
LAN・SSHの再設定後、PC0からPC2へ標準ユーザーのSSH接続が復旧した。

PC2へゲーム版 `exhibition-20260923-complete-r01` を配置し、411ファイル・78GLBを照合。
この時点ではPC1のSSHがタイムアウトしたため、PC1/PC2の選択版・稼働版を変更しなかった。
記録 `output/exhibition-fleet/20260923-073743-deploy-13ed0fcc45bd48ccaa49e591c28d7e74.json`。

ユーザー指定でセットアップを修正。起動中の展示が記録・タスク・PIDと一致する場合、
既存リリースを照合し、標準ランチャーへ停止を要求する。停止を確認してから再登録し、
元々起動していた展示だけを同じ版で再起動する。停止・登録・起動の失敗は未完了として返す。
無関係なプロセスをまとめて終了せず、待機機は起動しない。

修正版セットアップ：`output/exhibition-setup-20260923-r05.zip`、17ファイル。
SHA-256：`f619b9147bed63086278138853fb1b4baf5eed248c66b7950c090fee2e1dbc03`。
PC0/PC1/PC2の既存公開鍵とMicrosoft署名・SHA確認済みOpenSSH MSIを保持。
関連12テスト成功。PS5.1の7条件で動作順序・待機・検証/停止/登録/起動失敗・停止残存を確認。
この修正版セットアップの実機での再登録・復帰はまだ未検証。

### 初回の接続障害とPC0への配置

PC0の `C:\Users\Public\CRO-MAGNON\releases\exhibition-20260923-complete-r01`
へ配置し、全411ファイル・78GLBを照合済み。選択中の版と稼働状態は変更していない。
記録 `output/exhibition-fleet/20260923-070742-deploy-13b8648fe8de42789c1a04d94ef1708b.json`。

初回はPC1・PC2のSSH（TCP22）がタイムアウトしたため、未配布・未切替だった。
PC0の展示IP `10.10.10.3` は内蔵Ethernetに設定されていたが、最初は未接続だった。
ユーザーが内蔵LAN端子へ差し直した後、固定IPがPreferred、リンク1Gbps、
PC1（.1）／PC2（.2）へのpingは各2回とも応答、ARPもReachableとなった。
ただし両PCのTCP22と、PC1のゲーム同期TCP8081への接続は引き続きタイムアウト。
各PCのsshdとネットワーク分類は遠隔から取得できず未確認。
ユーザーは必要なもの以外の確認依頼を省略するよう指定。
PC0の展示IP `10.10.10.3` を明示したSSHの最終試行でも両PCがタイムアウトした。
PC0の有線リンクは1Gbps、送信側Firewallの既定はNotConfiguredで、設定変更は行っていない。
最終試行 `output/exhibition-fleet/20260923-070955-deploy-46c405b9432a46bc871f5db1c3b3800d.json`。

接続復旧後、同じZIPを次のコマンドで配布・切替・照合した。

```powershell
& ./scripts/exhibition-fleet.ps1 -Action Deploy -Machines PC1,PC2 -ZipFile ./output/exhibition-20260923-complete-r01.zip -ReleaseName exhibition-20260923-complete-r01
& ./scripts/exhibition-fleet.ps1 -Action Verify -Machines PC0,PC1,PC2 -ReleaseName exhibition-20260923-complete-r01
```

PC0には別のローカル展示クライアントが4173番で稼働しているため、そのプロセスは
変更していない。PC0は予備用の検証済みコピーを保持する。PC3は未配布指定を継続。
UAC・自動昇格・Firewallの変更・通常開発サーバー再起動・保存再適用・公開デプロイはなし。
物理コントローラーと実展示画面の目視は未検証。
