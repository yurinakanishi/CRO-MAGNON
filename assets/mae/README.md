# mae

Downloadsの `mae.jpg` を無加工で取り込み、丸い巾着袋のような新しいペットとして制作した。元の薄灰色の横長の輪郭、縦の目2本、水平の口を保持する。画像にない手足・紐・結び目は追加していない。背面と奥行きは制作時の解釈。

## 制作物

| 項目 | 内容 |
| --- | --- |
| 原画像 | [source/mae.jpg](source/mae.jpg)、SHA `ed917b016d8aab12ccd7f7b1521f5d5e314a99d18f70de23ddd82cf1ce6d149a` |
| 制作参照 | [source/reference-v1.png](source/reference-v1.png)、built-in imagegen、1254×1254 |
| 復元 | Local TRELLIS-2 v0.8.1 Vulkan、GPU 1、512、seed 42、threshold背景除去 |
| 候補 | Candidate 1 / rig revision 01 |
| 寸法 | 高さ0.38m、幅0.5071m、奥行き0.1788m。足元中央原点、+Y上、+Z前 |
| 近景 | 24,836三角形、17,886,104 bytes、4骨 |
| LOD | 19,868三角形、9m基準。同じ骨・inverse bind matrices・材質・動作を共用 |
| 配信 | `public/models/mae/model-r01.glb` |
| SHA | `3fb4776d3830cda7b00dd1eeadaf4c000ebe7f41af38ccfe0ee55909e1309405` |
| 操作プレビュー | `output/model-generation/models/mae/qa/final-01/viewer.html`（実GLBとビューアー埋込、外部通信不要） |

工程は [ASSET_WORKFLOW.md](../../ASSET_WORKFLOW.md)、[CREATURE_MOTION_GUIDE.md](../../CREATURE_MOTION_GUIDE.md)、[Astra品質調査](../../docs/astra-creature-3d-quality-2026-10-02.md)、隣接モデル制作リポジトリの方式・保存規約・リグ引継ぎ資料を参照した。

`参照画像 → TRELLIS dense → 元表面を保つ溶接・局所平滑化・計測付き削減 → 専用リグ → exact GLB検証`。モデルの可視形状はTRELLIS由来の一続きの表面。UVと埋込アルベドを保持し、4骨のうちBody/Topへ高さに応じて滑らかにウェイトを付けた。Rootはその場、PetContactは頭頂の実頂点に置く。全フレームの最下頂点から接地補正を焼き込む。

低い削減率の試行では丸い輪郭が崩れたため、計測を通った24,836／19,868三角形を採用。結果は `work/rig/revision-01/rig.json`。LODの削減効果は小さく、FPS改善を主張しない。

## 動きとゲーム操作

| 動き | 時間・内容 |
| --- | --- |
| Idle_Loop | 3秒、控えめな呼吸 |
| Walk_Loop | 0.8秒、左右への重心移動。基準0.6m/s |
| Run_Loop | 0.5秒、柔らかい弾み。基準1.8m/s |
| Pet | 1.4秒、撫でる手の下で少し沈んで傾く |
| Happy | 1.4秒、小さい2回の弾み。ゲーム側の共通時刻でハート |
| Hit | 0.65秒、驚いて柔らかく引く |

キャンプの `(53.2,51.2)` 付近に1体。V／近接E／パッド下／本体クリック／通常メニューから撫でる。maeがしゃがんだ人物の手へ近づき、1.4秒撫で終えるとその人へ所属し、1.4秒喜んでから追従する。先客の撫で中は他者が奪えない。途中の移動・攻撃・人物変更・被弾・ワープ・切断・Qで未完了の撫でを中断し、以前からの所属は保持する。

Tまたは通常メニューでキャンプへ帰す。追従と帰還は猫と同系統の衝突・経路・実際の通過経路を利用。切断・乗船・ダウン・60m以上の分離・保存復元時にはキャンプへ帰る。投擲用dotsへの追加ではない。524・りもねこ・9種botとそれぞれの操作は保持する。被弾で反応するが体力・死亡・ドロップ・反撃はない。

## 再現と保管

制作スクリプトは [workflow](workflow/)。生成／Blenderはローカルの6GB GPUに合わせ直列実行。現ホストの実GPUはRTX A1000 6GB Laptop。以前の別作業のRTX 3070記録を今回の実機として流用しない。

```powershell
# 候補の上書きを避け、制作時の作業ログを参照して実行する
python assets/mae/workflow/validate.py --revision 01
node assets/mae/workflow/qa-viewer.mjs mae 01
node assets/mae/workflow/qa-motion-angles.mjs mae 01
npm run build
node scripts/qa-mae-contact.mjs
node scripts/qa-mae.mjs
node --test --test-concurrency=2 tests/*.test.mjs
```

TRELLISの最初のBiRefNet処理は289.8秒進捗がなく、今回起動した専用プロセスだけ終了した。白背景に対してthresholdで再試行し262.672秒で復元完了。失敗ログ、dense、PLY、cutout、削減試行、Blender、全QAを `output/model-generation/models/mae/` に保持する。Blender初回の引数不足とQA修正前の失敗も削除しない。

最終のゲームQA、保存と通常配信の確認、制限は [docs/mae-2026-10-03.md](../../docs/mae-2026-10-03.md) に記録する。
