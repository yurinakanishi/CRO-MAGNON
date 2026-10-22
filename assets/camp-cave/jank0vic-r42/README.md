# Jank0vicさんを壁画に追加（2026-10-22・素材r42）

**公開状況：同日22:48 JSTに[ソロ公開版へ反映](../../../docs/solo-release-2026-10-22.md)。公開後の配信画像SHAと、PC／タッチでのタイトル・壁画の名簿・世界への開始を検証済み。以下は制作・採用時点の記録。**

ユーザー指定：https://x.com/Jank0vic のJank0vicさんを、タイトルの「関わってくれた人たち」と洞窟の壁画（「壁画の人々」を含む）の両方に追加する。確認への回答（依頼元のセッション経由）は「A：Xの顔写真を参照に、ほかの人と同じ顔料の人物画にする。写真は制作資料として保存し、カードには出さない」「表示名はXの表示名のまま」。

## 名簿

`src/title-credit-profiles.ts` の `TITLE_FRIENDS` の末尾（匿名Fさんの次、OpenAI Dotsの前）へ追加した。表示名は公開Xページの表示名どおり「個人開発・タコス・ビリヤニ・やんこ」、リンクは `https://x.com/Jank0vic`、キーは `jank0vic`。壁画との対応は `src/title-credits.ts` の `CONTRIBUTOR_MURAL_SUBJECTS`（`jank0vic: ['jank0vic']`）。タイトルは18枚、洞窟の「壁画の人々」は17枚になり、同じ名前・X・並び順を共有する。公開用ビルドも同じ名簿を書き出す。カードは名前とXアイコンだけで、写真・@ID・キャラ名は出さない。展示ビルドではリンクなし（既存の処理）。

## 参照と生成

- 本人らしさの参照：[Xのアイコン写真](references/x-avatar-400x400.jpg)（400×400 JPEG、27,473 bytes、SHA-256 `f3bf812411300fd17c36c6a883ddea78ff547376b2684e5dc471411430ecb191`）。取得元・ページ名・承認は [x-avatar.json](references/x-avatar.json)。制作資料としてだけ保存し、`public/` や公開用ビルドには入れていない（公開用ビルドのJPEGに同じSHAがないことを確認）。
- 画風の参照：既存の壁画の [Howkeyさんの原本](../identity-r41/source/howkey-scientist-r01.png)（髪・眼鏡・白衣・フラスコは写さない指示）。
- **Codex CLIの内蔵image_gen** で透過PNGの候補を3枚生成した（依頼文 [codex-request.txt](codex-request.txt)、各候補の正確な指示と保存元 [candidates/prompts.json](candidates/prompts.json)）。写真の「FaceApp」の印は写さない指示にした。
  - [候補1](candidates/jank0vic-candidate-01.png)：右向きに歩きながら手を振る。**採用**。SHA `7d5b7ebd462642929c3acab8bec015cee904a08fa038df03308bfa26415424e1`
  - [候補2](candidates/jank0vic-candidate-02.png)：立って手を振る。SHA `66df6e57e5d7892a7a33685a366dae9ed51bd10a74fdcd2c090d4a7951305659`
  - [候補3](candidates/jank0vic-candidate-03.png)：両腕を振って歩く。SHA `608594a61c78a8cc1f2993b115d44917045b7913c52816733c59d86a7ec4da19`
- 採用した原本：[source/jank0vic-r01.png](source/jank0vic-r01.png)（候補1とバイト一致、1254×1254 RGBA、1,507,212 bytes）。指示は [prompts/jank0vic.txt](prompts/jank0vic.txt)。行列に合う歩く姿で、写真の特徴（立ち上がった黒い短髪、歯を見せた笑顔、少し大きな耳、立ち襟の紺のジャケットと白いシャツ）を残している。写真と同一の顔やピクセル単位の似姿を主張するものではない。

コードで輪郭や絵を描いていない。技術処理は透明余白の切り出し・縦横比を保った縮小・アトラスへの梱包だけ。

## レシピと配信

[recipe.json](recipe.json) は採用中だった `identity-r41/recipe.json` を写し、`jank0vic-identity` の原本・指示・参照2点と、`jank0vic` の1件だけを加えた（`crop` [252, 14, 1114, 1244]、`size: "person"`、`isolation: "whole"`、帽子や離れた部品がないため `bodyTop`／`bodyBottom` なし）。24体の原本・切り出し・r41の修復はそのまま。

`npm run cave:build-art -- --recipe=assets/camp-cave/jank0vic-r42/recipe.json` で再梱包した。空きのある保管先 `maeKohaku` の末尾に入れたため、mae・こはくの切り出し位置と縮小率は変わらない。

- 変わった配信画像は1枚だけ：`/models/camp-cave/mae-kohaku-sprites-r42-f95eaf3ec1b5ca8b.png`（1024×341、569,672 bytes、SHA `f95eaf3ec1b5ca8b9a4e224ad4d2cabfa59be2fe4f6a43a19913e2e3471a48dc`）。r39の `mae-kohaku-sprites-r39-89a83ebad514c613.png`（459,983 bytes）は削除せず残した。
- ほかの顔料アトラス9枚は、URL・SHAとも同じ。アトラス10枚の合計は4,153,571 bytes（r41の4,043,882 bytesより109,689 bytes増）。枚数とテクスチャの予算は変えていない。
- 新しい切り出しは210×300px（1024px以下）。
- 洞窟GLB（`model-r28-deep.glb`）、ゲーム内モデル、配置コード（`CAVE_MURAL_LAYOUT_REVISION` 40）は変更していない。

## 配置

自動配置で東壁の奥、匿名Fさん（局所Z=-35.99）の次の局所Z=-37.03に入った。その奥にはケサイがいる。身体1.4m（画像の高さ1.447m・幅1.014m）、足元はほかの前景と同じY=1.4。

- 既存76配置は、幅・高さ・下端・足元・濃さ・UV矩形が1つも変わっていない。西壁は配置もr41と同一。
- 東壁では、1人増えた分の詰め直しで前景10体の位置が動いた。隣り合う人物と動物の順番が3か所で入れ替わった（三角のDot↔シカ、Saber↔アイベックス、Howkey↔オーロックス）。端の位置と、りもねこ・524の向かい合う位置（局所Z=-21.2）は保持されている。
- 前景の間隔はすべて0.16m以上で、人物同士は重ならない。

## 照合と採用

- [identity-review.json](qa/identity-review.json)：25体。24体は `retain` で、配信の切り出しをデコードしたピクセルがr41の切り出しと完全に一致した（[make-identity-review.mjs](make-identity-review.mjs) が検査して記録）。`jank0vic` は `new` で、参照写真・画風参照・候補3枚・原本・配信のURL／SHA／UVを結び付けた。比較ページは [qa/index.html](qa/index.html)。
- 実壁の照合：[surfaces.json](qa/surfaces.json) は全77配置でレイの欠落0。[coverage.json](qa/coverage.json) は顔料14,862点で壁外への逸脱0（うち新しい人物は179点）。
- 採用：[adoption-murals-r42.json](../qa/adoption-murals-r42.json)、[配信素材の更新証明](../qa/source-texture-revision-r42.json)。
- 変更前の記録：[previous-asset.json](previous-asset.json)、[previous-art.mts.txt](previous-art.mts.txt)、[previous-layout.ts.txt](previous-layout.ts.txt)、[previous-placements.json](previous-placements.json)（r41の76配置）。

検証の詳細は [docs/changelog/2026-10.md](../../../docs/changelog/2026-10.md) の2026-10-22の項目にまとめた。
