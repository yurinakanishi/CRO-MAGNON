# クロマニョン人女性の作り直し：かわいいローポリ（2026-10-12）

ユーザー指定「クロマニョン人の女性の3dアセットの品質が悪いので、作り直してください。なるべくローポリで。かわいく。」への対応記録。途中の「顔がおかしい」「鼻とか、眉とかもろもろ。もう少し美人系で。」を受けて候補4（美人寄り）も作った。最後に候補3と候補4を今のモデルと並べて見せ、ユーザーが「候補3を採用する」を選んだ。**候補3 revision c3-r03 を採用済み。**

## 結果

| | 採用前（face-lp-r08） | 採用（c3-r03） |
| --- | --- | --- |
| 見た目 | 写実的な顔の作り直しを接いだ人物 | 6頭身のかわいい人物：お団子2つ・獣皮のワンピース・毛皮付きブーツ |
| 三角形 | 41,021 | **7,689**（体5,852＋頭1,837） |
| 正本GLB | 5,278,800 B | **2,517,496 B** |
| 配信形式（配信用変換後） | 2,316,120 B | **1,598,788 B** |
| 画像 | 体・頭（頭は1024のPNG） | 体1024（色・法線）＋頭1024（色・法線）、WebP |
| 骨・動作 | 22骨・10動作 | 22骨・10動作（Idle・Walk・Run・Gather・Craft・Give・Eat・Wave・Attack・Downed） |
| 高さ | 1.67 m | 1.67 m（お団子を含む） |

- 正本：`/models/cro-magnon-woman/model-c3-r03.glb`（SHA-256 `e899cf58f9a0700034a0ba9c177a2e752fa14f3c8d04db8e7d14b167c2bef38f`）。旧GLBは全て残している。
- 比較画像（ユーザーが見たもの）：`assets/cro-magnon-woman/qa/c3-r03/compare-current-c3-c4.jpg`、ゲーム内 `game-preview.jpg`・`game-close.jpg`、全動作 `poses-front.jpg`・`poses-side.jpg`・`faces-by-clip.jpg`・`downed.jpg`。
- 採用記録：`assets/cro-magnon-woman/qa/c3-r03.json`（承認・各工程のファイルのSHA・設定・QA）、`assets/cro-magnon-woman/qa/source-revision-c3-r03.json`（正本更新。前回の頭部r08と同じく起動用最適化 `20261010-r07-a01` の起動ファイルを置き換える記録）、採用前のmanifest `assets/cro-magnon-woman/archive-manifest-face-lp-r08-20261012.json`、採用した参照画像とプロンプト `assets/cro-magnon-woman/source/c3-r03/`。
- manifestは新しいモデルの項目だけにした（顔の作り直し・頭部軽量化・旧動作の履歴は保存したmanifestに残る）。肖像 `portrait.png` を同じレンダラー（待機20%・420×480）で撮り直した。HUDの顔アイコンはCSSの切り抜き（330%・上端4%）のままで顔が収まる。`assets/world-models.json` の項目も更新した。

## 作り方（候補3）

制作フォルダーは `output/model-generation/models/cro-magnon-woman/`（git管理外）。記録 `work/candidate-03/candidate.json`。

1. **参照画像**：Codexの内蔵image_genで、TRELLISで復元しやすい「なめらかで大きな形・細部は色で描く」かわいい人物を3案（`source/original/candidate3-ref-{a,b,c}.png`）。お団子のB案を採用（髪が肩に触れずリグが安定、遠くでも輪郭で分かる）。
2. **TRELLIS-2**：res 1024・tex 1024・seed 42。1回目はWindowsのスマート アプリ コントロール（強制モード、2026-10-11から）が `ggml.dll` を止めて失敗（記録 `output/asset-remake/trellis-queue/failed/cro-magnon-woman-c3-ref3b.failed-sac-1.json`）。ユーザーが設定を変えた後に再実行して成功（約5分）。
3. **目の穴をふさぐ**（`scripts/remake/fill_eye_sockets.py`）：TRELLISは描かれた目を深さ約7.5cmのじょうごとして作った。軽量化で穴の頂点が残り、目から頬へ細長い三角形ができて陰影が崩れた。目の周りの顔に平面を当て、平面より5mm以上奥で目の縁から**つながっている**面だけを消して穴をふさぐ（投影範囲だけで選ぶと後頭部まで消える。r01を不採用にした）。なめらか化・持ち上げでは埋まらなかった試行も不採用として残した。
4. **軽量化**：meshoptで5,000／8,000／12,000を比較。4,854は顔の輪郭とブーツが角ばるので、8,000（実7,689）を採用。
5. **体と頭を別の画像に**（`xatlas_unwrap.py --select`）：全身1枚の1024では顔が約100pxしかない。首（y≥0.273）で分け、体は1024、頭は2048で焼いて1024へ縮小（髪の生え際の点線状のギザギザが消える）。`merge_head.py` で1メッシュ2材質に戻す。
6. **顔の投影**（新規 `scripts/remake/project_face.py`）：TRELLISの顔の色は目が灰色・鼻が赤く「顔がおかしい」状態だった。全身のシルエットで参照画像を位置合わせし（BiRefNetの切り抜きをマスクに使用、一致度0.908）、顔の楕円の中だけ光学フローで参照画像を顔のパーツへ合わせて投影する。肌色は体の肌に合わせ、目の楕円だけ法線マップを平らにする（目に陰が落ちない。顔全体を平らにすると低ポリの面が見えるので不採用）。形状は動かさない。
7. **リグと動作**（`scripts/remake/human_chain.sh`）：22骨の人型リグ→槍の突き→Downed→CMU実測の歩行・走行。頭身が違うので関節の高さを実測して指定（`--proportions`、首75.2%・頭78.5%・肩70.5%・膝27.2%など）。低ポリでは頂点がまばらで関節の測定が偏るため、形を変えない細分割の複製で測る（`--measure-subdiv 2`）。肘を探す範囲を腕の太さに合わせる（`--arm-band .03`）。
8. **腕のウェイト**（`--arm-gate .60`）：Aポーズで肘が腰の横にあるため、服の腰が腕の骨に付き、手を振るとスカートがめくれた（r01）。脇より下で手からつながっていない頂点（服・腰・脚）から腕のウェイトを外す。前腕は再構成の細い割れ目で縦2枚に分かれている（両側の頂点は6.7mm以上離れている）。辺のつながりだけでたどったr02は各前腕の片側しか腕と判定せず、もう片側がAポーズの位置に残って「腕が二重に見える」状態になった（不採用。4mm以内をつながりとみなしても同じ結果）。15mm以内の頂点もつながりとみなして解消した（r03、腕の頂点222個、腕のウェイトを外した体側の頂点821個）。

