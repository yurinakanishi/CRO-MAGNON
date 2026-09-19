# 採取できる丸太を1本単位で表示する

2026-09-14。旧 `firewood-pile` の上部を水平なクリッピング面で切り落とす方式を撤去した。新規 `firewood-log` は丸太1本の画像をCodex imagegenで作り、ローカルTRELLIS-2（1024、seed 42、texture 512）で復元した静物。ClaudeやTripoは使用していない。可視モデルをプリミティブで代用していない。

採用は Candidate 1 / revision 02、`public/models/firewood-log/model.glb`。SHA-256 `8a32826636cfc198cc1776ebec499b1bc036779c08143cf256ad7e4d8a186cd3`、2,156,672 bytes、13,340三角形。長さ約1.20 m（+X）、高さ0.345 m、奥行0.370 m、Y-up・地面中央の原点。元画像、conditioning、dense、未採用r01、r02とLOD、制作スクリプト、検証画像を `output/model-generation/models/firewood-log/` に保持する。

最初のr01は拡大時の陰影が角張っていたため不採用。r02は元の細部を多く残し、モデルの向きを変更した後に、カスタム法線を再計算した。元denseとの双方向6,000点計測はp95最大0.813 mm、最大1.834 mm。LOD1は1,866三角形、LOD2は466三角形。近距離の拡大では簡略化が見えるため、10 m／22 m以遠で使用する。遷移には15%のヒステリシスがある。初回は詳細レベルだけを可視にして、生成直後に低精細レベルが選ばれる問題も修正した。

`shared/wood-pile-layout.mts` が実GLBの寸法から下段→上段の並びを決め、`src/wood-pile.ts` が1資源単位につき1本の完全なモデルをインスタンス描画する。7本なら下段4本＋上段3本。全LODで描画する本数だけを変更し、残った丸太の位置・大きさ・形状は変えない。残量0で全体が消え、再生成時には下段から戻る。斧で2単位採取する既存の処理では、丸太を2本取り除く。幾何・材質・テクスチャを共有し、地域を離れる際は、丸太の山ごとのインスタンスバッファだけを解放する。

当たり判定は同じ配置と実GLBの外形から組み立てる。従来と同様、残量がある間は、満杯時の占有範囲を当たり判定に使う。一般の飾り用 `firewood-pile` とその旧GLBは保持。雪・灰・砂の材質は単体丸太にも適用する。

検証結果:

- 修正前に実Eキーで3回採取し、上部を切り落とす現象を再現（`output/playwright/firewood/baseline/`）。
- Blenderでdenseの4方向、実Chromeでdense／最終GLB／LODの7方向、最終GLBの無彩色、7→0本の山を確認。9／12／21／26 mの実透視描画でLOD0／1／1／2を確認（`output/playwright/firewood/asset-r02/`、47記録）。
- 実Chrome2画面＋通信3人。Eで7→0本、持ち物の増加、両画面の一致、4本で再読込、実時間20秒後の1本再生成、斧の2本採取、雪・灰・砂でのE採取、390×844／844×390、谷への帰還を確認。ブラウザーエラー0（`output/playwright/firewood/final/`、27観測）。初期位置と地域移動、斧の所有・残量の準備だけをサーバーで設定し、採取操作・再読込・自然再生成は実経路で検証。
- 全601テスト、TypeScriptとstrict、依存境界、JS構文、変更コードの書式。モデル総合検証43モデルも通過（`output/firewood-tests-final.log`、`output/firewood-assets-full.log`）。
- 更新前の配信56GLBは全SHA一致。通常3000番の新GLB3件・関連JS9件・マニフェストのSHA一致（`delivery.json`）。通常の開発監視が更新し、手動でサーバーを停止・再起動していない。

描画条件はWindows、NVIDIA RTX A1000 6GB Laptop、Chrome headless、基本1280×800・pixel ratio 1、同時描画2画面・通信5人。今回のスナップショットにはFPS・描画呼出数・三角形数・geometry／texture数・初期読込時間を記録した。読み込み直後や地域移動直後の過渡値を含む非連続観測であり、FPS改善や常時60FPSは主張しない。物理スマートフォンと長時間負荷は未検証。

制作正本は隣の `../threed-model-creation/models/firewood-log/` へ111ファイルを追加保存し、全SHA-256を照合した。既存ファイルの上書きなし。記録は `canonical-sync.json`。

再現:

```powershell
node scripts/build.mjs
node --test --test-concurrency=4 tests/*.test.mjs
node scripts/qa-firewood-asset.mjs
node scripts/qa-firewood.mjs current
node scripts/verify-world-assets.mjs
node scripts/verify-firewood-delivery.mjs
```

制作手順は保存した `workflow/current/generate-model.py firewood-log` → Blender `process-static-model.py -- firewood-log --revision 02 --pca --width 1.2 --p95 0.001`。既存denseとrevisionは上書きしない。`adopt-firewood-log.mjs --measure` は採用前の外形計測専用、引数なしはレビュー後の初回採用専用。既存採用ファイルを排他的に保護する。

公開デプロイ、展示パッケージ、PC2、Meshmell公開、コミットは今回の範囲外。
