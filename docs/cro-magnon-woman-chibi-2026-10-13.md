# クロマニョン人女性をちびキャラに作り直し（2026-10-13）

ユーザー指定「クロマニョン人女性を、ローポリのかわいい系にしたい。添付画像の感じで。クロマニョン人要素を入れて。trellis2は、使っても使わなくてもいい。」への対応記録。添付画像（手描き風テクスチャのアニメ調ちびキャラ3人）を画風の参考にし、3案の参照画像からユーザーがB（お団子）と身長「1.45 m前後」を選んだ。候補5を見せて「ゲームに組み込む」の回答を得て、**候補5 revision c5-r01 を採用した。**

## 結果

| | 採用前（c3-r03） | 採用（c5-r01） |
| --- | --- | --- |
| 見た目 | 6頭身のかわいい人物（お団子・獣皮のワンピース） | 約2.7頭身のちびキャラ：アニメ調の大きな緑の目、骨のかんざしのお団子、羊毛の襟と長袖の獣皮の上着、貝と歯の首飾り、頬の赤土の線、裾の赤土のジグザグ、毛皮のレッグウォーマー |
| 身長 | 1.67 m | **1.45 m**（頭が身長の約2/5） |
| 三角形 | 7,689 | **6,913**（体2,613＋肌118＋頭4,182） |
| 正本GLB | 2,517,496 B | **2,620,260 B** |
| 材質 | BodySurface・HeadSurface | BodySurface・**SkinSurface**・HeadSurface（肌は体と同じ画像を参照し、画像は増えない） |
| 画像 | 体1024・頭1024（各色と法線） | 同じ（頭は2048で焼いて1024へ縮小。顔は頭の画像の31%を使い、密度1.8倍） |
| 骨・動作 | 22骨・10動作 | 22骨・10動作（Idle・Walk・Run・Gather・Craft・Give・Eat・Wave・Attack・Downed） |
| 歩行・走行の動作 | 1.04 m/s・2.96 m/s | 0.93 m/s・2.35 m/s（脚が短いので、取り込んだ動作の周期を歩行1.7倍・走行1.5倍に速めた） |

- 正本：`/models/cro-magnon-woman/model-c5-r01.glb`（SHA-256 `bc6493a2e8bd8cc3b6f2320b483851cd2c4151b5a0d0e3623fa7f4627690863e`）。旧GLBは全て残している。
- 採用記録：`assets/cro-magnon-woman/qa/c5-r01.json`（承認・各工程のSHA・設定・不採用の試行・QA）、正本更新 `assets/cro-magnon-woman/qa/source-revision-c5-r01.json`、採用前のmanifest `assets/cro-magnon-woman/archive-manifest-c3-r03-20261013.json`、ユーザーが見た比較 `assets/cro-magnon-woman/qa/c5-r01/review-c5.jpg`、全動作 `poses-front.jpg`・`poses-side.jpg`・`faces-by-clip.jpg`、参照画像・目を塗りつぶした参照画像・プロンプト `assets/cro-magnon-woman/source/c5-r01/`。ユーザーの添付画像（他作品のキャラクター）は画風の参考としてCodexに渡しただけで、git管理外の制作フォルダーにだけ置いた。
- 肖像 `portrait.png` を同じレンダラー（待機20%・420×480）で撮り直した。HUDの顔アイコンは頭が大きいので切り抜きを330%・上端4%から280%・12%に変えた（`src/style.css`）。`assets/world-models.json` の項目も更新した。

## 作り方（候補5）

制作フォルダーは `output/model-generation/models/cro-magnon-woman/`（git管理外）、記録は `work/candidate-05/candidate.json`。

