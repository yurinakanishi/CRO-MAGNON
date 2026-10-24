# Jank0vicさんの顔の周りに「！」を並べる（2026-10-22・素材r44）

ユーザー指定：「これでいいから、周りに『！』マークをたくさん入れて。横並びで横は揃えて。」。示された形は、1行10個の「！」。顔の上下に2行ずつ、顔の左右に3個ずつ（顔の4行分）。

r43の正面の顔は「これでいい」とのことなので、そのまま使う。r43の原本・候補・記録は [jank0vic-face-r43](../jank0vic-face-r43/README.md) に残した。名簿は変えていない。

## 「！」の制作と並べ方

- **「！」の絵**：Codex CLIの内蔵image_genで、赤土（酸化鉄）の顔料で描いた「！」を8個ずつ並べたシートを2枚作った（依頼文 [codex-request.txt](codex-request.txt)、正確な指示・入力・保存元 [marks/prompts.json](marks/prompts.json)）。画風の参照は、r43の顔の原本。
  - [シート1](marks/exclaim-sheet-01.png)：標準の太さ。SHA `ce8b81a79f385d700412bfbba680c7124722600343ae7ea5cb3905bf559837b3`
  - [シート2](marks/exclaim-sheet-02.png)：太めの線と大きめの点。**採用**。壁では1個が約13cmと小さくなるため、太い方が読みやすい。SHA `0ab16dbe2fa9eeb3908e9ec425b1bef1e3e105f0a70bd513badf71af14458022`
  - 指示は [prompts/exclaim-marks.txt](prompts/exclaim-marks.txt)。
- **並べ方**：[compose-exclaim-frame.mjs](compose-exclaim-frame.mjs) がシートを4×2のマスに分けて8個を切り出し、顔の周りの格子に置いた。コードがしたのは配置だけで、線や点は描いていない。
  - 格子は10列×8行。行の間隔は顔の高さの4分の1、列の間隔は行の0.8倍。顔は中央の4列×4行を占める。
  - 「！」は64個。8種類の筆跡を、行でも列でも隣が同じにならない順に使う。
  - 高さはすべて行の間隔の0.72倍にそろえた（縦横比は保持）。
  - 位置は、各行で点の下端（ベースライン）、各列で中心をそろえた。実際の画素から測ったずれは、行で1px以内、列で1.5px以内（2420px四方の原本上。配信の300px上では0.2px未満）。
- **顔は描き直していない**：r43の顔の切り出しを、ブレンドせずバイト単位で写した。不透明度が少しでもある774,594画素がすべて一致する。顔の下に「！」は重なっていない。
- 合成した原本：[source/jank0vic-exclaim-r01.png](source/jank0vic-exclaim-r01.png)（2420×2420 RGBA、4,609,198 bytes、SHA `6e4ed4933e8c92f86e15b97f215d48d321dec9d5682098c3a0f7e9bdb8456e80`）。格子・各「！」の位置・顔の位置・入力のSHAは [qa/frame-layout.json](qa/frame-layout.json)。

## レシピと配信

[recipe.json](recipe.json) は `jank0vic-face-r43/recipe.json` を写し、`jank0vic` の原本を合成画像（`jank0vic-exclaim`）に替えた。

- 原本の記録には、入力2つ（r43の顔・採用シート）、配置記録、参照を記載した。
- 体の基準は、r43と同じ顔の高さ0.72m（`size: "small"`）。`bodyTop` 617・`bodyBottom` 1803で、顔の頭頂と首の下端を指定した。
- `lift` 0.3351mで、一番下の行の「！」がほかの前景の足元（Y=1.4m）にのるようにした。顔の下端はY=1.735m、上端の行はY=2.83m。

`npm run cave:build-art -- --recipe=assets/camp-cave/jank0vic-exclaim-r44/recipe.json` で再梱包した。

- 変わった配信画像は `maeKohaku` の1枚だけ：`/models/camp-cave/mae-kohaku-sprites-r44-ce962ad820c3df46.png`（1024×341、566,311 bytes、SHA `ce962ad820c3df467109b49a6e11b605639dffdb705d101241bd2ab18c320eda`）。
- 枠全体の切り出しは300×300px（顔は約147px）。mae・こはくの切り出し位置と縮小率は同じ。
- ほかの9枚はURL・SHAとも同じ。アトラス10枚の合計は4,150,210 bytes。
- 最初の合成では、顔の色がブレンドの丸めで1だけずれていた。その未採用の配信画像（`…r44-2c08ad66….png`）は採用前に削除した。r42・r43の画像は残している。

## 配置

東壁の奥、匿名Fさんの次（局所Z=-36.88）。枠全体は幅・高さとも1.47m。

- 既存の絵の大きさ・足元・UVは変わらない。西壁は同一。
- 東壁は前景8体が入口側へ0.09〜0.74m動いた。順番は同じで、前景の間隔は最小0.34m。

## 照合と採用

- [identity-review.json](qa/identity-review.json)：24体は `retain`（配信の切り出しがr43とピクセル一致）。`jank0vic` は `redraw` で、r43の顔・シート2枚・採用シート・配置記録・原本・配信を結び付けた。比較ページは [qa/index.html](qa/index.html)。
- 実壁との照合：[surfaces.json](qa/surfaces.json) は全77配置・32,725点でレイの欠落0。[coverage.json](qa/coverage.json) は顔料14,765点で、壁の外へのはみ出し0（枠の部分は82点）。
- 採用：[adoption-murals-r44.json](../qa/adoption-murals-r44.json)、[配信素材の更新証明](../qa/source-texture-revision-r44.json)。
- 変更前（r43）の記録：[previous-asset.json](previous-asset.json)、[previous-art.mts.txt](previous-art.mts.txt)、[previous-layout.ts.txt](previous-layout.ts.txt)、[previous-placements.json](previous-placements.json)。

検証の詳細は [docs/changelog/2026-10.md](../../../docs/changelog/2026-10.md) の該当項目。公開版への反映は未実施。