## 候補4（不採用、記録のみ）

美人寄りの参照画像3案（A：7頭身・大人の美人、B、C）からユーザーがAを選んだ。TRELLISのseed 42は唇を突き出した顔を作り（高密度の時点で既に）、口元を形で直す試行（なめらか化・平らにする）は鼻の消失・口の裂けで不採用。seed 7・123を比べ、seed 123が自然な口元だった。全身では顔が約80pxしかなく、TRELLISの顔の形はseedで大きく変わる。頭に三角形を多めに配分（`MESHOPT_BOOST`、9,383三角形）して全工程を通したが、比較の結果ユーザーは候補3を選んだ。制作物は `work/candidate-04/`（記録 `candidate.json`）に保持。頭部だけの参照画像 `candidate4-head-a.png` も作ったが使っていない。

## 検証

- 書き出したGLBをChrome（ゲームと同じThree.js）で全10動作×3時点×3方向、動作ごとの顔の近接、BlenderでDownedの接地を確認。変形検査（`rig-report.json`）：最大4影響・未割当0、全動作で接地。
- 隔離サーバーで実際のタイトル→人物選択→入場：候補段階は通信の差し替えで、採用後は `public/` の実ファイルで実施（`scripts/remake/qa_candidate_actor.mjs`）。採用後は5接続（Chrome2画面＋通信参加者3）で、自分の待機・歩行・走行・攻撃（実キー）と、相手の画面での同じモデル（SHA一致）・同じ動作を確認。ページのエラー0（`output/playwright/c3-adopted-game-r01/`）。
- 配信用変換（`prepare-overlay`）後の配信形式と正本の比較（`qa-cooked-models.mjs`）：PSNR 51.9 dB、骨変形後の頂点差最大0.35 mm、構造の不一致0。
- テスト：全1,497件中1,493件合格・失敗0・条件付き4件スキップ。`npm run check`（型・strict・618 JS構文・依存境界）合格。
- 確認していないもの：実スマートフォン、実回線、発熱・電池、長時間の連続プレイ。公開サイトへのデプロイ、展示機への配布、既存の3000／8787／4173の停止・再起動は行っていない（次の起動時に配信用の対応表が作り直され、新しいモデルが配信形式で返る）。commit／pushはしていない。

## 追加・変更した道具

- 新規：`scripts/remake/project_face.py`（顔の投影・位置合わせだけのモード `--register-only --place-height`）、`fill_eye_sockets.py`、`smooth_dense_region.py`（なめらか化・持ち上げ・平らにする。試行のみ）、`qa_candidate_actor.mjs`（候補・採用後のゲーム内確認）、`adopt_candidate_character.mjs`（採用）。
- 変更（既定の動作は従来どおり）：`xatlas_unwrap.py`（`--select` 部分だけ展開、`--boost` 部分の密度）、`meshopt_reduce.mjs`（`MESHOPT_BOOST`）、`process_static.sh`・`human_chain.sh`（`CANDIDATE`・`XATLAS_ARGS`）、`rig_human_c2.py`（`--proportions`・`--measure-subdiv`・`--arm-band`・`--arm-gate`）、`riglib/blender_rig.py`（関節の高さの比率を外から指定できる `FRACTIONS`）、`scripts/qa-female-faces.mjs`（meshopt圧縮GLBの読み込み）。
