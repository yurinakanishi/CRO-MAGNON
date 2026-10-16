# 原画から壁画の特徴を修復する（2026-10-16・素材r41）

ユーザー指定：524の黄色い2点が失われたため、最初に渡された原画から精度を戻す。他のキャラも品質が落ちたものを直し、現在のポーズは保つ。

全24体を、保存済みのユーザー原画または従来の制作参照と比較した。修復は以下の7体。17体は既存の生成原本を保持し、6枚の配信PNGはSHAまで同一。変更した配信PNGは4枚で、顔料アトラス10枚・岩肌などを合わせたテクスチャ12枚の予算は変えていない。顔料アトラス10枚の合計は4,043,882 bytesで、r39の4,118,695 bytesから74,813 bytes減った。性能改善を示す計測ではない。

| キャラ | 原画に合わせて戻した特徴 | 原本と生成指示 |
| --- | --- | --- |
| 524 | 本体と離れた黄色い2点、上の2つの突起、数字ごとの白い囲み | [画像](source/524-r01.png)・[指示](prompts/524.txt) |
| ぬこぬこ | 黒い首輪と、丸い金のペンダント内の星（リボンに置き換わっていた） | [画像](source/nukonuko-mascot-r01.png)・[指示](prompts/nukonuko-mascot.txt) |
| さが | 角の丸い四角い眼鏡、棒状の銀のイヤリング、黒いパーカーの上の青いベスト | [画像](source/sagasa-mascot-r01.png)・[指示](prompts/sagasa-mascot.txt) |
| Saber | 麦わら帽子の白い花とリボン | [画像](source/saber-mascot-r01.png)・[指示](prompts/saber-mascot.txt) |
| オータニ | 帽子のカーソル、緑のハート飾り、ヘッドセットのマイク、胸の緑の印 | [画像](source/otani-mascot-r01.png)・[指示](prompts/otani-mascot.txt) |
| Howkey | 白衣の赤い盾の印、グレーのベストと開いた白い襟、髪の淡い毛先 | [画像](source/howkey-scientist-r01.png)・[指示](prompts/howkey-scientist.txt) |
| 匿名F | 目元の紫の帯と紫のネクタイ | [画像](source/daredaro-r01.png)・[指示](prompts/daredaro.txt) |

[原画・変更前・配信後の24体比較](qa/index.html)、[確認した特徴・参照SHA・配信SHAとUV](qa/identity-review.json)。各修復は**内蔵image_gen**で、変更前の姿を編集対象、原画を特徴の基準として個別に制作した。元の参照画像の立ち姿へ置き換えず、歩く向き・手足の動き・手振り・立ち姿を比較した。ピクセル単位で同一のポーズという意味ではない。

## 元の欠落と、再発を防ぐ処理

r39の生成指示には「点々の軌跡を消す」とあり、524固有の2点を保持する指定がなく、生成原本の時点で欠けていた。この指示が欠落につながったと判断した。さらに、隣のキャラが写り込む旧6体シート用に「最大の連結した顔料だけを残す」切り出し処理を使っていたため、正しい画像に2点があっても落とし得た。

新しい7原本はそれぞれ1体だけなので、[recipe.json](recipe.json) の `isolation: "whole"` で**元の透過ピクセル全体を保持する**。旧シート17体は従来の分離方法を保持する。524の原本と配信PNGで、本体＋独立した2点の計3つの顔料が残ることを回帰テストで確認する。

524には `bodyBottom`（原本Y=982）も登録した。2点を身体の最下点と取り違えて本体を縮めず、身体の高さ0.72mと浮いた足元（洞窟のローカルY=1.62m）を維持する。帽子や耳がある人物には従来どおり `bodyTop` を登録する。人物の身体1.4m、動物の種類別寸法、曲線距離による投影、上下の重なりの配置方式は維持。洞窟GLB、ゲーム内モデル、リグ・アニメーションは変更していない。

## 保管と追加・修復の手順

新しい作業は、`public/models/camp-cave/asset.json` の **現在の** `muralComposition.recipe` を新revisionへコピーして開始する。r39のレシピから始めると今回の修復が失われる。新しいキャラや修復するキャラだけの原本を作り、元の参照・編集対象・生成指示・SHA・切り出し範囲を記録する。新しい1体だけの原本には `isolation: "whole"` を指定し、離れた小物・点・アクセサリーを残す。身体の高さに含めない下側の部品がある場合は `bodyBottom` を指定する。

梱包は `npm run cave:build-art -- --recipe=assets/camp-cave/<新revision>/recipe.json`。画像のバイトが同じ場合は既存URLを再使用する。全員分の `identityReview` に原画・変更前・配信PNGとUV・確認した特徴を記録し、実Chromeで見た後に `reviewedInGame` を記録する。採用コマンドは、確認した画像と実際の配信SHA／UVが一致することを検証し、以前の採用記録を上書きしない。

[変更前のmanifest](previous-asset.json)、[配置](previous-layout.ts.txt)、[身体・UVの表](previous-art.mts.txt)、[全76配置](previous-placements.json)、全24体の変更前の実配信切り出し [inputs](inputs/)、新しい原本7枚 [source](source/)、指示 [prompts](prompts/)、配信と同一の梱包画像 [packed](packed/) を保持する。r39・r40以前の素材・QAも保持した。

## 検証

配信PNGの524が本体＋2点の3つの独立部分を持つこと、元の透過ピクセル保持、原画・元画像のSHA、7体の修復／17体の保持、身体の寸法と足元、左右の連続した重なり、将来のキャラ追加、非表示と復元を検証。実壁76配置・顔料14,683点で逸脱0。

Chrome 155.0.8059.41、PC 1440×900／スマホ相当390×844で、実操作の開始・PC歩行、左右各5地点の同じ幅の正射影、待機中とゲーム内の斜め視点を確認。21画面、顔料11画像の実配信SHA、画面エラー・ゲームAPI・WebSocket通信0。記録は `output/playwright/cave-identity-20261016-r01/`。

[採用レビュー](../qa/adoption-murals-r41.json) と [配信素材の更新証明](../qa/source-texture-revision-r41.json) は、原画との比較と実際の画像・コード・壁面QAに結び付けた。型・strict・701 JS構文・依存境界・書式、素材再生成照合、公開用ソロビルドが合格。

全1,832テスト中1,828合格、失敗0、任意のPython等4件スキップ。初回の全体実行は1,827合格・Windowsの原子的ファイル置換でEPERMによるタイムアウト1件・4件スキップ。該当ファイルの6テストを単独で再実行して全合格し、同時実行数4で全体を再実行して失敗0を確認した。無関係なファイル置換の実装は変更していない。最終ログは `output/cave-identity-full-tests-final-20261016.log`、初回は `output/cave-identity-full-tests-20261016.log`、単独は `output/cave-identity-atomic-retry-20261016.log`。

公開用ソロビルドは `output/cave-identity-public-20261016-r01/` に分離し、781ファイル・87 GLB・137.4 MiBで作成。ビルドそのものを実Chromeで開始・自動保存・タイトルからの復帰・別タブの競合防止・390px画面の選択と実タッチ操作まで検証して7項目合格、ゲームAPI・WebSocket通信0。結果は `output/playwright/cave-identity-public-20261016-r01/result.json`。

物理スマホ・Safari・実ゲームパッド・複数人接続・性能比較は未検証。通常サーバーの再起動、ユーザー保存の編集、展示作成・配布、commit／push、公開反映は行っていない。
