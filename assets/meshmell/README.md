# CRO-MAGNON — Meshmell公開モデル

肉のカバーはユーザーの違和感の指摘を受け、草原の遠景から石台とぼけた森林の近景へ変更しました。上面が分かるpolar 65°で撮り直したr02をモデル183へ設定し、画像ID260の保存を確認済みです。GLBの形・色・バイト列は保持し、r01と旧画像ID244の履歴も残しています。

2026-09-07: 全31件に960×960のカバー画像を追加済み。画像ID229〜259をCLIのexact-ID readbackで確認しました。`../threed-model-creation` の `render_composite_frames.mjs` と既存の風景背景を使用し、配信GLBそのものを撮影しました。画像・ハッシュ・撮影角度・公開先の対応は `covers.json`、検証結果は `cover-qa.json`、履歴は `history/` に保存しています。

人物・動物は斜め正面45°／polar 80°、平面地形は上面を見せるpolar 65°。槍と針葉樹は余白を確保したr03を採用し、前の画像も保持しています。この2件だけローカルコピーのプレビューHTMLでカメラ距離上限を緩め、距離120%で撮影しました。元GLBや隣のリポジトリは変更していません。

カバー追加は `node scripts/meshmell-covers.mjs --upload`。生成・目視検査を完了した画像だけを、記録済みのモデルIDへ `models update --cover-image` で反映します。動画・X投稿を伴う完全リリースrunnerは今回実行せず、画像追加に必要な描画ヘルパーと公式CLIを使用しています。

2026-09-07: 採用版GLB全31件を公式CLIで公開しました。ライセンスはCC-BY-4.0、クレジットはYuri Nakanishiです。

全31件を作成済みIDで読み戻し、公開設定・名前・説明・ライセンス・クレジットを確認しました。表示用GLBを公式CLIで再取得し、元ファイルとのSHA-256一致も全件確認しました。

アニメーションを含む8件は、GLB内の動作データをそのまま保持しています。ただしMeshmell側のactions一覧は空です。サイトの動作選択UIへの登録は未完了です。

## 公開URL

- [Bear Mage](https://meshmell.com/ja/viewer/models/bear-mage) — ID 168
- [Berry Bush](https://meshmell.com/ja/viewer/models/berry-bush) — ID 169
- [Cat Kunoichi](https://meshmell.com/ja/viewer/models/cat-kunoichi) — ID 170
- [Cro Magnon Hunter](https://meshmell.com/ja/viewer/models/cro-magnon-hunter) — ID 171
- [Cro Magnon Woman](https://meshmell.com/ja/viewer/models/cro-magnon-woman) — ID 172
- [Crow Shaman](https://meshmell.com/ja/viewer/models/crow-shaman) — ID 173
- [Desert Cactus](https://meshmell.com/ja/viewer/models/desert-cactus) — ID 174
- [Desert Ground](https://meshmell.com/ja/viewer/models/desert-ground) — ID 175
- [Drying Rack](https://meshmell.com/ja/viewer/models/drying-rack) — ID 176
- [Firewood Pile](https://meshmell.com/ja/viewer/models/firewood-pile) — ID 177
- [Flint Spear](https://meshmell.com/ja/viewer/models/flint-spear) — ID 178
- [Glacier Spires](https://meshmell.com/ja/viewer/models/glacier-spires) — ID 179
- [Hide Tent](https://meshmell.com/ja/viewer/models/hide-tent) — ID 180
- [Ice Ground](https://meshmell.com/ja/viewer/models/ice-ground) — ID 181
- [Kunoichi Katana](https://meshmell.com/ja/viewer/models/kunoichi-katana) — ID 182
- [Mammoth Meat](https://meshmell.com/ja/viewer/models/mammoth-meat) — ID 183
- [Meadow Grass](https://meshmell.com/ja/viewer/models/meadow-grass) — ID 184
- [Meadow Ground](https://meshmell.com/ja/viewer/models/meadow-ground) — ID 185
- [Neanderthal Hunter](https://meshmell.com/ja/viewer/models/neanderthal-hunter) — ID 186
- [Neanderthal Woman](https://meshmell.com/ja/viewer/models/neanderthal-woman) — ID 187
- [River Water](https://meshmell.com/ja/viewer/models/river-water) — ID 188
- [Snow Ground](https://meshmell.com/ja/viewer/models/snow-ground) — ID 189
- [Stone Axe](https://meshmell.com/ja/viewer/models/stone-axe) — ID 190
- [Stone Firepit](https://meshmell.com/ja/viewer/models/stone-firepit) — ID 191
- [Valley Boulder](https://meshmell.com/ja/viewer/models/valley-boulder) — ID 192
- [Valley Pine](https://meshmell.com/ja/viewer/models/valley-pine) — ID 193
- [Volcanic Basalt Columns](https://meshmell.com/ja/viewer/models/volcanic-basalt-columns) — ID 194
- [Volcanic Cone](https://meshmell.com/ja/viewer/models/volcanic-cone) — ID 195
- [Volcanic Ground](https://meshmell.com/ja/viewer/models/volcanic-ground) — ID 196
- [Wood Footbridge](https://meshmell.com/ja/viewer/models/wood-footbridge) — ID 197
- [Woolly Mammoth](https://meshmell.com/ja/viewer/models/woolly-mammoth) — ID 198

## 記録と再実行

- uploads.json: 各ID、URL、ハッシュ、読み戻し結果。
- history/: 各モデルの追記専用の成功記録。
- plan.json: ユーザー承認済みの対象とメタデータ。
- preflight.json: ローカル検証とCLI診断の結果・制約。

プロジェクト直下で node scripts/meshmell-upload.mjs はローカル検証のみ。node scripts/meshmell-upload.mjs --upload は保存済みの成功記録をスキップします。既存IDの検証途中なら同じIDで再開します。既存モデルを勝手に更新しません。

CLIのdistにはactionsコマンドがないため、動作一覧の取得には隣の公式ソースと既存tsxを起動しています。Meshmellリポジトリ自体は変更していません。

doctorの認証・権限・API互換性などは通過しましたが、リリース検証エンドポイントは利用できませんでした。CLIのインストール・更新は行っていません。詳細はpreflight.jsonを参照。