1. **参照画像**：Codexの内蔵image_genに添付画像を画風の参考としてだけ渡し（3人の顔・髪型・服・色は写さない指示）、TRELLIS向けの正面Aポーズで3案を作った（`source/original/candidate5-ref-{a,b,c}.png`）。A（ボブ＋羽根）は羽根と顔の線の組み合わせが特定の民族の意匠に見えうるので勧めなかった。ユーザーはB（お団子）を選んだ。
2. **TRELLIS-2**（res 1024・tex 1024）：元の参照画像からの復元は、seed 42・123とも描かれた目を深さ2〜3 cmのくぼみとまつ毛の突起として彫り、seed 42は頬の赤土の線を赤い切り傷のように作った。
3. **顔の形を直す試行（不採用）**：密メッシュの顔を薄板スプライン面へ押す（`scripts/remake/face_plate.py`）と、くぼみの切り立った壁が裏返った三角形になり、軽量化後も残って顔の投影が三角形のモザイクになった。くぼみを切り取って輪状の面で埋める方法も、TRELLISの密メッシュに約2,000本ある非多様体の辺で穴が7つに分かれて重なった。
4. **目を塗りつぶした参照画像**：元の参照画像の目・頬の線・口・鼻を周りの肌の色で埋めた複製（`work/candidate-05/source/candidate5-ref-b-blankface.png`。肌から離れた色を楕円から広げて選び、髪の大きな領域は守り、顔の肌に当てた2次の色の面で塗る）からTRELLIS（seed 123）で復元すると、顔はくぼみのない滑らかな面になった。顔は後で元の参照画像から描く。
5. **軽量化**：meshoptで7,000（首より上の頭に多めに配分：`MESHOPT_BOOST=y:0.1161:1.6`）→6,952。首（0.893 m：髪の毛先と襟の間）で体と頭を分け、体は1024、頭は2048で焼いて1024へ縮小。顔の正面は `xatlas_unwrap.py --boost-box` で1.8倍の密度にした（頭の画像の31%）。
6. **色を参照画像に戻す**（新規 `scripts/remake/match_reference_colours.py`）：TRELLISの色は参照画像より暗く濃かった（髪の明るさは約半分、上着は25%暗い）。体の画像はCIELABの分位点で参照画像の首から下の色に合わせ、頭の画像は髪の色の画素だけを参照画像の髪の色の平均と広がりに合わせた。素の色の比較は、手 (254,214,177)／参照 (252,212,180)、上着 (229,206,184)／(222,192,165)、髪 (142,93,78)／(148,97,83)。
7. **顔の投影**（`project_face.py`）：元の参照画像の顔（目・まつ毛・口・頬の赤土の線）を投影した。滑らかな顔に合わせる特徴はないので光学フローは使わない。髪の保護（`--hair-guard`）は、茶色のまつ毛を髪と見なして消していたので目の楕円では外し（新規 `--guard-free`）、復元画像の額に残った細い線は髪と見なさない（新規 `--guard-min-width 9`）。肌の色は再構成の肌へ半分だけ寄せた（新規 `--tone-strength 0.5`）。
8. **肌の材質**（新規 `scripts/remake/split_skin_material.py`）：服の色替えは画素の色で布と肌を分けるが、手（色相30・彩度0.29）とクリーム色の毛皮（色相30・彩度0.22〜0.28）は区別できない。袖口より先の手、裾とレッグウォーマーの間の脚の大部分、首の前（118面）を、同じ画像を使う2つ目の材質 SkinSurface にした。
9. **リグと動作**（`scripts/remake/human_chain.sh`：22骨のリグ→槍の突き→Downed→CMUの歩行・走行）：関節の高さは合わせた低ポリ面を2 cmごとに切って測った（`--proportions`：骨盤0.305・膝0.18・肩0.53・首0.605・頭0.632・口0.664など）。腕は大人の比率（肘0.43・手首0.77）だと大きな手に手の骨の重みが付かず、肘0.40・手首0.64・手0.80にした（新規 `--arm-fractions`）。短い手の骨では手が前腕と重みを分け合い、松明の握りが手の頂点を見つけられずNaNになったので、手首から先は手の骨だけで動かす（新規 `--rigid-hands .60,.68`）。太いブーツが脛の骨に付いて足裏の接地が測れず歩行・走行の腰がNaNになったので、足首より下は足の骨だけで動かす（新規 `--rigid-feet`）。脚の長さ0.37 m（CMUの0.42倍）では、取り込んだ周期のままだと歩行の動作が0.55 m/sしかなく、既定の歩行2.0 m/sに対して再生速度の上限（1.35倍）で足が大きく滑るため、周期を歩行1.7倍・走行1.5倍に速めた（新規 `LOCOMOTION_CADENCE`。滑りは採用前の女性と同程度以下）。

## ゲームへの組み込み

体の大きさが変わった分だけ、コードの値を合わせた。どれも女性の人物の定義（`shared/character-profiles.mts`）に置いた値で、ほかのキャラクターは変わらない。

