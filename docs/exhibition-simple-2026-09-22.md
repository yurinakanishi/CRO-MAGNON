# 展示の交易案内を非表示にして全変更を反映

ユーザーの画面下の案内撤去・PC1/PC2への全変更反映・コミットとpushの依頼に対応。
「オルト攻撃する」に一致する表示はなく、オルの近くの「オルと物々交換する」を対象として作業した。
`src/main.ts` の近接操作候補に、展示LANでは交易を追加しない。
通常モードの交易案内、採集などほかの近接案内、攻撃入力は維持する。

これまで保留されていた展示メニュー整理・架空島撤去と、タイトル6名のXアイコン、
地図の描画軽量化を含む現在の作業ツリーからオフライン版を作成した。
印刷用のコントローラー操作説明HTML/PDFも今回のコミット対象に含める。

## 検証

- 変更前の全作業ツリーで590テスト成功。今回の近接案内の変更は最終配布版の実Chromeで検証。
- 最終配布版のビルド・型・strict、373 JavaScript構文・依存境界成功。
- `scripts/qa-exhibition-menu.mjs`：実Chrome2画面＋通信3人、14検証群、ブラウザーエラー0。
  PS4／Switch Pro両方で6アイコン読込とオルの案内非表示、3メニュー、
  人物変更・取消、食事、全6地点へのワープと所持品保持・同期、縦横画面、タイトル復帰・再読込。
  証拠 `output/playwright/exhibition-menu-1790087042597/`。
  Gamepad API、オル横の座標、食事用ベリーと体力だけを保存なしの検査世界で準備。
- `scripts/qa-map-pins.mjs`：実Chrome2画面、地図のドラッグ・ズーム・ピン共有・消去、
  1倍の全海岸、8倍/32倍の地表、コントローラー入力、縦横画面の10検証群成功。
  人物位置・所持品不変、エラー0。精細化フレーム最大222msであり、常時滑らかな描画は主張しない。
  証拠 `output/playwright/map-pins/summary.json`、ログ `output/exhibition-update-map.log`。
- `scripts/qa-exhibition-launch.mjs`：同梱Nodeの起動4項目成功。
  証拠 `output/exhibition-simple-launch-qa.json`。

## 配布版

- 版名：`exhibition-20260922-simple-r01`
- ビルドID：`5038ecf403100d158f9a009ccbfaca1619629a7aa14ca7d680d6561f3dff6021`
- 410ファイル、78 GLB、509.7 MiB。
- ZIP SHA-256：`276a73d81df381fbe1cdda6be03430e218d1f80a6315ca835b0701069f2f85d9`
- 対象はPC0・PC1・PC2。今回PC3は未配布のままとする既存ユーザー指定を保持。

## 配布と切替

`scripts/exhibition-fleet.ps1 -Action Deploy -Machines PC0,PC1,PC2` で
全3台へ同じZIPを配置し、全ファイル照合後に選択中の版を更新した。
PC1ホスト・PC2クライアントをCRO-MAGNONの標準タスクで再起動。
PC0は同版を選択して待機し、ゲームを起動していない。PC3は今回未配布。
PC1はPS4表記、PC2はSwitch Pro表記。通常ユーザーのSSH・Public権限を使用し、UAC表示なし。
記録 `output/exhibition-fleet/20260922-232641-deploy-43044265320f4d82b6d55fd0d14a7162.json`。

更新後の `Verify` で3台とも全410ファイル・同一ビルドIDが一致し、
PC1/PC2稼働・PC0待機を再確認した。
記録 `output/exhibition-fleet/20260922-232932-verify-13476343312c4ed2b89da56b980a3605.json`。

各PCの同梱Nodeで独立部屋 `FLEET-QA-233000` へ接続し、双方の移動・攻撃同期に成功。
PC1で33、PC2で19スナップショットを観測。各localhost配信の6コード/CSSと6アイコンの
全12ファイルをマニフェストのSHAと照合し、最新版の524素材の配信も確認した。
記録 `output/exhibition-simple/FLEET-QA-233000-PC1.json` と `FLEET-QA-233000-PC2.json`。
この検査は展示の本番部屋の人物・所持品を操作しない。

公開サイトへのデプロイは行わない。物理コントローラー・実展示画面の目視は未検証。
