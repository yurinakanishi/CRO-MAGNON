# 3Dモデル制作の進行

更新日: 2026-09-06。最初のクロマニョン人 **Candidate 1 を完成候補として保存し、ゲームへ組み込み済み**。
Claude停止後のユーザー指示に従い、Codexが胴体のウェイト修正と最終QAを引き継いだ。
最初の1体の区切りで停止する。

## 確認画面と成果物

- [ゲーム](http://localhost:3000/)（開いている画面は再読み込みで反映）。
- [モデルレビュー](http://localhost:3000/model-review.html?model=/models/cro-magnon-hunter/model.glb)。8動作・視点・1体／5体を切り替え可能。
- [配信GLB](../public/models/cro-magnon-hunter/model.glb)、[配信manifest](../public/models/cro-magnon-hunter/asset.json)。
- [構造検査](candidate-1-structure.json)、[ゲーム確認記録](candidate-1-game-qa.json)、[進行状態](generation-state.json)。
- [候補レポート](../output/model-generation/models/cro-magnon-hunter/work/low-poly/batch-001/run-01/attempt-05/codex-final/candidate-report.json)。
- [最終QA manifest](../output/model-generation/models/cro-magnon-hunter/qa/variants/batch-001/run-01/attempt-05/codex-final/qa-manifest.json)、[8動作の動画](../output/model-generation/models/cro-magnon-hunter/qa/codex-review/final-videos/animation-videos.json)。
- [完成候補台帳](../output/model-generation/models/cro-magnon-hunter/work/candidate-ledger.json)、[正本への同期記録](canonical-sync.json)。

最終GLBは9,991,448 bytes、69,990 triangles、22 bones、1.80 m、Y-up、+Z前方。
SHA-256: `8f92a0086c7aa3f44d4120c48c1c2ac70672c5febdb162e4b6156f361d0fc805`。
制作workspaceの `work/low-poly/batch-001/run-01/attempt-05/codex-final/candidate.glb` と同一。

## 完了した内容

| 工程 | 結果 |
| --- | --- |
| 原画像・conditioning・TRELLIS | 保存済み。res 1024、seed 42、291,930 trianglesのdense mesh |
| 軽量化・UV・材質 | 顔を保つ領域別軽量化。元のalbedoをベイク、非金属PBR、TribeAccent |
| リグ・8動作 | Idle、Walk、Run、Gather、Craft、Give、Eat、Wave。Grip.L/R |
| Codex修正 | 胴体へ誤って伝わる腕の影響を抑制。背中の服の裂けと手振り時の伸びを改善 |
| 最終ファイルQA | 構造・接地・ループ・全8動作のブラウザー目視、32枚の比較画像、8本の動画と動画metadata |
| ゲーム組み込み | 5人接続、個別mixer、部族色、装備取り付け、6人目ROOM_FULL |
| 候補記録 | Codex完了台帳でCandidate 1を1件。旧Claude実行履歴は変更せず保存 |

修正はJOINTS_0／WEIGHTS_0の値のみ。形状・UV・テクスチャ・材質・骨格／接続点・8動作のデータが
変更されていないことをバイト単位で確認した。最初の修正probeは腕への副作用があったため不採用とし、v2を選定。

ゲームは待機・移動、サーバーの手振り通知、確定した採集・制作・受け渡し・食事へ動作を接続する。
共有GLBから骨格・mixer・部族色材質を人物ごとに持つ。旧槍と石斧はGrip.Rへ仮接続し、単発動作中は非表示。
肩越しカメラの初期距離は5.5 m。

## 確認値と残る限界

- 修正版の実接続5人で60 FPS、1,143 draw calls、影を含め971,112 triangles、345 geometries・16 textures、読込255 ms。
  このPCでの観測値で、他端末への性能保証ではない。
- 同じruntimeで4人退出後341 geometries・8 texturesへ戻ることを確認済み。長時間のメモリ検査は未実施。
- 11件の自動テストと `npm run check` が成功。最終GLBの構造検査も成功。
- 最大4 influence、正規化、未割当なし、Root静止、ループ終端一致。全8動作の最低点は約Y=0。
  Eatの右手は口元から最短約5.1 cm。
- 近接では髪・毛皮の表面の粗さ、脇・裾の小さな伸び、膝の陰影の乱れが残る。
  走行の裾には5 cm／4倍の伸びの検査閾値を超える局所辺が9件あり、目視確認して限界として記録した。
- 速度8に合わせてRunを `8 / 2.775` 倍速で再生するため足運びは速い。独立した歩行／走行切替や戦闘は未実装。
- ネアンデルタール人・マンモス・植物・環境・装備などは従来の仮素材。全モデルの制作方針は[ASSET_WORKFLOW.md](../ASSET_WORKFLOW.md)に従う。

## 制作元と履歴

原画像は[reference-v1.png](sources/cro-magnon-hunter/reference-v1.png)。利用できなかったZImageの代わりに、
参照元の許可する同等手段としてbuilt-in imagegenを使用した。[生成記録](sources/cro-magnon-hunter/reference-v1.json)を保持。
ClaudeがローカルTRELLIS、Blenderでの軽量化・UV/PBR・リグ・動作を制作し、Codexが最終修正と検証を担当した。

制作実行場所は `output/model-generation/` の専用worktree。
正本は `../threed-model-creation/models/cro-magnon-hunter/`。今回のモデルだけを同期し、別モデルと共通toolsの変更は保持する。

Claudeのattempt 1はGit範囲チェック、2はターン上限、3は脚の破綻修正、4はEat修正のため停止。
5はモデルを保存した後、11:34 JSTにHTTP 429で終了した。**このfailed・成功0を成功へ書き換えていない。**
ユーザーの「claude 停止したので、代わりにあなたがやって」を根拠にCodexが完了し、独立した台帳でCandidate 1を記録した。
旧Claude batchを再開する必要はない。原画像・dense・全attempt・元のGLBは保存済み。
Candidate 2、別モデルの生成、`geometry/accepted.glb` への昇格、外部公開は実施していない。
