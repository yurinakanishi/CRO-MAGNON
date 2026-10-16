# 壁画の連続配置と、今後のキャラ追加

**素材の修復（同日・r41）**：524の2点など、原画から欠けた特徴を7体で修復した。[原画との比較・原本・指示・修復手順](../identity-r41/README.md)。新しい追加や修復は、現在採用中のレシピから開始し、今回の修復を引き継ぐ。

**配置の更新（同日・r40）**：以下の素材と縮尺を保ち、動物を上下に重ねて以前のような密度を戻した。[構図と検証](../layered-r40/README.md)。新キャラもこの構図の前景へ自動配置する。以下のr39検証は、その更新前の記録。

2026-10-16。人物24体と動物8種類を独立した顔料として扱い、両壁を一続きにした。配信の画像は10枚の1024×341アトラスで、従来と同じ枚数。動物・岩肌と合わせた実行時テクスチャは12枚。洞窟の採用済みTRELLIS GLB、リグ、ゲーム内キャラクターは変更していない。

画像の枠の高さではなく、頭の頂点から足元までで人物の寸法を決める。人型は1.4m、丸いDots・まえ・524は0.72m、りもねこは1.05m、帽子を除いたアヒルは1m。帽子と耳は身体の上に残す。これは壁画の表現上の基準で、3Dモデルの実寸を変更する設定ではない。524は足元から0.22m浮かせ、りもねこと向かい合う位置を保持する。

マンモス3m、サイ1.8m、オーロックス1.85m、野牛1.75m、馬1.65m、角を含む鹿2m、アイベックス1.55m。両壁・手前と奥で同じ種類の基準を共用する。以前の枠ごとの動物と上段の別縮尺は廃止した。

## 元画像・生成指示

すべてCodexの**内蔵image_gen**の透過画像編集で制作した。3列×2行の人物シート4枚と、3種類の動物シート1枚。旧壁画から顔・服・特徴・顔料の質感を保ち、動物や隣の人物と一体化していた輪郭を独立させた。

| 原本 | プロンプト |
| --- | --- |
| [丸いDots5体とまるぃも](source/round-and-maruimo-r01.png) | [生成指示](prompts/round-and-maruimo.txt) |
| [形のDots4体・524・りもねこ](source/shapes-and-companions-r01.png) | [生成指示](prompts/shapes-and-companions.txt) |
| [まえ・琥珀・Saber・Fairy・ぬこぬこ・Saga](source/meadow-people-r01.png) | [生成指示](prompts/meadow-people.txt) |
| [オータニ・浦田・Howkey・Rei・だれだろ・Ryuichi](source/river-people-r01.png) | [生成指示](prompts/river-people.txt) |
| [サイ・アイベックス・オーロックス](source/extra-animals-r01.png) | [生成指示](prompts/extra-animals.txt) |

[recipe.json](recipe.json) に元画像のSHA、個別の切り出し範囲、帽子などを除く頭の基準点、配置用の体格分類を記録した。技術処理は連結した顔料の分離、生成された柔らかな輪郭の保持、縦横比を保った縮小とアトラスへの梱包だけ。新しい輪郭や絵をコードで描いていない。[packed](packed/) は配信PNGと同じバイト列の制作側コピー。[梱包とSHA](qa/packing.json)、[採用前のmanifest](previous-asset.json)、[旧投影コード](previous-layout.ts.txt) を保持する。r38以前の画像も元の場所に残した。

## 次のキャラを追加するとき

