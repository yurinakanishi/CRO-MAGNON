# 中央階段の上がり口の移動

2026-09-10。城の最初の中央階段を上がった先でスタックするとの報告。

## 調査と修正方針

- 城門から中央階段へ直接入力を与え、上がり口で前進・左右・後退を検査する。
- 床格子では足の中心だけでなく体の半径も検査する。現在は半径が壁に触れた場合に横滑りせず、斜め入力全体を捨てている。
- 城の回転に合わせた床格子の軸へ入力を投影し、通れる成分だけを残す。壁・落差・人物の衝突は保持する。
- 大猿では中央階段上の左右通路が半径0.76mでつながらないことも確認。元の床を切り抜く範囲の上端を城ローカルz=19.1から19.9へ移し、80cm分の既存床を残した。
- 回帰テスト、型・ビルド、実ブラウザー操作を検査する。通常サーバーの保存を試験用データで書き換えない。

## 結果

修正・検証・通常3000番への反映を完了。

- 元のTRELLIS城を使い、候補07で上がり口を補修、候補08で未使用バッファを除去。元の候補01〜06を保持。材質・画像・全体寸法は一致。134,353三角形、8,226,700 bytes、SHA-256 `637a6fa0aa4a3734419f8161bbfa3e320565453023d7a18c6f3047d4d7a4b241`。
- 実GLBから床判定を再計測。変更は上がり口の20セルのみ。480本のレイで連続した床を検査し、床高さ7.474mとの差は最大約4cm。
- 全7外見×歩行／走行×左右の28往復を手動移動関数で検査。回転した床格子の壁・落差・動的人物を保持した横滑りと後退を検査。既存の登城・下城・上階のテストも通過。
- 全460テスト成功（本修正の新規2、同時作業のキャラクター切替を含む現在の作業ツリー）。型・strict設定・ビルド、244JS構文・依存境界を確認。
- 実Chrome2画面＋通信3人、計5人接続。大猿が歩行で左、走行で右へ曲がって階段を下りる。予測OFF／ON、1440×900／390×844／844×390の表示。1,242回の位置観測、ブラウザーエラー0。開始位置・仲間の配置・カメラ・予測設定は準備値、移動は実キーと実時間、時計・持ち物は設定なし。走行の停止誤差は歩行キーで整えて次の区間へ進む。
- 通常3000番のPID52700・起動時刻11:47:34を照合し、既存SIGINTハンドラーで最終保存（revision2474→2475）と正常終了。12:21:27にPID35152を非表示起動し最新保存を使用。自動保存正常、5配信ファイル一致、通常タイトルのブラウザーエラー0。試験用保存の再適用・展示／PC2更新・公開デプロイなし。
- 全素材の制作資料検証スクリプトは、既存ネアンデルタール男性の参照画像SHA不一致で停止（`verify-world-assets.mjs:45`）。本修正の城の構造・画像・配信SHAは別途成功し、集約manifestの現行世界素材48GLBのバイト数とSHAも一致。既存の参照画像履歴は変更しない。
- 物理コントローラー、全地形、長時間負荷、城のその他の狭い場所で大猿が必ず通れることは未検証。制作正本への追加コピーは未実行、今回の候補07・08と計測資料はローカル制作フォルダーに保持。

証拠は `assets/castle-stairs/`、`output/playwright/castle-stairs/`、`output/model-generation/models/valley-castle/qa/`。再検証は `scripts/qa-castle-stairs.mjs` と `scripts/verify-castle-stairs-mesh.mjs`。

再生成:

```text
node scripts/repair-castle-entrance.mjs 07
node scripts/pack-castle-glb.mjs 07 08
node scripts/measure-castle-surface.mjs output/model-generation/models/valley-castle/work/low-poly/candidate-08/candidate.glb output/model-generation/models/valley-castle/qa/surface-rev08.json
node scripts/build-castle-walk-atlas.mjs output/model-generation/models/valley-castle/qa/surface-rev08.json output/model-generation/models/valley-castle/qa/walk-rev08.json 19.9
node scripts/install-castle-surface.mjs 08
```

候補の生成は既存ファイルを上書きせず、同じ番号が存在する場合は停止する。

## 2026-09-11 側面階段（2 階→3 階）で途中で詰まる

再現：衝突判定のみのシミュレーションで、2 階テラス（12.6 m）の側面階段の足元からスティックを一方向に倒し続けると、人間は右側 `(14.6, 5.5)` 高さ 15.9 m、大猿は `(19, 7.0)` 13.2 m で停止した。経路探索どおりなら全キャラ通れる。

原因と修正（詳細は `PLAYTEST_FEEDBACK_PLAN.md` 第 2・11 節）：
1. 踏面の中の 1 セル穴（null）。`scripts/build-castle-walk-atlas.mjs` の後処理で 4 近傍の 3 つ以上が床（高さ差 1.2 m 以内、1 m 以上）の null を近傍平均で埋める。rev09：141 セル、`holeFills` に記録、GLB と `sourceSha256` は不変。到達 25,957 → 26,098 セル。
2. 45° の斜め階段に対する軸方向スライド。`shared/collision.mts move()` はゼロ移動候補を除外し、両方却下なら入力を ±22.5°〜±90° 回転した候補（1 歩先も通れるもの）を採用。
3. 手すりの縁で 8 点リング検査が紙一重で落ちる。`shared/measured-walk-surface.mts` に `deviation()`/`allows()`（到達済みの縁では 0.25 m まで悪化しない移動を許す）、高さ補間を壁の隣でも連続に、リング半径の上限 0.5 m、段差許容 `0.75 + 0.6×距離`。

回帰：`tests/castle-stairs.test.mjs`「every character climbs both side stairs…」（7 キャラ × 両側 × 3 始点 × 2 方向 × 歩き/走り）。再生成は
`node scripts/build-castle-walk-atlas.mjs output/model-generation/models/valley-castle/qa/surface-rev08.json output/model-generation/models/valley-castle/qa/walk-rev09.json 19.9` → `node scripts/install-castle-surface.mjs 09`。

