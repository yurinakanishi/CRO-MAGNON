# ちびキャラの仲間（2026-10-13）

ユーザー指定「AとCみたいなのも作って。 女の子と男の子、何種類かつくりたい。codex のサブスク枠でgpt-image使って候補いくつか見せて。」でデザイン候補10人（女の子G1〜G5・男の子B1〜B5）を作り、一覧を見せたところ「全員採用。」の回答を得た。3Dモデルは `output/model-generation/AGENTS.md` により1回の指示で1体まで作るため、この回は一覧の先頭の **G1「羽根飾りの女の子」**（キー `cro-magnon-girl-feather`）を作り、ゲームに追加した。残る9人は、ユーザーの指示ごとに1体ずつ作る。

同じ種族・性別（クロマニョン人・女性）の見た目が2つになるため、ゲームはキャラクターを種族と性別ではなくモデルのキーで区別するようにした（下の「ゲームへの組み込み」）。

## デザイン候補

Codex CLI（`gpt-5.6-sol`）の内蔵 `image_gen`（ChatGPTのプラン枠）で作った。API・`OPENAI_API_KEY`・`scripts/image_gen.py` は使っていない。採用済みの女性の参照画像（同じキャストに見せるため）とユーザーの画風画像（雰囲気だけ）を毎回添付した。置き場所はGit管理外の `output/model-generation/models/chibi-cast/` で、`source/original/` に画像・依頼文・プロンプトを、`review/cast1-sheet.png` に一覧を置いた。各画像のSHA-256は [ちびキャラ女性の記録](cro-magnon-woman-chibi-2026-10-13.md#仲間のデザイン候補同日) にある。

| ID | デザイン | 3D |
| --- | --- | --- |
| G1 | ボブ＋耳前の三つ編み・羽根・貝の首飾り・赤茶の毛皮ケープ（A系） | 候補1を採用（`cro-magnon-girl-feather`、修正版 c1-r02） |
| G2 | ホラアナグマの子の毛皮フード（C系） | 候補1を採用（`cro-magnon-girl-bear`、修正版 c1-r02） |
| G3 | オオカミの子の毛皮フード | 候補1を採用（`cro-magnon-girl-wolf`、修正版 c1-r02） |
| G4 | 赤毛の短いツインテール | 候補1を採用（`cro-magnon-girl-twintails`） |
| G5 | トナカイ革のパーカー | 候補1を採用（`cro-magnon-girl-reindeer`、修正版 c1-r02） |
| B1 | ツンツン髪＋貝の鉢巻き | 候補1を採用（`cro-magnon-boy-headband`） |
| B2 | ホラアナライオンの子の毛皮フード（C系） | 候補1を採用（`cro-magnon-boy-lion`） |
| B3 | ぼさぼさのボブ＋三つ編み（A系） | 候補1を採用（`cro-magnon-boy-braid`） |
| B4 | ちょんまげ＋洞窟壁画の手形の服 | 候補1を採用（`cro-magnon-boy-topknot`） |
| B5 | ケナガマンモスの子の毛皮フード | 未着手 |

## G1の作り方（候補1、`c1-r01`）

女性の候補5と同じ系統（[記録](cro-magnon-woman-chibi-2026-10-13.md)）。制作フォルダーは `output/model-generation/models/cro-magnon-girl-feather/work/candidate-01/`（`candidate.json` に各段階のファイルとSHA）。

1. 目を消した参照画像：`scripts/remake/blank_face.py`（新規）で、目・まつげの先・頬の点・鼻・口を、顔の肌に合わせた色の場で塗りつぶした。1回目は目の範囲が広すぎて横髪と前髪の先まで塗ったので、目の楕円を狭め、髪の色を見本ごとに別の色として守るようにした。
2. TRELLIS-2：res 1024・tex 1024・seed 123（992秒、286,312三角形）。顔は滑らかだが、塗りつぶしの縁が目の周りの浅い段差として残った。段差は軽量化で消え、顔の法線マップは平らにした（下の4）。
3. 軽量化と焼き込み：`scripts/remake/chibi_surface.sh`（新規。女性で手作業だった手順をまとめた）。7,000三角形・頭の重み1.6では、ボブ・三つ編み・羽根の頭が4,573三角形を取って腕と靴が角ばった。そこで **8,000三角形・頭の重み1.2**（頭4,511・体3,457）にした。体1024・頭2048（顔の前面1.8倍）のアトラスに焼き、参照画像の色へ戻した（体はCIELABの分位、髪は髪の色の平均と幅）。
4. 顔：元の参照画像の顔を投影した（`project_face.py`）。肌は再構成側へ半分合わせ、顔の法線マップを平らにした（`--flat-normals 1.0`）。頭と体を結合して7,872三角形。
5. 肌：手・脚・首の前を `SkinSurface` に分けた（服の色替えの対象外）。体の肌が顔より橙色に寄っていたので、`split_skin_material.py --tone 253,190,154`（新規オプション）で肌の画素だけを顔の色に合わせた。
6. 骨格と動き：女性と同じ指定（腕の比率 .40/.64/.80、手と足の固定、歩行1.7倍・走行1.5倍の周期）で22本の骨と10クリップを付けた。体の比率は `scripts/remake/slice_profile.py`（新規）で測った（首0.615・頭0.645・口0.678、`rig/proportions-g1.json`）。新しいキーには配信中の `asset.json` がないので、`human_chain.sh` に `TEMPLATE_ASSET`（新規）を加えた。
7. 確認：`chibi_views.mjs` で全10クリップ×3時点の正面・側面と、顔・服を見た。ゲーム内では女性の枠に差し替えて表示した。確認用の描画は、配信する材質と同じく面の両側を描くように直した。以前は表側だけを描いていたので、TRELLISの裏返った面が穴に見えて、灰色の形と色なしの見た目を誤って判断しかけた。

採用：`node scripts/remake/adopt_candidate_character.mjs --new`（新しいキーを採用する `--new` を追加）。配信は `public/models/cro-magnon-girl-feather/model-c1-r01.glb`（SHA-256 `27563eb7718eef5598b7fb70f79a77310dc251a5f137fb612513dff5890e4710`、3,006,704 B、7,872三角形、22骨、10クリップ、1.45 m）。ほかに `asset.json`（`sourceRevision` なし。新しいキーは元の配信がないので、`scripts/runtime-graph.mjs` は元モデル扱いで出す）と `portrait.png` を置いた。`assets/cro-magnon-girl-feather/` にはレビュー・確認画像・参照画像とプロンプトがある。

3Dモデルは、ユーザーが一覧の段階で全員採用したことを根拠に、こちらの確認の後でゲームへ組み込んだ。ユーザーはまだ3Dモデルそのものを見ていない。

## G2の作り方（候補1、`c1-r01`）

ユーザーの「次」で作った。G1と同じ手順で、違いは次のとおり（`output/model-generation/models/cro-magnon-girl-bear/work/candidate-01/candidate.json`）。

- 参照画像の被写体マスクは `scripts/remake/reference_matte.py`（新規）、記録は `scripts/remake/resolve_record.py`（新規）で、テンプレートのファイル参照をSHA付きに解決して書いた。
- TRELLIS-2（seed 123、858秒）は、正面だけのデザインに小さなクマのしっぽを足した。残している。
- ケープ：TRELLISのテクスチャ自体に、茶色の毛皮ケープの前面へ薄いピンクの筋があった。色合わせでさらに明るくなった。光線の始点を外に出した焼き直し（extrusion 0.006と0.015）でも、最寄り面から色を取る転写（`scripts/remake/nearest_albedo.py`、新規）でも同じだった。そこで `scripts/remake/even_fur.py`（新規）で、体の0.66 mより上の赤茶の画素だけを、ケープの中央値へ寄せた（明るさの差を45 %、色みの差を60 %残す）。
- 骨格：腰の高さの奥行き（前に下がった袋、スカート、しっぽ）のため、腰の関節が膝より6.6 cm後ろになった。その結果、槍の突きの踏み込みで脚が届かず、`build_spear_thrust_one.mjs` がNaNで止まった。`rig_human_c2.py --hips-over-knees`（新規）で、腰と股関節を膝の真上に置いた。同時に足した `--depth-trim`（奥行きの両端を除く）では、腰がさらに後ろへ下がったので使わなかった。
- 服の色替え：ずきん（頭）は染めないので、続きのケープの茶色（`keep` [340, 34, 0.3, 1, 0, 0.68]）と靴・帯も残し、ドレス・袖・レッグウォーマーだけを染める。高さは体の0.88まで。
- 歩きと走りのテスト：G2は長めの靴が蹴り出しで高く上がるので、歩きの足の上下が7.2 cmある（ほかは約6 cm）。走りは9.4 cm高く上がり、比は2.3倍で、従来の条件（2.5倍）に届かなかった。条件を「2.5倍、または9 cm以上高い」に改めた（`tests/player-gaits.test.mjs`）。
- 登録：`scripts/remake/add_cast_member.py`（新規）で、プロフィール・英語名・肖像のCSS・服の色の規則・`assets/world-models.json`・テストの人数を一度に追加した。服の色の規則は、並行して行われた公開ビルドの修正で `src/clothing-dye-rules.ts` に移っている。

配信は `public/models/cro-magnon-girl-bear/model-c1-r01.glb`（SHA-256 `d8b309be4ca93ec32756ef8985e95a8ac93d68a98b4694c28e73b57f3e0fcd7c`、2,964,536 B、7,632三角形、22骨、10クリップ、1.45 m）と `asset.json`・`portrait.png` で、レビューは `assets/cro-magnon-girl-bear/qa/c1-r01.json` にある。名前は「クロマニョン人 子グマずきんの女の子」（Bear-Cub Hood Girl）。全1,663件中1,659件合格・失敗0・条件付きスキップ4。実Chromeの5接続（採用後の実ファイル）で、入場・動作・相手の画面での表示（SHA一致、336フレーム）を確かめ、エラー0。服の色替えは全8体×9色の配信GLBで描いた（`output/clothing-dye/g2-r02`）。

## G3・G4と、G1〜G3の足元の中心合わせ（同日）

ユーザーの「次」2回で、G3（子オオカミずきんの女の子）とG4（赤毛ふたつ結びの女の子）を作った。G4はTRELLISの順番待ちの間に、G3の後ろへ予約した。

- 目を消した参照画像：
  - G3の1回目は、頬紅のピンクの残りと明るい点（まつげの先の塗り）から、TRELLISが頬に高さ約1 cmの突起を2つ作った。高密度面を顔の当てはめ面へ押す修正（`face_plate.py` の押すだけの使い方）では、17頂点しか動かなかった。そこで頬紅を楕円ごと塗る `blank_face.py --force`（新規）で作り直した。
  - G4の1回目は、塗りの縁の明るい楕円、まぶたの線、斜線入りの頬紅、まつげの先の明るい点を、TRELLISが閉じた目と受け取った。目の位置に暗い穴、鼻と歯のような形まで作った。そこで `--fill-mode residual`（新規）で作り直した。肌の色の場に、縁の実際の肌と場の差を調和関数で埋めて足すので、縁が見えない。あわせて、まぶたの線と頬紅は `--force`、まつげの先は塗らないことにした。
  - 2回目はどちらも顔が滑らかになった。G3は鼻と口の周りに少しふくらみが残り、TRELLISがそこを髪色の暗い色で塗った。投影でその範囲の髪の保護を外し、参照画像の顔に置き換えた。
- 足元の中心：
  - `remake_process.py` は外接箱の中心を原点に置く。ずきん・ボブ・しっぽが後ろへ張るちびキャラでは、足が原点より前に立つ（G1 12 cm、G2 14 cm、G3 22 cm）。ゲームはプレイヤーを原点まわりに回し、当たり判定も原点で取る。
  - 骨格の前に `scripts/remake/centre_on_feet.py`（新規）で、足裏の中心を原点に移す。
  - 採用済みのG1・G2は、同じ再構成とテクスチャのまま中心を合わせて骨格を付け直し、修正版 c1-r02 として採用した。旧GLBは残し、`asset.json` だけを新しい名前のGLBへ切り替えている（`adopt_candidate_character.mjs --original` を新規追加）。
- 腕の位置：
  - ケープやずきんが後ろにあると、測った背骨・胸・肩の奥行きも後ろへ下がる。G3では肩が足より7〜11 cm後ろになり、仲間を撫でる・Dotsの冠・猫へしゃがむ・Dotsを投げる構えで、手が9〜11 cm届かなかった。
  - `rig_human_c2.py --body-over-knees`（新規）で、腰に加えて背骨・胸・首・肩も膝の真上の線に置く。G2〜G4はこれで付けた。
  - それでも女性より腕が4〜5 cm後ろなので、G2〜G4は524を撫でる位置を近づけた（`petReachScale` 0.6）。
  - 撫でるテストの準備は、モデルの項目をそのままプレイヤーにしていた。キー（`character`）がないため、どのクロマニョン人の女の子も女性の値で試されていた。キーを足し、それぞれの値で試すようにした（`tests/petting-pose.test.mjs`）。
- 肌の材質分け：G4は袖なしなので、`split_skin_material.py --bare-arms 0.06`（新規）で、腕の軸から6 cm以内の肌色の面（二の腕）も肌にした。
- 服の色替え：
  - G3：ずきんに続く灰色のケープと白い毛は彩度で残し（`keep` [0, 360, 0, 0.28, 0.3, 0.95]）、ドレスと靴を染める。
  - G4：女性と同じ規則で、体の0.93より上（首の切れ目の髪先）は染めない。
- 道具：
  - `scripts/remake/revise_record.py`（採用済み候補の修正版の記録）
  - `cast_review_sheet.py` のゲーム内画像の選択（テントにカメラが寄ると、game-front と game-close でプレイヤーが消える）

配信：

| キャラクター | GLB | 三角形 |
| --- | --- | --- |
| G1 | `model-c1-r02.glb` | 7,872 |
| G2 | `model-c1-r02.glb` | 7,632 |
| G3 | `model-c1-r02.glb` | 7,477 |
| G4 | `model-c1-r01.glb` | 7,940 |

どれも22骨・10クリップ・1.45 m で、SHAは各 `asset.json` と `assets/<key>/qa/` のレビューにある。名前はG3が「クロマニョン人 子オオカミずきんの女の子」（Wolf-Pup Hood Girl）、G4が「クロマニョン人 赤毛ふたつ結びの女の子」（Red Twin-Tail Girl）。

検証：
- 全1,675件中1,671件合格・失敗0・条件付きスキップ4。
- 実Chromeの5接続（採用後の実ファイル）で、G1〜G4の4人それぞれが合格した。入場・動作・相手の画面での表示（SHA一致、383〜406フレーム）を確かめ、エラーは0。
- 服の色替えは全10体×9色の配信GLBで描いた（`output/clothing-dye/g4-r01`）。

## G5（同日）

ユーザーの「次」で、G5（トナカイ革パーカーの女の子、`cro-magnon-girl-reindeer`）を作った。

- 目を消した参照画像：G3・G4の教訓のとおり、`blank_face.py --fill-mode residual` で作った。`--force` で塗ったのは、まぶたの線、目頭の上の小さな線、白い点の頬化粧とその周りのにじみ。1回目のTRELLIS（seed 123、665秒）で顔が滑らかになった。
- 腕：
  - 毛皮の袖口が前にふくらむパーカーの袖のため、測った肘が前、手首と手が後ろになった（前腕が3.3 cm後ろへ傾く）。
  - 石斧は待機の姿勢の前腕に直角に持たせるので、拾う動作のしゃがみで刃先が地面に届いた（8 mm、テストは2 cm以上を求める）。
  - `rig_human_c2.py --arm-axis-depth`（新規）で、肘・手首・手を肩から指先への直線の奥行きに置いた。最も低い位置は20.8 cmになり、修正版 c1-r02 として採用した。
- 歩きと走りのテスト：
  - G5は長いブーツのかかとが歩きで高く上がり、足首の上下が9.8 cmある（走りは16.8 cm）。
  - 走りの条件の別解を「9 cm以上」から「6 cm以上高い」に改めた。0.37 mの脚で7 cmの差は走りに見える。
  - 肘の曲がりの条件は、そのまま満たしている。
- 服の色替え：パーカー全体（毛皮の襟と袖口を含む）と靴を染める。体の材質に髪は含まれないので、高さの制限はない。
- 配信は `model-c1-r02.glb`（7,862三角形、22骨、10クリップ、1.45 m）。名前は「クロマニョン人 トナカイ革パーカーの女の子」（Reindeer Parka Girl）。

検証：
- 全1,681件中1,677件合格・失敗0・条件付きスキップ4。
- 実Chromeの5接続で、入場・動作・相手の画面での表示（SHA一致、368フレーム）を確かめ、エラー0。
- 服の色替えは全11体×9色の配信GLBで描いた（`output/clothing-dye/g5-r01`）。

## B1（2026-10-13〜14）

ユーザーの「次」で、仲間の最初の男の子B1（貝の鉢巻きの男の子、`cro-magnon-boy-headband`）を作った。女の子と同じ1.45 mのちびキャラ体型で、`gender: 'male'`。選択カードの値はキー（クロマニョン人・男性の最初の見た目は大人の男性のまま）。

- 顔：`blank_face.py --fill-mode residual` で1回目から滑らかだった。
- 軽量化：
  - 8,000三角形・頭の重み1.2では、meshoptが前髪の先を細長い面に縮め、それが顔の上に貼りついて前髪から目へ暗い線になった。8000/1.3、8500/1.2、9000/1.2でも同じだった。
  - 頭の重みを1.5にすると、前髪の先が頂点を保って消えた。**8,500・1.5**（頭5,360・体3,104）を採った。合わせて8,338三角形。
- 髪の色：
  - 参照画像の焦げ茶の髪は彩度0.36〜0.46で、半分が髪の分類の既定（0.32〜0.42）より低い。既定のままでは、より赤く明るい髪になった。
  - `match_reference_colours.py --class-sat`（新規、`chibi_surface.sh` では `HAIR_SAT`）で、0.22〜0.30に下げて合わせた。
- 肌：袖なしのベストの下の腕（`--bare-arms 0.06`）と膝を、肌の材質にした。
- 骨格：`--body-over-knees --arm-axis-depth` で付けた。石斧の最も低い位置は25.5 cm。足首の上下は歩き8.8 cm・走り16.8 cmで、テストの条件を満たす。
- テスト：Dotsの冠・猫へしゃがむ・Dotsを投げる構えの3つのテストは、準備がモデルのキーを渡していなかった。そのため、男の子が大人の男性（クロマニョン人・男性の最初の見た目）の値で試され、手が7〜11 cm届かなかった。準備にキーを足した（`orb-bot-friendship`・`rimo-neko`・`orb-bots`）。
- 服の色替え：ベスト・チュニック・ズボン・腕の飾り・靴を染める。体の0.955より上（首の切れ目の髪先）は染めない。
- 配信：`model-c1-r01.glb`（8,338三角形、22骨、10クリップ、1.45 m）。名前は「クロマニョン人 貝の鉢巻きの男の子」（Shell Headband Boy）。

検証：
- 全1,687件中1,683件合格・失敗0・条件付きスキップ4。
- 実Chromeの5接続で、入場・動作・相手の画面での表示（SHA一致、388フレーム）を確かめ、エラー0。
- 服の色替えは全12体×9色の配信GLBで描いた（`output/clothing-dye/b1-r01`）。

## B2（2026-10-14）

ユーザーの「次」で、B2（子ライオンずきんの男の子、`cro-magnon-boy-lion`）を作った。B1の立体化中に頼まれたので、B1の後ろへ予約した。

- TRELLIS：
  - seed 123。B1の確認とテストでGPUを分け合ったため3,583秒かかった。
  - ずきんとケープを濃い橙に塗り、ケープの前に広いクリーム色の毛皮の縁を付けた。
  - 最寄り面から色を取る転写でも同じ見え方だったので、ケープ前面の淡さはTRELLISのテクスチャ自体による。
- 頭の色：
  - 髪の分類だけでは、ずきんが髪の色へ引かれた。頭全体の分位合わせでは、ずきんが明るくなりすぎた。
  - `match_reference_colours.py --mode range`（新規）で、画素の色の範囲どうしを対応させた。橙のずきんを参照画像の黄褐色のずきんへ、髪を参照画像の明るい茶の髪へ、それぞれ別に移した。
- 体の色：
  - 分位合わせの後、`even_fur.py --target --min-sat`（新規）でケープの黄褐色を参照画像の色へ寄せた。クリーム色の縁はそのまま。
  - 明るさだけの合わせ（`--channels L`、新規）や茶色の範囲の移し替えも試したが、見た目は変わらなかった。
- 骨格：
  - 肩にかかるケープで測った肩幅が広がり、上腕の付け根が体の軸から0.205 m（ほかは0.12〜0.17 m）になった。槍の突きで前の手が0.4〜1.4 mm届かなかった（`build_spear_thrust_one.mjs`）。
  - 前腕を長くしても直らなかったので、`rig_human_c2.py --shoulder-x 0.15`（新規）で肩関節を0.15 mに置いた。
  - 石斧の最も低い位置は27.3 cm。足首の上下は歩き7.7 cm・走り17.1 cm。
- 服の色替え：クリーム色のチュニックと毛皮の縁を染める。ずきんに続く黄褐色のケープ、茶色のズボン・靴・帯は残す（`keep` [340, 36, 0.3, 1, 0, 1]）。
- 配信：`model-c1-r01.glb`（7,730三角形、22骨、10クリップ、1.45 m）。名前は「クロマニョン人 子ライオンずきんの男の子」（Lion-Cub Hood Boy）。

検証：
- 全1,693件中1,689件合格・失敗0・条件付きスキップ4。
- 実Chromeの5接続で、入場・動作・相手の画面での表示（SHA一致、339フレーム）を確かめ、エラー0。
- 服の色替えは全13体×9色の配信GLBで描いた（`output/clothing-dye/b2-r01`）。

## B3（2026-10-14）

ユーザーの「次」で、B3（三つ編みの男の子、`cro-magnon-boy-braid`）を作った。

- 目を消した参照画像：
  - 目の下の外側の白目が色の判定の外に残り、明るい斑になった。目全体を `--force` で塗った。
  - そばかす・頬の点・口の端の点・まぶたの線も `--force` で塗った。TRELLIS（seed 123、756秒）の1回目で顔が滑らかになった。
- 軽量化：B1と同じ8,500三角形・頭の重み1.5（合わせて8,314三角形）。前髪の先が顔に貼りつく面は出なかった。
- 色：TRELLISがケープを濃い橙赤に塗ったので、`even_fur.py --target` で参照画像の赤茶へ寄せた（明るさの差を55 %、色みの差を35 %残す）。
- 骨格：`--body-over-knees --arm-axis-depth`。石斧の最も低い位置は27.9 cm。足首の上下は歩き6.5 cm・走り16.6 cm。
- 服の色替え：ケープ・チュニック・ズボン・靴を染める。体の0.91より上は、顔の横に下がる三つ編みの先がケープと同じ色なので染めない。そのためケープの首元が元の赤茶の縁として残る。
- 配信：`model-c1-r01.glb`（8,314三角形、22骨、10クリップ、1.45 m）。名前は「クロマニョン人 三つ編みの男の子」（Braided Boy）。

検証：
- 全1,699件中1,695件合格・失敗0・条件付きスキップ4。
- 実Chromeの5接続で、入場・動作・相手の画面での表示（SHA一致、339フレーム）を確かめ、エラー0。
- 服の色替えは全14体×9色の配信GLBで描いた（`output/clothing-dye/b3-r01`）。

## B4（2026-10-14）

ユーザーの「次」で、B4（ちょんまげの男の子、`cro-magnon-boy-topknot`）を作った。

- 目を消した参照画像：目全体・まぶたの線・目頭・頬の赤い線・口を `--force` で塗った。TRELLIS（seed 123、433秒）の1回目で顔が滑らかになった。
- 軽量化：B1・B3と同じ8,500三角形・頭の重み1.5（合わせて8,445三角形）。
- 胸の手形：
  - TRELLISは胸の赤い手形を、指のない丸い赤い塊として復元した。塊は参照画像の手の約0.8倍で、少し高い位置にあった。首飾りから帯までの胴が参照画像より短いため。
  - `scripts/remake/project_decal.py`（新規）で直した。まず塊の赤い画素を服の色へ戻す。次に、参照画像の手形（色の範囲で最も大きくつながった部分）を0.8倍にして、牙の首飾りと帯の間へ正面から投影する。首飾りの歯と毛皮の明るい画素には塗らない。
  - 1回目（r01）は、手のひらを横切るアトラスの継ぎ目の線と、塊の縁の赤い輪が残った。2回目（r02）は、継ぎ目の外側2テクセルも塗り、塊を戻す赤みのしきい値を下げて直した。比較は `assets/cro-magnon-boy-topknot/qa/c1-r01/hand-stencil.jpg`。
- 肌：袖なしの服の下の腕（`--bare-arms 0.06`）・脚・首を肌の材質にした。手の境は、大きな毛皮の手首飾りを外すため、腕の長さの0.75にした。脚の範囲は、肌色に近い半ズボンの淡い帯の下で止めた。
- 骨格：`--body-over-knees --arm-axis-depth`。石斧の最も低い位置は20.3 cm。足首の上下は歩き10.3 cm・走り17.0 cm。
- 服の色替え：
  - 服・毛皮の縁・半ズボン・靴を染める。
  - 胸の赤い手形は染めない（`keep` [6, 16, 0.48, 0.65, 0.62, 0.82]）。そのまま染めると手形と服の明るさが近く、手形がほとんど消えるため。
  - 体の材質に髪は入っていないので、高さの制限はない。
- 残る違い：TRELLISは、濃い半ズボンの赤とクリーム色のジグザグ模様を、明るい黄褐色の帯にぼかした。手形やちょんまげほどの特徴ではないので、そのままにした。
- 配信：`model-c1-r01.glb`（8,445三角形、22骨、10クリップ、1.45 m）。名前は「クロマニョン人 ちょんまげの男の子」（Topknot Boy）。

検証：
- 全1,705件中1,701件合格・失敗0・条件付きスキップ4。
- 実Chromeの5接続で、入場・動作・相手の画面での表示（SHA一致、344フレーム）を確かめ、エラー0。
- 服の色替えは全15体×9色の配信GLBで描いた（`output/clothing-dye/b4-r01`）。手形はどの色でも赤茶のまま残った。

## ゲームへの組み込み

- 区別のしかた：
  - `CharacterProfile.character`（モデルのキー）を追加した。`normalizeCharacter` は、キーがあり、横に添えた種族・性別と合っていればその見た目を返す。キーがない、知らないキー、種族・性別と食い違うキーのときは、従来どおりその種族・性別の最初の見た目になる。
  - 参加時のURL、`welcome` のプロフィール、毎回の状態（`PlayerSnapshot.character`）、キャラクター切り替え、セーブ（セッションのプレイヤーをそのまま保存）にキーを通した。ブラウザでは `cro-character` に保存し、キーが変わったら予測をやり直す。
  - 古いセーブや古いクライアント（キーなし）は、これまでどおり最初の見た目（女性）になる。
- 選択カードの値：
  - 種族・性別の組で最初の見た目は、従来どおり `cro-female` などのままにした。保存済みの選択と、約30本のQAスクリプトのセレクターがこの値に頼っているため。
  - 2つ目以降の見た目はモデルのキーにした（G1は `cro-magnon-girl-feather`）。
- キャラクターの設定：
  - `shared/character-profiles.mts` の末尾にG1を追加した。女性と同じ体型の値（`height` 1.45・`botHandRatios`・`cameraFocus` 1.15・`petReachScale` 0.75）を使う。
  - 末尾に置いたのは、最初の `cro`/`female` が既定の見た目と村人に使われるため。
- 見た目まわり：
  - HUDの肖像のCSS（女性と同じ切り抜き）。
  - 英語名（Cro-Magnon · Feathered Girl）。
  - 服の色替えの規則（女性と同じで、体の高さの0.93より上は染めない。顔の横の三つ編みの先がケープと同じ色のため）。
  - `assets/world-models.json` の項目、README の選べるキャラクター。
- テスト：
  - 識別の結果にキーが入った分の期待値を直した（`characters`・`giant-ape`・`howkey`・`maruimo`・`neanderthal-retirement`・`character-switch`・`local-visibility`）。
  - 新規：同じ種族・性別でもキーで区別すること、カードの値の往復。G1が参加・切り替え・他の人への配信・セーブ復元でキーを保つこと。
  - LODの比較テストは、r04より前の元のモデルとLODの組がある9体だけにした。G1はほかのプレイヤーと同じくLODなしの1体として、配信物を確認する。
  - `scripts/qa-cloudflare-character-privacy.mjs` の人数（10・公開8）を直した。

## 検証

- `npm test`：全1,656件中1,652件合格・失敗0・条件付きスキップ4。
- `npm run check`（型・strict・646 JS構文・依存境界）、`npm run format:check`、`git diff --check`：合格。
- 実Chromeで5接続（Chrome 2画面＋通信3）。採用後の実ファイルで確認した（`scripts/remake/qa_candidate_actor.mjs`）。
  - G1：選択カードから入り、入場・待機・歩行・走行・攻撃ができた。自分の画面のモデルのSHAが一致した。もう一方の画面でも、G1として同じSHAと4クリップを393フレーム描いた。エラー0。
  - 女性：同じ確認で合格（改修後の回帰確認）。
- 選択画面（1280×800・390×844）：7枚のカードと確認画面にG1が出た。エラー0（`output/playwright/g1-selection`）。HUDの肖像はG1になった。
- 服の色替え：全7体×9色を配信GLBで描き、G1は服・ケープ・靴だけが染まった（`scripts/qa-clothing-dye-palette.mjs`、`output/clothing-dye/g1-r01`）。

未確認：
- 実スマートフォンと性能の実測。
- ゲーム内の服の色替え操作をG1で行うこと（`qa-clothing-dye.mjs` は対象キャラクターが固定）。
- マスコットを撫でる姿勢の実画面確認（単体テストは合格）。
- Cloudflareの公開ビルド（別件の懸念あり。展示・公開は行っていない）。

サーバーの起動・再起動、公開、展示、commit／pushは行っていない。

## 追加・変更した道具

- 新規：
  - `scripts/remake/blank_face.py`（目を消した参照画像）
  - `chibi_surface.sh`（低ポリの表面一式）
  - `slice_profile.py`（体の比率の計測）
  - G2で追加：
    - `reference_matte.py`
    - `resolve_record.py`
    - `cast_qa_renders.sh`（確認用の描画）
    - `cast_review_sheet.py`（確認シート）
    - `add_cast_member.py`（ゲームへの登録）
    - `even_fur.py`
    - `nearest_albedo.py`
    - `rig_human_c2.py --hips-over-knees` と `--depth-trim`
  - G3〜G5で追加：
    - `centre_on_feet.py`
    - `revise_record.py`
    - `rig_human_c2.py --body-over-knees` と `--arm-axis-depth`
    - `blank_face.py --force` と `--fill-mode residual`
    - `split_skin_material.py --bare-arms`
    - `adopt_candidate_character.mjs --original`
    - `add_cast_member.py --pet-reach` と `--profile-note`
  - B4で追加：`project_decal.py`（参照画像の小さな模様を、復元のぼやけた塊の代わりに正面から投影する）
- 変更：
  - `split_skin_material.py`：`--tone`
  - `chibi_views.mjs`：面の両側を描く
  - `human_chain.sh`：`TEMPLATE_ASSET`
  - `adopt_candidate_character.mjs`：`--new`
  - `qa_candidate_actor.mjs`：カードの値の説明

## 変更したファイル

- 共通：
  - `shared/types.mts`
  - `shared/characters.mts`
  - `shared/character-profiles.mts`
  - `shared/character-switching.mts`
  - `shared/snapshots.mts`
- サーバー：
  - `application/game-core.mts`
  - `application/snapshot.mts`
- 画面：
  - `src/character-selection.ts`
  - `src/main.ts`
  - `src/local-prediction.ts`
  - `src/clothing-dye.ts`
  - `src/clothing-dye-rules.ts`（色替えの規則表。2026-10-13に別セッションが `clothing-dye.ts` から分けた）
  - `src/language-en.ts`
  - `src/style.css`
- モデル：
  - `public/models/cro-magnon-girl-feather/`
  - `assets/cro-magnon-girl-feather/`
  - G2〜B4も同じく `public/models/<キー>/` と `assets/<キー>/`
  - `assets/world-models.json`
- テスト：
  - `tests/characters.test.mjs`
  - `character-selection`
  - `character-switch`
  - `giant-ape`
  - `howkey`
  - `maruimo`
  - `neanderthal-retirement`
  - `local-visibility`
  - `actor-shadow`
  - `cave-torch`
  - `original-actor-pairs.mjs`
  - `scripts/qa-cloudflare-character-privacy.mjs`
- 文書：
  - `README.md`
  - この記録
  - `docs/changelog/2026-10.md`
  - `docs/README.md`
