# 人物4体の顔の作り直しと、歩行・走行で顔が崩れる不具合の修正

2026-10-07。ユーザー依頼「クロマニョン人とネアンデルタール人の男性女性の顔のクオリティが低いので、ちゃんとリアルでかっこいい／かわいい顔に。歩いたり走ったりするときに顔の形が崩れるバグも直す」。途中の追加指定「クロマニョン人の男性の顔は元からかなり良い」により、クロマニョン男性は顔を作り直さず、崩れの修正だけを行った。

旧GLB（`model-c2.glb` / `lod-c2.glb` ほか）はすべて保持し、新しいGLBは別名 `model-face-r01.glb` / `lod-face-r01.glb` で採用した。

## 不具合：歩行・走行で顔が崩れる

原因は頭部プリミティブの皮膚ウェイト。顔・あご・ひげの頂点が Head 以外の骨（Chest、Neck）にも結び付いており、CMUの歩行・走行で Chest／Neck と Head が別々に回ると顔がせん断されていた。

- クロマニョン男性：顔下部が最大50% Chest・30% Neck（頭部の Head 平均0.80）。
- ネアンデルタール男性：口・ひげが Neck 70〜80%。
- 女性2体：顔は概ね Head だが、あご下・首の境目に Chest／Shoulder が混ざっていた。

修正：あごのラインに沿った曲線（側面から見たあご下〜うなじ）より上の頂点を 100% Head にし、首だけで Head → Neck → 胴体の首の付け根のウェイトへ滑らかに切り替える（`scripts/face-remake/rigid-head-weights.py`、新しい頭部は `graft-head.py` 内の同じ規則）。

全10動作×31時刻で、顔の頂点が Head 骨の剛体運動から外れる最大距離（`measure-face-rigidity.py` / `verify-graft.py`）：

| 人物 | 修正前（走行／歩行／攻撃、最大） | 修正後 |
| --- | --- | --- |
| クロマニョン男性 | 8.33 / 3.53 / 5.20 cm、倒れ 8.06 cm | 0 |
| クロマニョン女性 | 0.59 / 0.33 / 0.42 cm | 0 |
| ネアンデルタール男性 | 3.15 / 4.32 / 3.25 cm | 0 |
| ネアンデルタール女性 | 1.25 / 0.66 / 0.96 cm | 0 |

（女性・ネアンデルタール男性の修正前の値は、新しいあご曲線から3 cm上の旧頭部頂点で測定。）

## クロマニョン男性：ウェイトだけの修正（r01）

顔の形状・UV・テクスチャ・体・骨・全クリップは元のまま。頭部プリミティブの JOINTS_0 / WEIGHTS_0 だけを書き換え（28 m のLODも同じ曲線）。`verify-r01.json` で頭部以外の全アクセサ・画像・アニメーションのバイト一致を確認。比較画像 `cro-magnon-hunter/qa/run-walk-before-after.jpg`（上：修正前、下：修正後）。

## 新しい頭部（クロマニョン女性・ネアンデルタール男性・ネアンデルタール女性）

1. **参照画像**：Codex 内蔵 image_gen（デスクトップアプリのCLI 0.162、gpt-5.6-sol）で各2案。正面・首まで・髪を顔から離す・無地背景という復元向けの条件と、男性は「リアルでかっこいい」、女性は「リアルでかわいい」を指定（`request-v1.json`）。各A案を採用、B案も保持（`<key>/source/`）。PATH上の旧CLI 0.134 はモデル非対応で失敗したため、アプリ同梱の新しいCLIを使用。生成画像はサンドボックスでコピーできず、Codexの `generated_images` から手でコピーした。
2. **復元**：ローカル TRELLIS-2（trellis-studio runtime、res 1024、tex 512、atlas 2048、seed 42）。所要 1,148 / 1,851 / 1,052 秒（ネアンデルタール女性／男性／クロマニョン女性）。記録 `<key>/reconstruction-reference-v1a-seed0042.json`。
3. **投影**（`project-reference.py`、記録 `<key>/projection-r01.json`）：
   - 参照の前景と復元の正面シルエットを一様縮尺＋平行移動で合わせる（IoU 0.93 / 0.91 / 0.93）。
   - TRELLISの顔は参照より目が高く顔が短い。顔の楕円内だけ、光学フローで顔の表面を横・上下に数mmずらし、目・鼻・口を参照の位置へ（耳・輪郭・髪・後頭部は動かさない、2回反復）。
   - 正面を向いたテクセルへ、参照の48 px より細かい成分だけを、復元自身の低周波の色に掛け合わせて投影（TRELLISの黒い目・ぼけた肌を置き換え、二重の陰影や色の継ぎ目を出さない）。ネアンデルタール男性だけ、肌の低周波色を参照の肌色へ半分寄せた（赤すぎたため）。
