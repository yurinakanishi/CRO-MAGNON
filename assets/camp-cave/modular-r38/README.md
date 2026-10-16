# 壁画の人物単位の差し替えレシピ r38

`modular-r37/recipe.json` の9群・23体をそのまま引き継ぎ、Ryuichiの1群・1体を追加した。現在は全員表示（`cave-mural-visibility.json` の `hidden: []`）。

新しい画像と生成指示は [ryuichi-frieze-r38](../ryuichi-frieze-r38/README.md)。領域は1024×341の配信画像上で定義し、内側4pxを馴染ませる。指定人物の領域外と、表示を残す他の人物の輪郭内の画素を保護する従来の合成処理を使う。

`node scripts/compose-cave-murals.mjs --check` と関連テストを通過。Ryuichi単独の動物版は `output/contributors-unified-20261016/animal-preview/ryuichiFrieze.png` で確認。実際の採用設定は変更していない。以前のレシピは保管する。