1. `public/models/camp-cave/asset.json` の `muralComposition.recipe` が指す現在のレシピ（現在は `identity-r41/recipe.json`）を新しい制作revisionへコピーし、`revision` に新しい番号を設定する。このr39へ戻して修復済みの特徴を失わない。既存の原本とレシピを上書きしない。元画像は引き続き旧revisionを参照できる。
2. 内蔵image_genで、同じ顔料表現の独立した透過キャラを作る。全身、帽子、しっぽ、手足が欠けず、隣と重ならない参照を用意する。
3. `sources` に原本のパス・SHA・bytes・プロンプト・元の参照を、`subjects` に `id`、保管先の `atlas`、`source`、`crop`、`size` を1件ずつ追加する。1体だけの原本は `isolation: "whole"` で離れた部品も保持する。人型なら `size: "person"`。帽子・大きな耳がある場合は `bodyTop` に頭頂の元画像Y座標を、524の2点のように身体と分ける下側の部品がある場合は `bodyBottom` に身体の最下端の次のY座標を指定する。人物紹介の名前・X・キャラIDの対応も共通名簿へ追加する。
4. `npm run cave:build-art -- --recipe=assets/camp-cave/<新revision>/recipe.json` で配信画像、UVと身体基準の表、URLとSHA、2つのmanifestを更新する。10個の保管先は画面上のグループではないので、空きのあるアトラスを使える。1枚5体まで、切り出しの高さ180px以上、配信1024px以下を検証する。
5. `npm run build`、関連テスト、`npm run cave:check-art`、`npm run cave:murals -- --check` を実行する。人物の寸法を変えずに左右へ並べ直す。壁に収まらない場合は明確に失敗し、全員を縮めて隠さない。
6. `node scripts/measure-cave-gallery.mjs <配信GLB> <制作フォルダー>/qa/surfaces.json` と `node scripts/verify-cave-mural-coverage.mjs <surfaces.json> <制作フォルダー>/qa/coverage.json` で顔料と実壁を照合する。`node scripts/qa-cave-mural-continuity.mjs output/playwright/<新しいQA名>` を実行し、左右・手前・奥・人物全員と動物の輪郭を目視する。
7. 原画・変更前・配信後の特徴とポーズを比較し、レシピの `identityReview` に原画のSHA・配信画像とUV・実際の洞窟での確認を記録する。目視後に `node scripts/adopt-cave-mural-art.mjs output/playwright/<新しいQA名>/report.json` で新素材の採用証明を記録する。証明は先行する最適化のSHA、今回の画像、原画との比較を結び付ける。画像を変更すると古い証明では公開用ビルドが通らない。最後に `npm run check`、書式、全テスト、必要な公開用ビルドを確認する。commit・push・公開はユーザーの指示時だけ行う。

縮尺は [cave-gallery-layout.ts](../../../src/cave-gallery-layout.ts) の `CAVE_MURAL_SCALE`、身体とUVの生成表は [cave-mural-art.mts](../../../shared/cave-mural-art.mts)。写真の透明余白やアトラスの収納幅を変えても、画面上の人物の身長は変わらない。追加した人物2体を含む回帰検証で既存全員と動物の幅・高さ・足元が不変なことを確認する。

## 非表示と復元

従来どおり `npm run cave:murals -- --hide <ID>`／`--show <ID>` を使う。r39以降は独立した人物の投影を外して全体を詰め直す。動物と残した人の画像・寸法は保持する。`--preview <出力先>` は適用せず、配置JSONと確認用の元アトラスを出力する。アトラス自体から人を消す操作ではない。古いr38以前の個別画像合成も保管・回帰検証している。

## 検証

全1,827テスト中1,823合格、失敗0、任意のPython等4件スキップ。型・strict・JS構文・依存境界・書式・素材再生成照合が合格。実壁の44配置・顔料9,047点の逸脱0。人型の実描画ピクセルから測る身体寸法と足元、曲線距離、将来の2人追加、満杯時の拒否、非表示と復元、古い素材の保全も検証した。

Chrome 155.0.8059.41、1440×900と390×844相当で、実操作による開始・PC歩行、左右各5地点の11.5m正射影、斜め視点、待機中とゲーム内を確認。実行時に読む顔料11画像のSHAを両環境で確認し、ブラウザーエラー・ゲームAPI・WebSocket通信0。21枚の画面と報告は `output/playwright/cave-continuity-20261016-r02/`、[採用レビュー](../qa/adoption-murals-r39.json)、[画像更新の証明](../qa/source-texture-revision-r39.json)。

公開用ソロビルドは `output/cave-continuity-public-20261016-r01/` に分離して検証した。物理スマホ・Safari・ゲームパッド・性能比較・複数人接続は未検証。通常サーバーの再起動、保存編集、展示作成・配布、commit／push、公開反映は行っていない。

公開用ビルドそのものの実Chrome QAでも、開始・洞窟からの入場・保存と復帰・別タブの競合防止・スマホの実タッチ操作など7項目が合格。エラー・ゲームAPI・WebSocket通信0。`output/playwright/cave-continuity-public-20261016-r01/result.json` に記録した。