4. **接合**（`graft-head.py`、記録 `<key>/graft-report-r01.json`、実行 `output/face-remake/final-grafts.sh`）：
   - 配置：参照の目・あご（男性は目・口）の行を旧顔の高さに合わせて一様縮尺。首の中心を胴体の首の輪へ（男性は鼻先の奥行きを旧顔に）。
   - TRELLISは見えない内側の殻（首の薄い二重壁、髪の内部）を作るため、48方向の深度で一度も見えない面を除去（10〜15万三角形）。
   - 削減：顔と肌は atlas の継ぎ目を保ったまま meshoptimizer、暗い髪だけ継ぎ目越しの削減を許可し、2つのチャートにまたがった髪の三角形はUVを1テクセルに畳む（オレンジの斑点防止）。
   - 首：女性2体は胴体の首の輪へ正確に縫い合わせる（共有頂点 47 / 43、全動作で隙間0 m）。首の下端から輪まではエルミート曲線の滑らかな首（専用のUV帯に輪の肌色）。輪の頂点の法線だけ首に合わせて更新（66 / 60頂点）。ネアンデルタール女性は首の切り口の最上点の少し上で水平に、クロマニョン女性はTRELLISのU字の切り口に沿って切る。
   - ネアンデルタール男性の胴体には首の輪が無く（毛皮の襟の中にギザギザの皮膚片）、旧来の長いひげで隠れていた。新しい頭部の首を丸ごと残して襟の中へ差し込み、新しい首の内側に入る胴体の皮膚片256三角形を削除。
   - クロマニョン女性の胴体に残る旧来の三つ編みは、取ると下の背中が破れているため残し、新しい髪の色をその三つ編みの色へ寄せた。
   - 皮膚ウェイト：上記のとおり、あごより上は100% Head。
   - LOD（28 m）：同じアトラスの部分集合を meshoptimizer の sloppy 削減で頭部 4.3〜4.8千三角形。

## 配信

| 人物 | 新GLB | SHA-256 | 三角形（旧） | 容量（旧） | LOD三角形（旧） |
| --- | --- | --- | --- | --- | --- |
| クロマニョン男性 | model-face-r01.glb | `d460b5217aea1933dbbd584d61626692c8c3a6f201077064d7c2065a69588552` | 50,561（同） | 12,444,656（同） | 10,112（同） |
| クロマニョン女性 | model-face-r01.glb | `c8082f13995cebd42d674f6d4b5c87a61d441597d5670aec8803ca5006fdf2c1` | 85,829（67,133） | 11,552,512（11,549,512） | 12,627（13,426） |
| ネアンデルタール男性 | model-face-r01.glb | `6910fd3396bcde7934e9af23fa2130ca5c1bca9a08da0d00fe5582076b94352b` | 99,893（53,176） | 15,858,864（12,902,116） | 13,413（10,635） |
| ネアンデルタール女性 | model-face-r01.glb | `b4c416900e972c8850892b7a5f886e62478894d1c958cf35830dc7ea1672dde9` | 83,447（66,179） | 10,675,488（12,128,592） | 12,894（13,235） |

近距離の頭部は5.1〜6.0万三角形（顔の形を優先）。28 m以遠のLODは旧来並み。FPS改善は主張しない。人物画像（`portrait.png`）は新しいモデルから同じ three.js の描画（待機20%、420×480）で作り直し、旧画像は `<key>/qa/portrait-before.png`。ネアンデルタール男性の旧画像は現在の体と合っていなかった。

`public/models/<key>/asset.json` の `faceRemake` に参照・復元・投影・接合・検証・人物画像の記録、`provenance.previousDelivery` に旧配信を保持。`assets/world-models.json`（クロマニョン男性は対象外）と `assets/asset-remake/tracker.json` のSHAを更新。

## 検証

