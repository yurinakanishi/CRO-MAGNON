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

PC0の `C:\Users\Public\CRO-MAGNON\releases\exhibition-20260923-complete-r01`
へ配置し、全411ファイル・78GLBを照合済み。選択中の版と稼働状態は変更していない。
記録 `output/exhibition-fleet/20260923-070742-deploy-13b8648fe8de42789c1a04d94ef1708b.json`。

PC1・PC2はSSH（TCP22）がタイムアウトするため、未配布・未切替。
PC0の展示IP `10.10.10.3` は内蔵Ethernetに設定されていたが、最初は未接続だった。
ユーザーが内蔵LAN端子へ差し直した後、固定IPがPreferred、リンク1Gbps、
PC1（.1）／PC2（.2）へのpingは各2回とも応答、ARPもReachableとなった。
ただし両PCのTCP22と、PC1のゲーム同期TCP8081への接続は引き続きタイムアウト。
各PCのsshdとネットワーク分類は遠隔から取得できず未確認。
ユーザーは必要なもの以外の確認依頼を省略するよう指定。
PC0の展示IP `10.10.10.3` を明示したSSHの最終試行でも両PCがタイムアウトした。
PC0の有線リンクは1Gbps、送信側Firewallの既定はNotConfiguredで、設定変更は行っていない。
最終試行 `output/exhibition-fleet/20260923-070955-deploy-46c405b9432a46bc871f5db1c3b3800d.json`。

接続復旧後は同じZIPを次のコマンドで配布・切替できる。

```powershell
& ./scripts/exhibition-fleet.ps1 -Action Deploy -Machines PC1,PC2 -ZipFile ./output/exhibition-20260923-complete-r01.zip -ReleaseName exhibition-20260923-complete-r01
& ./scripts/exhibition-fleet.ps1 -Action Verify -Machines PC0,PC1,PC2 -ReleaseName exhibition-20260923-complete-r01
```

PC0には別のローカル展示クライアントが4173番で稼働しているため、そのプロセスは
変更していない。PC0は予備用の検証済みコピーを保持する。PC3は未配布指定を継続。
UAC・自動昇格・Firewallの変更・通常開発サーバー再起動・保存再適用・公開デプロイはなし。
物理コントローラーと実展示画面の目視は未検証。
