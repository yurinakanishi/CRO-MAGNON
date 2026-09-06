# 全3Dモデルの制作記録

更新日: 2026-09-06。

ユーザーの「Claudeは使わず、他のすべての3Dモデルもimage-to-3Dで修正する」という指示に従い、Codexが残り15素材を制作し、ゲームへ組み込みました。既存クロマニョン人は保持しています。

参照画像をbuilt-in imagegenで作り、ローカルTRELLIS-2で復元し、元の形状・UV・材質を保つ補修と軽量化を行います。人物には8動作、マンモスには四足用リグと4動作を用意します。静物に不要な骨は付けません。

メインゲームは検証済みGLBを使う描画処理へ切り替え済みです。両種の人物、NPCオル、マンモス、環境、装備を確認しました。新しい素材構成での5人接続と描画計測は [ゲーム検証記録](world-game-qa.json) を参照してください。

| 対象 | 観測した状態 | 配信候補 |
| --- | --- | --- |
| ネアンデルタール人とオル | ゲーム組み込み・全体QA済み | [GLB](../public/models/neanderthal-hunter/model.glb) |
| マンモス | ゲーム組み込み・全体QA済み | [GLB](../public/models/woolly-mammoth/model.glb) |
| 針葉樹 | ゲーム組み込み・全体QA済み | [GLB](../public/models/valley-pine/model.glb) |
| 草の株 | ゲーム組み込み・全体QA済み | [GLB](../public/models/meadow-grass/model.glb) |
| 岩と石資源 | ゲーム組み込み・全体QA済み | [GLB](../public/models/valley-boulder/model.glb) |
| 薪と木材資源 | ゲーム組み込み・全体QA済み | [GLB](../public/models/firewood-pile/model.glb) |
| ベリーの茂み | ゲーム組み込み・全体QA済み | [GLB](../public/models/berry-bush/model.glb) |
| 皮のテント | ゲーム組み込み・全体QA済み | [GLB](../public/models/hide-tent/model.glb) |
| 乾燥棚 | ゲーム組み込み・全体QA済み | [GLB](../public/models/drying-rack/model.glb) |
| 焚き火の薪と石 | ゲーム組み込み・全体QA済み | [GLB](../public/models/stone-firepit/model.glb) |
| 石槍 | ゲーム組み込み・全体QA済み | [GLB](../public/models/flint-spear/model.glb) |
| 石斧 | ゲーム組み込み・全体QA済み | [GLB](../public/models/stone-axe/model.glb) |
| 草地・道・地形 | ゲーム組み込み・全体QA済み | [GLB](../public/models/meadow-ground/model.glb) |
| 川の水面 | ゲーム組み込み・全体QA済み | [GLB](../public/models/river-water/model.glb) |
| 木造の橋 | ゲーム組み込み・全体QA済み | [GLB](../public/models/wood-footbridge/model.glb) |

## 制作資料

- [全素材の仕様と状態](world-models.json)
- [キャンプ到着地点の追加検証](world-navigation-qa.json)。新しいテントの外へ到着するよう、サイドバーと地図の移動先を調整済み。
- [制作方針](../ASSET_WORKFLOW.md)
- [モデル確認画面](http://localhost:3000/model-review.html)。素材選択、全動作、槍・石斧の装備、肩越し・左右・背面・上面に対応。
- [最初のクロマニョン人の完了記録](cro-magnon-candidate-1.md)。この記録の5人・60 FPSは旧環境での観測値です。

原画像、高密度GLB、失敗した修正案、最終候補、スクリプト、測定値、静止画と動画は `output/model-generation/models/<model-key>/` に保持します。正本の同期先は `../threed-model-creation/models/<model-key>/` です。

RTX A1000 6 GBで復元とBlenderの重い処理を直列に実行します。小さな静物・ほぼ平面のパーツは512復元、大きな生き物と構造物は1024復元を使い、各モデルの記録へ設定を保存します。解像度や生成完了だけを品質判断の根拠にしません。

草と木の遠景表示には、実際の完成GLBを描いた画像によるLODを使います。近くの立体モデル、地形、橋、薪、石、建物、装備はいずれもTRELLIS由来です。空・雲・日光、水流、炎・火の粉と操作マーカーは実行時の効果です。