- **カメラ**：人間の注視点は1.4 mで、1.45 mの体では頭の上端になり、寄ったカメラでは本人がカメラの近くで消えていた。女性だけ `cameraFocus: 1.15`（顔の高さ）にした（`src/world3d.ts` の `focusHeight`、読み込みの洞窟のカメラ `src/loading-cave.ts` も同じ値）。
- **オーブボットを投げる手**：投げの放出点（サーバーと共通の `botHandPosition`）を、肩から手首まで0.23 mの腕が届く位置にした（`height: 1.45`、`botHandRatios: { side: 0.12, front: 0.13, height: 0.6 }`）。
- **撫でる距離**：仲間が頭を差し出す位置を0.75倍に近づけ、浮かぶ524は手の高さまで低く降りる（`petReachScale: 0.75`。`shared/companions.mts`・`shared/orb-bots.mts`）。人の背丈のHowkeyの頭（1.34 m）は手が届かないので、腕をいっぱいに伸ばしてそちらへ向ける（深くしゃがんで離れることはない）。
- **当たり判定**：毒の弾などの当たる高さは種族ごとの値（人間1.85 m。1.68 mのクノイチも同じ）のままで、体の見た目に合わせて変えていない。
- **服の色替え**（`src/clothing-dye.ts`）：BodySurface だけを染め、残った脚と首の桃色の肌（色相5〜24°・彩度0.3〜0.72・明度0.8以上）は保ち、体の高さの0.965（襟の上端0.885 m）より上は染めない。見本 `node scripts/qa-clothing-dye-palette.mjs` で9色とも服全体が染まり、顔・髪・手・膝・首が残ることを確認した（`output/clothing-dye/palette-c5-r02/`）。

## 検証

- 書き出したGLBをChrome（ゲームと同じThree.js）で全10動作×3時点×正面・側面、動作ごとの顔の近接を確認（新規 `scripts/remake/chibi_views.mjs`）。リグの検査：最大4影響・未割当0・被覆1.0。全動作の最も低い頂点は0〜5 mm（走行の浮いている間は最大3 cm）。
- 隔離サーバーで実際のタイトル→人物選択→入場：候補段階は通信の差し替え（`output/playwright/c5-candidate-game-r02/`）、採用後は `public/` の実ファイルで、Chrome 2画面＋通信参加者3の5接続。自分の待機・歩行・走行・攻撃（実キー）と、相手の画面での同じモデル（SHA一致、1,020フレーム）・同じ動作を確認。ページのエラー0（`output/playwright/c5-adopted-game-r01/`）。注視点を下げた後は、寄りのカメラ・正面の点検カメラでも本人が映る。
- マスコットを撫でる実Chromeの検査（`scripts/qa-mascot-regressions.mjs poses`、5接続）：524・りもねこ・白のオーブを全6キャラクターで実際のVキーで撫で、両画面の手と頭の距離・ハート・持ち主・別れを確認し、59項目に合格、ブラウザーエラー0（`output/playwright/c5-mascot-poses-r02/`）。女性の手と頭の距離は最大で524が2.65 cm、りもねこ0.23 cm、白1.23 cm（基準4.5 cm）。1回目（r01）は524の表面検査が女性の身長を1.67 mに固定して照合していたため止まったので、配信manifestの値と照合するように直した（`scripts/qa-524-surface.mjs`）。
- 配信用変換（`scripts/delivery/prepare-overlay.mjs`、`npm run dev`／`start` でも実行される）後の配信形式と正本の比較（`scripts/delivery/qa-cooked-models.mjs`）：PSNR 46.9 dB、骨変形後の頂点差最大0.377 mm（Eat 50%）、構造の不一致0（`output/delivery-qa/c5-r01/`）。
- 服の色替えの実Chromeの検査（`scripts/qa-clothing-dye.mjs`）：PC・英語画面・スマホ縦・タイトル開始と読み込みの洞窟・5人の相互表示・キャラクター変更の57項目に合格、ブラウザーエラー0（`output/playwright/clothing-dye-c5-r01/`、集合写真 `gathering.png`）。
- テスト：全1,647件中1,643件合格・失敗0・条件付き4件スキップ。採用直後の1回目は5件が失敗した（松明の握りのNaN 3件→手の固定、オーブボットの放出点が腕の外→手の位置の比率、槍の前の手の位置）。新しい体に合わない固定値だった2件の検査を直した：Howkeyの頭を撫でる検査は届かない体では「腕を伸ばしきって頭へ向ける」を確認し、槍の突きの検査は前の手の位置を手の間隔（身長×0.2：0.29 m）から照合する。`npm run check`（型・strict・646 JS構文・依存境界）、`npm run format:check`、`git diff --check` が合格。
- 確認していないもの：実スマートフォン、実回線、性能の実測（三角形と画像の数は採用前と同程度）、物理パッド。公開サイトへのデプロイ、展示機への配布、既存の3000／8787／4173の停止・再起動は行っていない。commit／pushはしていない。

## 追加・変更した道具