- `verify-graft.py`（`<key>/verify-r01.json`）：頭部以外のプリミティブ、スキン、逆バインド行列、ノード、全10クリップ、頭部以外の画像がバイト一致（例外は上記の首の輪の法線と、ネアンデルタール男性の削除した256三角形。削除は元の三角形の部分集合であることを確認）。縫い目の頂点は全動作で胴体と同じ位置（隙間0 m）。顔は全動作で Head と剛体。
- `scripts/inspect-glb.mjs --humanoid --hunting` 合格（本体・LOD）。
- 比較画像：`<key>/qa/before-after-r01.jpg`（左から 前／後 の正面・斜め・走行）、投影の確認 `qa/front-combined.jpg`・`qa/overlay.jpg`。
- 実ゲーム：`scripts/face-remake/qa-face-remake-game.mjs`（下の「実ゲーム確認」）。
- 正面の比較：`qa-game/faces-front-side.jpg`。

Blender 3.6（このPC）では WebP の glTF を読めないため、確認描画は PNG に変換した複製で行った（`output/` のみ）。

### 実ゲーム確認

`node scripts/face-remake/qa-face-remake-game.mjs`（`node scripts/build.mjs` の後）。保存なしの独立したメモリ内の部屋で、実Chrome 4画面（4人物）＋通信1人の5接続。結果 `qa-game/report.json`（status passed、エラー0）、元の画像一式は `output/playwright/face-remake/game-1791365789053/`。

- 4人物とも実UIで選択し、配信中の新GLBのSHA・プリミティブ数で描画されていることを確認。
- 実キーで歩行（W）・走行（Shift＋W）・攻撃（F）・ジャンプ（Space）。歩行・走行のクリップは別の画面（相手側）でも同じものを観測。
- 正面・横から顔を近接撮影（`qa-game/faces-front-side.jpg`、左から クロマニョン男性／クロマニョン女性／ネアンデルタール男性／ネアンデルタール女性、上段が正面・下段が横）。走行中の画面（`qa-game/run-and-lod.jpg` 上段、同じ順）と28 m以遠のLOD（同 下段、クロマニョン男性の列は歩行）。
- 3体の新しい頭部について、28 m以遠でLOD（同じ2〜3プリミティブ）に切り替わり、近づくと戻る往復。
- 390×844／844×390（`qa-game/viewports.jpg`）、再読込後に同じ人物で再参加。
- 準備値：戦闘用の敵の除去、開始座標、攻撃前に資源の無い場所へ戻す移動、顔撮影用のカメラ、LOD往復のサーバー側の移動。選択・歩行・走行・攻撃・ジャンプは実操作。4画面同時のため、背景タブの描画抑制を切るChrome引数を使用。

### テスト

- 全1026テスト中1022合格。失敗4件は今回の変更と無関係：マンモス・資源関連の既存3件（`hunting-client`「resource models deplete visibly」、`hunting`「both mammoth grounds…」、`mammoth-ground`「old cliff positions…」。2026-10-07のトウヒ作業時と同じ）と、`environment-profiles`「actual emitted MMO browser modules…」。後者は無視対象の `dist/src/help-content.js`（2026-10-03のビルドの残り。ソースは 849c704 で削除済み）を監査が拾うためで、配信には含まれない。
- `verify-world-assets` は別のPCにある制作参照画像（woolly-mammoth、クロマニョン男性C2）が無く、変更前から停止する。4人物の配信ファイル・SHA・寸法・LOD・レビューは個別に照合した。

## 既知の制約

- 首：ネアンデルタール女性のうなじに小さな折れ目、クロマニョン女性の首の中ほどに薄い線、首の付け根の縫い目に3 mm程度の細い線（至近距離のみ）。合成した首は肌色が均一でディテールが少ない。
- ネアンデルタール男性：襟の毛皮自体のトゲ状の形と、正面のV字の奥の胴体の三角形は元のまま。眉は太く濃い。
- 髪：TRELLIS の塊状の髪で、髪揺れの物理は無い。
- 色味は Blender とゲーム（three.js）で異なる。ゲーム内の見た目で調整した。
- 実スマホ／Safari／物理パッド／長時間負荷は未検証。MMO（8787）・展示・公開デプロイへの反映、コミットは行っていない。

## 再現

`scripts/face-remake/`：`write-requests.mjs` → `run-codex-refs.ps1` → `reconstruct-head.mjs` → `project-reference.py`（`output/face-remake/final-projections.sh`）→ `graft-head.py`（`output/face-remake/final-grafts.sh`）→ `verify-graft.py` / `measure-face-rigidity.py` → `write-review.mjs` → `adopt-face.mjs`。クロマニョン男性は `rigid-head-weights.py` → `verify-graft.py` → `adopt-face.mjs`。大きな途中ファイル（TRELLISの復元、PLY、作業GLB）は無視対象の `output/face-remake/` に保持。
