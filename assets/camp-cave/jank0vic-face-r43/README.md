# Jank0vicさんの壁画を、写真に似せた正面の顔だけに描き直す（2026-10-22・素材r43）

**後継：同日、ユーザー指定でこの顔の周りに「！」を並べた（[素材r44](../jank0vic-exclaim-r44/README.md)）。顔の画素はr44でもそのまま。**

ユーザー指定：「ちゃんと似た顔にして。壁画。正面向きでいい。顔だけでいい。体いらない。」

r42の歩く全身像（同日22:48 JSTに公開済み）は、ちびキャラの大きな目で写真に似ていなかった。r42の原本・候補・記録は [jank0vic-r42](../jank0vic-r42/README.md) にそのまま残し、このr43で人物1体だけを差し替えた。名簿（表示名・X・並び順）は変えていない。

## 参照と生成

- 写真：r42で保存した [Xのアイコン写真](../jank0vic-r42/references/x-avatar-400x400.jpg)（SHA `f3bf8124…`、取得記録 [x-avatar.json](../jank0vic-r42/references/x-avatar.json)）。今回は写真を **編集対象（Input 1）** にした。顔の形・比率・表情・正面の角度を保ったまま、壁画の顔料の技法で描き直す指示にした。制作資料としてだけ使い、配信物・公開用ビルドには入れていない。
- 画風の参照（Input 2）：既存の壁画の [Howkeyさんの原本](../identity-r41/source/howkey-scientist-r01.png)。技法だけを参照し、ちびの比率・大きな目・髪・眼鏡・服は写さない指示にした。
- **Codex CLIの内蔵image_gen** で、首から上だけの正面像を3枚生成した（依頼文 [codex-request.txt](codex-request.txt)、各候補の指示・入力・保存元 [candidates/prompts.json](candidates/prompts.json)）。prompts.jsonの「1024 � 1024」はCodexが記録を書いたときの文字化けで、指示は「1024 × 1024」。
  - [候補1](candidates/jank0vic-face-candidate-01.png)：短い首あり、写真の比率どおり。SHA `77ac6767b6b0fa793312c0b8c3cec5eaf250adf2ae9ce1fd900498768e403e32`
  - [候補2](candidates/jank0vic-face-candidate-02.png)：首なし。顔が写真より丸く広い。SHA `6577d4ea7c901d83b5458bc12c394fcffad9ff322d46af9b8154008245a81821`
  - [候補3](candidates/jank0vic-face-candidate-03.png)：短い首あり、線を少し太く簡潔に。**採用**。SHA `3654946f68d7820314f257180df7bb1c68215d20c50328dbd4b6277371ef69f3`
- 写真と並べて比べ、似ている度合いで候補3を採用した。決め手は、顎へ細くなる卵形の輪郭、まっすぐで太めの眉、笑って細くなった一重の目、上の歯が並ぶ笑顔の幅、片側へ流れて立ち上がる黒髪、左右に張り出した耳。写真と同一の顔やピクセル単位の一致を主張するものではない。
- 採用した原本：[source/jank0vic-face-r01.png](source/jank0vic-face-r01.png)（候補3とバイト一致、1254×1254 RGBA、2,318,145 bytes）。指示は [prompts/jank0vic-face.txt](prompts/jank0vic-face.txt)。

コードで輪郭や絵を描いていない。技術処理は、透明余白の切り出し・縦横比を保った縮小・アトラスへの梱包だけ。

## レシピと配信

[recipe.json](recipe.json) は採用中だった `jank0vic-r42/recipe.json` を写した。変えたのは `jank0vic` の原本（`jank0vic-face`）と1件の登録だけ（`crop` [182, 13, 1076, 1239]、`isolation: "whole"`）。ほかの24体の原本・切り出し・修復は変えていない。

体の大きさは、顔だけの絵なので、丸いDots・mae・524と同じ共通の `size: "small"`（頭頂から下端まで0.72m）にした。人型の1.4mのままだと、顔だけが1.4mの大きさになるため。

`npm run cave:build-art -- --recipe=assets/camp-cave/jank0vic-face-r43/recipe.json` で再梱包した。

- 変わった配信画像は `maeKohaku` の1枚だけ：`/models/camp-cave/mae-kohaku-sprites-r43-1c613ec1b6055b81.png`（1024×341、619,474 bytes、SHA `1c613ec1b6055b8144d1a41b5ba6efa8f54a0ec81994062f3e38c70426b08762`）。mae・こはくの切り出し位置と縮小率は同じ。r42の画像（`mae-kohaku-sprites-r42-f95eaf3e…`）は削除せず残した。
- ほかの9枚はURL・SHAとも同じ。アトラス10枚の合計は4,203,373 bytes（r42より49,802 bytes増）。
- 新しい切り出しは218×300px。
- 洞窟GLB・ゲーム内モデル・配置コードは変更していない。

## 配置

東壁の奥、匿名Fさんの次（局所Z=-37.18）。幅0.54m・高さ0.74mで、首の下端はほかの前景と同じY=1.4にある。

- 既存の配置は、大きさ・足元・UV矩形が1つも変わっていない。西壁は配置も同一。
- 東壁は、絵の幅が細くなった分の詰め直しで、前景8体が0.05〜0.38m動いた。順番の入れ替わりはない。

## 照合と採用

- [identity-review.json](qa/identity-review.json)：25体。24体は `retain` で、配信の切り出しがr42と完全にピクセル一致した（[make-identity-review.mjs](make-identity-review.mjs) が検査）。`jank0vic` は `redraw` で、写真・画風参照・r42の絵・候補3枚・原本・配信のURL／SHA／UVを結び付けた。比較ページは [qa/index.html](qa/index.html)。
- 実壁との照合：[surfaces.json](qa/surfaces.json) は全77配置・32,725点でレイの欠落0。[coverage.json](qa/coverage.json) は顔料14,950点で、壁の外へのはみ出し0（うち顔は267点）。
- 採用：[adoption-murals-r43.json](../qa/adoption-murals-r43.json)、[配信素材の更新証明](../qa/source-texture-revision-r43.json)。
- 変更前（公開済みのr42）の記録：[previous-asset.json](previous-asset.json)、[previous-art.mts.txt](previous-art.mts.txt)、[previous-layout.ts.txt](previous-layout.ts.txt)、[previous-placements.json](previous-placements.json)。

検証の詳細は [docs/changelog/2026-10.md](../../../docs/changelog/2026-10.md) の2026-10-22の項目。公開版への反映は未実施（デプロイは明示の指示があったときだけ行う）。