- 新規：`scripts/remake/chibi_views.mjs`（頭の大きい人物の全身・顔の近接・参照画像の画素に合わせた正面）、`match_reference_colours.py`（参照画像の色へ戻す）、`split_skin_material.py`（肌を別の材質へ）、`face_plate.py`（顔の形の修正。試行のみで不採用）。
- 変更（既定の動作は従来どおり）：`project_face.py`（`--guard-free`・`--guard-min-width`・`--tone-strength`）、`xatlas_unwrap.py`（`--boost-box`）、`rig_human_c2.py`（`--arm-fractions`・`--rigid-hands`・`--rigid-feet`）、`build_locomotion_one.mjs`（`LOCOMOTION_CADENCE`）、`adopt_candidate_character.mjs`（候補の記録の項目と `--geometry-source`）。

## 変更したファイル

- モデル・記録：`public/models/cro-magnon-woman/`（`model-c5-r01.glb`（新規）・`asset.json`・`portrait.png`）、`assets/cro-magnon-woman/`（`qa/c5-r01.json`・`qa/c5-r01/`・`qa/source-revision-c5-r01.json`・`source/c5-r01/`・`archive-manifest-c3-r03-20261013.json`）、`assets/world-models.json`
- 共通：`shared/types.mts`（`cameraFocus`・`petReachScale`）、`shared/character-profiles.mts`、`shared/companions.mts`、`shared/orb-bots.mts`
- 描画：`src/world3d.ts`、`src/loading-cave.ts`、`src/clothing-dye.ts`、`src/style.css`
- テスト・QA：`tests/tall-companion-petting.test.mjs`、`tests/spear-thrusts.test.mjs`、`scripts/qa-524-surface.mjs`
- 制作の道具：上記「追加・変更した道具」

## 仲間のデザイン候補（同日）

ユーザー指定「AとCみたいなのも作って。 女の子と男の子、何種類かつくりたい。codex のサブスク枠でgpt-image使って候補いくつか見せて。」への対応。Codex CLI（`gpt-5.6-sol`）の内蔵 `image_gen`（ChatGPTのプラン枠）で参照画像を10枚作った。`OPENAI_API_KEY`・API・`scripts/image_gen.py` は使っていない（ログはCodexの出力を `Copy-Item` しただけで、保存した10枚は `~/.codex/generated_images/01a13385-…/` の出力と同一バイト）。毎回、採用済みの `candidate5-ref-b.png`（同じキャストに見せる）とユーザーの画風画像（全体の雰囲気だけ）を添付した。

| ID | デザイン | SHA-256（先頭16桁） |
| --- | --- | --- |
| G1 | ボブ＋耳前の三つ編み・羽根・貝の首飾り・赤茶の毛皮ケープ（A系） | `1589caedd718740a` |
| G2 | ホラアナグマの子の毛皮フード・クマの歯の首飾り（C系） | `23a39b4902940ad4` |
| G3 | オオカミの子の毛皮フード・青灰の瞳 | `da94fb701c3ef0f6` |
| G4 | 赤毛の短いツインテール・マンモス牙のビーズ | `41a4c04bb78f7cfd` |
| G5 | トナカイ革のパーカー・角のヘアピン・白い点の化粧 | `d0b1aee84866cbc0` |
| B1 | ツンツン髪＋貝の鉢巻き・毛皮のベスト | `a820ed3b9c80ab5a` |
| B2 | ホラアナライオンの子の毛皮フード（C系） | `01e1a99d8133b12e` |
| B3 | ぼさぼさのボブ＋三つ編み・そばかす・毛皮ケープ（A系） | `526115992fedc3d2` |
| B4 | ちょんまげ＋骨のかんざし・洞窟壁画の手形の服 | `817260485ec2948d` |
| B5 | ケナガマンモスの子の毛皮フード（小さな牙と鼻） | `6a5147ce89a1b0c7` |

置き場所（`output/` のためGit管理外）：`output/model-generation/models/chibi-cast/source/original/`（`cast1-g1.png`〜`cast1-b5.png`、依頼文 `codex-request-cast1.txt`、送ったプロンプト全文と添付と出力元の `prompts-cast1.json`、`codex-cast1.log`）、一覧 `review/cast1-sheet.png`（SHA-256 `3a0c8d293bcae500…`）。一覧をユーザーに見せた段階で、3D化はしていない（`output/model-generation/AGENTS.md` により、3Dの候補は1回の指示で1体まで）。その後ユーザーが「全員採用。」と答え、1人目のG1を作って追加した：[ちびキャラの仲間](chibi-cast-2026-10-13.md)。
