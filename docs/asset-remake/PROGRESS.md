# 全3Dアセット再制作 進捗ログ

ブランチ `remake/all-assets-20261007`（当時のworktree `../CRO-MAGNON-remake`）で作業し、2026-10-07に `main` へマージ（worktreeは削除、作業記録 `output/asset-remake/` は本体の `output/` へ移動）。
旧GLBは全て保持し、新GLBは `model-c2.glb` / `lod-c2.glb` 等の別名で追加。

## 完了（ブランチ内で組み込み済み）

| key | 新GLB | 主な改善 | 検証 |
|---|---|---|---|
| hide-tent | model-c2.glb 17,991 tris / lod-c2.glb 8,528 | 新参照（継ぎはぎの獣皮・縫い目・毛皮の棟・押さえ石）、2048法線ベイク＋2048アルベド＋PBR粗さ | 中立比較 `output/asset-remake/hide-tent/compare-r01.jpg`、ゲーム内 `output/asset-remake/game/reps-r1/tent-view-*.png`、衝突寸法を再計測 |
| woolly-mammoth | model-c2.glb 39,982 tris / lod-c2.glb 4,797 | 新参照・seed 7（seed 42は尾が2本の再発で不採用）、毛の房のシルエットと法線、新リグ26骨・5動作（Spine維持、牙は頭に剛体、鼻の接地解決、Deathは膝から崩れる伏臥） | クリップ画像 `.../rig/r05`、ゲーム内でR乗降・W/Shift騎乗6.6 m・F攻撃→Death→肉、例外0、関連テスト（riding-pose含む）合格 |

コード変更: `src/riding-pose.ts` の騎乗座席をマニフェスト `placement.ridingSeat` から読む（無ければ従来値）。`src/world3d.ts` から asset を渡す。

（上の表は最初の代表2件。全件の一覧と判断は `docs/asset-remake/INVENTORY.md` と `assets/asset-remake/status.json`。）

## 状態

- 状態の一覧は `assets/asset-remake/status.json`（`node scripts/remake/build-tracker.mjs` で `INVENTORY.md` を再生成）。各キーの採用レビューは `node scripts/remake/sync_production_records.mjs` が `assets/asset-remake/reviews/` に作る。
- TRELLISキュー（`output/asset-remake/trellis-queue/`、`scripts/remake/trellis_queue.py`）は全件終了。失敗は肩当ての1回（CPU再メッシュ段階、再投入で成功）と、それ以前のGPU競合による停止（再投入済み）。

## 工程の修正（2026-10-07 04:00〜）

- **法線マップの黒い斑点**: 毛・葉・獣皮の重なりでベイクの光線が上の層の裏面に当たり、接空間法線のzが負（黒く陰る）になっていた。組み込み済み全件で画素の3〜13%。`remake_process.py` のベイクを、UV島の被覆マスク→1回目→未命中だけ4倍距離で2回目→島内の近傍補完→外側8画素の余白、法線は裏向きを反転しz≥0.25、に変更（`bake_fill` を報告）。既に組み込んだGLBは `scripts/remake/repair_normal_maps.py` で法線画像だけ同じ処理をして差し替え（他のバイト列は不変）。
- **再展開アトラスの解像度不足**: 削減メッシュへのSmart UVは毛・岩で約1万の微小島に割れ、2048でも実質解像度が大きく落ちていた（大虎の顔がぼける）。`scripts/remake/xatlas_unwrap.py`（PyPI xatlas 0.0.11、`output/asset-remake/.venv-xatlas`）でチャート展開し `--keep-low-uv` でベイクする経路へ統一（`process_static.sh`）。焚き火・薪の山・男性の頭部を作り直して差し替え。
- **元UV保持の試行は不採用**: meshoptでUV継ぎ目を保つ削減はTRELLISアトラスの継ぎ目で約7.1万三角形で止まる（旧大虎が72,892だった理由）。Permissiveで継ぎ目をまたぐとアトラスが壊れる。
- **重複復元の省略**: 承認済み参照・同設定のdenseが残る大虎・砂耳の魔法使い・大猿・Howkey・りもねこはTRELLISを再実行せず既存denseを再利用（同じ入力で同じ復元になるため）。女性2体の承認済み頭部はdenseが残っていないため再実行する。
- **大虎の死亡姿勢**: 既存r13のDeathは横倒しで床から0.10 m浮いていた（実メッシュ最低点の計測）。Deathだけ上下両方向の接地を入れて0.001 mに。
- **qa-sabertooth.mjs の「Alert rendered」**: GPUがTRELLIS実行中は、未変更のベースラインでも同じ箇所で失敗する（0.6秒の咆哮クリップのサンプル漏れ）。その前の全挙動検査は新モデルで合格。キューが空いた時に再実行する。

## 承認済みデザインの縮小再ベイク（2026-10-07 05:00〜）

- ゲスト・仲間・承認済みの敵（524、りもねこ、こはく、mae、まるぃも×2、Howkey、砂耳の魔法使い、大猿、紫尾の巨獣、丸いbot 9種）は、新しい復元を作らず **配信済みの面そのもの** を素材にした。`scripts/remake/transfer_reduce.py`：静止姿勢の配信面をmeshoptで削減（残る頂点は元の頂点の部分集合）→xatlas→配信面からアルベド・法線をベイク→スキンウェイトをData Transferで移し、骨・骨名・クリップは元のキー間隔のまま書き出す。
- 検証（`reduce_delivered.sh`）: 全クリップの姿勢付き頂点の配信スキンとの差 0 m、クリップ曲線の差 0.05〜0.2°（再サンプリング分）、未加重頂点0、前・斜め・後ろの比較画像（`output/asset-remake/guests/<key>/compare-views.jpg`）。
- 途中で直した不具合: ①法線ベイクを平坦な面の向きで行い、書き出し後の滑らかな法線に適用していた（顔が多角形に見える）→シェーディング設定をベイク前へ。②xatlasの継ぎ目で頂点が分かれたまま（継ぎ目ごとに陰影が切れる）→完全一致の頂点を溶接（UVは角ごとに保持）。③原本のクリップが120/240 Hzなのに60 Hzで書き出し、走行で最大9°ずれた→原本のキー間隔を読み取ってBlenderのfpsを合わせる。④三角形数が目標以下のbotでmeshoptが停止→目標を元の数で頭打ち。
- 当たり判定の維持: 再計測した外形がC1より大きくなった静物は一様縮尺で合わせた（テント×0.907、岩×0.975）。マンモスは見た目の高さ3.6 mを保ち、ゲーム上の体の半径は `shared/animals.mts` の `MAMMOTH_BODY_RADIUS`（C1の計測値）に固定。橋は深さ方向の床幅をC1と同じ2.34 mにするため×1.05、通路（`BRIDGE`/`walkBounds`）は変えず床の高さだけ再計測。
- GPU競合: TRELLIS実行中にChromeのGPU描画で比較画像を撮ると、BiRefNetや高解像度段で 0xC0000409 停止（6 GB VRAM）。失敗2件を再投入し、比較撮影は `QA_SOFTWARE_GL=1`（SwiftShader）に変更。
- 人物の続き: `scripts/remake/human_graft.sh`（体と頭の位置合わせ→首で切断→頭はxatlas→結合）、`human_chain.sh`（配信と同じ身長へ一様縮尺してリグ→槍突き→Downed→CMU歩走→LOD）、`adopt_human.mjs`。男性はこの手順で1.80 mに合わせて再採用。

## ランドマーク・地形・敵・人物の続き（2026-10-07 06:00〜）

- **大城（valley-castle）**: 形状は歩行面アトラス（0.35 m格子）とカメラの三角形索引の計測元なので三角形を変えない。TRELLIS dense（ref04）を相似ICP（`fit_to_delivered.py`、RMS 0.52 m / p95 1.10 m、幅110 m）で配信面へ重ね、配信UVへ2048接空間法線をベイク（`normal_upgrade.py`、未命中 5,753 / 2,120,288 texel）→ 元GLBの末尾へWebPと `normalTexture` だけを追加（`inject_normal_map.py`）→ `adopt_normal_injection.mjs` が全アクセサのバイト一致を再検証してから `model-r13-normal.glb` を採用し、`shared/castle-surface-data.mts` の `sourceSha256` を新GLBへ、`measuredFromSha256` に計測元を記録。`tests/castle.test.mjs` 3/3。比較 `output/asset-remake/compare/valley-castle/pair*.png`（石積みの陰影が少し増える程度の控えめな改善）。
- **地形タイル5種は保持**: 配信タイルは継ぎ目を合わせるため歩行面を平坦化した20 m角（上面の起伏約1.2 cm）で、`placement.heightField` がサーバーの地面高さになる。草原で試した法線転写は、厚い板状のdense（起伏約2 m）とRMS 2.38 m・3.34M中2.07M texel未命中で、平らな歩行面に無い丘を描いてしまうため不採用。作り直すと高さ場（＝ゲーム仕様）が変わる。
- **洞窟・山・川・旧石槍は保持**: 洞窟（r26）と山（r15）は歩行・床・天井データが配信GLBのハッシュで固定され、制作元denseがこのPCに無いので系統を保った再ベイクができない。川は実行時シェーダーが見た目の本体。flint-spear は `model-review.ts` のみで未使用。理由は `assets/asset-remake/status.json`。
- **カラス人間**: 承認済みデザインのため転写経路（t01）。65,750→33,548三角形＋法線、LOD 10,064（28 m）、24骨・6動作不変、`tests/enemies.test.mjs` 21/21。位階の装備（コードの円柱・円錐）はTRELLISの小道具10件（キュー0739a〜j）に置き換え予定。`src/crow-faction-visuals.ts` は表形式（骨・残す位置・発光オーブはVFXとして維持）へ変更する。
- **ネアンデルタール男性**: 体と頭部の新参照→TRELLIS→頭部接合。r01は首1.48 mで体側の粗いひげが残る、r02は首1.40 mでスカーフが欠け頭部の白い台座が出る、r03（体の首1.48 m・頭の切断1.40 m・あご帯1.38〜1.48 m・白い台座と胸像を除去）を採用。1.72 mでリグ→槍突き→Downed→CMU歩走→LOD。53,176三角形／LOD 10,635、関連37テスト合格。`human_graft.sh` に `HEAD_CUT`（頭だけ低く切る）を追加。
- **猫耳のくノ一**: 転写（t01、43,946三角形）は元の顔の崩れ（目のにじみ）をそのまま残すため予備扱い。新しい体＋頭部のTRELLIS接合で作り直し、刀の `Attack` は人型チェーンに無いので `scripts/remake/retarget_clip.py`（各骨の静止姿勢からのワールド回転差を新リグの静止向きへ、腰の移動は腰の高さ比で）で配信版から移す。ネアンデルタールのリグで試験し、振りかぶり→前への斬り→戻りの向きが一致、他クリップは120 Hzのキーを保持。
- **くノ一の採用**: 頭部の位置合わせは肌だけのICPが失敗（頭が4%の大きさで浮く、`graft/failed-align-r01` に保持）、形全体のICP（耳と髪が手掛かり、RMS 9 mm）で成功。首まわりはr02〜r11で調整：体の首1.38 m／頭の切断1.368 m、`merge_head.py` に追加した「首の下に残った真っ黒な旧髪」の帯（輝度<0.035・半径12 cm）、首の円柱（半径7 cm）、位置で溶接した小さな島の除去（`--body-islands`）、喉の直前だけの狭いあご帯（1.365〜1.39 m、喉の推定を切断上6 cmに修正）。`human_chain.sh` に `RIG_EXTRA='--accent none'`（C1と同じくTribeAccent無し）と `RETARGET_ATTACK_FROM`（刀の `Attack` を転写）を追加。52,420三角形／LOD 10,484、関連42テスト合格。近接で喉の前に小さな暗いくぼみが残る。
- **クリップの一致検査**: `scripts/remake/check_clip_parity.mjs` で採用済みの全アニメーション資産を旧配信と比較（名前・長さ・ループの閉じ）。転写の書き出しが全クリップを1つのfps（120）で取り直すため、格子から外れたクリップが短くなっていた：砂耳の魔法使い `Run_Loop` 0.76→0.7583 s（ループが1.1°開く）、りもねこ `Hiss` 2.1→2.0917 s。`scripts/remake/copy_animations.mjs`（配信済みのクリップを同名の骨へそのまま移し、メッシュ・スキン・画像のバイトは不変を検証）で直して再採用し、`reduce_delivered.sh` の標準手順にも追加。全件一致。
- **素材検証（`scripts/verify-world-assets.mjs`）**: 制作記録の一覧 `assets/world-models.json` と各素材の採用レビューが旧配信のままだったため、`scripts/remake/sync_production_records.mjs` で再制作した各キーの採用レビュー（`assets/asset-remake/reviews/<key>.json`、配信SHA・status.jsonの検証内容）を作り、一覧のSHA・URLを更新し、新しい小道具を追加。検証スクリプトは再制作品の過去の狩猟検査を `previousProvenance`（残した旧配信）に対して行うよう変更（検査自体は弱めていない）。worktreeに無い無視対象の保存物は本体の `output/hunting-animation`・`output/model-generation` へジャンクションで参照。途中で丸木舟と丸太の個別 `asset.json` が再計測前の外形のままだったのを発見し、実GLBと一致する一覧側に合わせた。
- **カラスの小道具**: 槍・両刃斧・薙刀・司教杖・獣皮の盾（2,372〜3,494三角形、1024テクスチャ）を新しい種類 `prop` として登録（`scripts/remake/adopt_new_asset.mjs`、`adopt_crow_props.py`）。`src/world-assets.ts` の装備の読み込みが `prop` も扱う。`scripts/remake/compose_props.py` でカラスのリグの静止姿勢に置いて位置を確認（`output/asset-remake/compare/crow-props/compose-a.jpg`）。骨の肩当ては1回目のTRELLISがCPUの再メッシュ段階で停止（検証スクリプトの大量読み込みと重なりコミット上限）→再投入。
- **カラスの小道具（続き）とベリーの房**: 赤い肩衣・象牙色の祭服・教皇の冠・骨の肩当て（2,584〜2,929三角形）とベリーの房（1,172三角形、512テクスチャ、14 cm）を登録。肩当てとベリーはmeshoptが誤差上限（大きさの1%）で止まり（多数の小さな別部品）xatlasが長時間止まったため、`process_static.sh` に `MESHOPT_ERROR`（3%）を追加し、削減後の三角形が予算の2倍を超えたら止める安全策を入れた。`src/crow-faction-visuals.ts` は位階ごとの表（骨・静止姿勢での置き位置）に変更し、`src/world3d.ts` の `loadEnemy` が小道具をカラス本体と一緒に読み込む（揃わなければ表示しない）。ベリーは `attachBerryClusters` が房をアンカーごとに複製し、残量表示（`fruitCount`）は従来どおり。旧来の発光球と同じく遠くから見えるよう、共有材質が自身のアルベドを0.35だけ発光。
- **小物・ランドマーク**: 選び方は「新しいTRELLIS」と「配信済みの面を減らして焼き直す」を並べて比べ、良い方を採用。
  - ザル貝: 新規はつぶれた形と黒い裂け目で不採用、配信面を35,645→1,474三角形に削減して採用（見た目はほぼ同一、黒い点も消えた）。
  - 貝塚: 新規TRELLIS（8,940、貝の形がはっきり）を採用。旧92,239。
  - サボテン: 新規（8,991＋LOD 3,599/1,349、筋と刺座と砂の根元）。当たり判定を同じ計測ツールで再計測（16セル、旧15）。
  - 氷の尖塔: 新規（11,999＋LOD）。当たり判定はC1のツールをリポジトリへ移植（`scripts/remake/measure_landmark_footprint.py`、C1のGLBでC1の判定と完全一致を確認）して再計測（187セル、旧182）。
  - 火山: 新規は溶岩の筋と火口の光が消え（ゲームの溶岩シェーダーは赤いアルベドを読む）11%高くなったため不採用。C1自身のdenseから法線だけを焼いて追加（形状バイト不変、判定データはハッシュだけ更新）。
  - 玄武岩: 新規を採用し、幅をC1の外形（3.86 m）に合わせて当たり判定がC1内に収まるよう縮尺（高さ4.22 m、旧4.60 m）、再計測53セル（旧58）。
  - 黒曜石の槍・刀: 握りの位置をC1と同じ比率にして、握りから石突き／先端の長さがC1と1 cm以内（3,995・5,997三角形、旧5,679・22,201）。黒曜石の刃: 横たわった参照から作り、長さで縮尺し、ルートノードの変換だけで槍の握り座標系（根元1.094 m）に立てた（`scripts/remake/orient_blade.mjs`）ので作業台の置き方は不変。
  - 草・ぱらぱら草・松は保持（理由は status.json）: 新しい復元は細く黄色い葉（地面の色合わせが葉の測定値に依存）や、ユーザーが以前「不気味」と却下した粒状の針葉に戻ってしまう。
- **ゲーム内確認（GPU、`scripts/remake/qa-remake-game.mjs`、最終 `output/asset-remake/game/final-r1/`）**: 実Chrome＋通信4人の5人、マンモスにRで乗りW/Shiftで7.86 m移動→降りる→Fで狩り→Death→肉、カラス各位階で小道具が正しい骨に付き三角形数も一致（門徒: 盾2,372＋槍2,993、戦僧: 斧＋肩当て、大司祭: 薙刀＋オーブ＋肩衣、教皇: 冠＋司教杖＋オーブ＋祭服、呪僧: オーブ）、ベリー5房すべて表示、仲間の読込完了、氷の尖塔・火山（溶岩の光あり）・サボテン・玄武岩の地域で表示。ページのエラー0。座標とカメラはこの使い捨てサーバー上の準備操作で、乗る・走る・攻撃は実キー。
- **不具合修正**: `unadopt_world_asset.mjs` が `model-c\d` に一致する追跡済みの `yellow-524-mascot/model-c14.glb`（C14原本）を削除していた → gitから復元（SHA 2652765f…一致）し、追跡済みファイルは消さないよう修正。採用済み36件のマニフェストの `revision` が旧版のままだった → `c2-<リビジョン>` に直し、旧値は `previousDelivery.revision` へ。
- **テスト**: 524とまるぃもの配信テストは旧GLBのバイト一致を前提にしていたため、「保持した旧配信の一致」と「C2の骨名・クリップ・ゲーム内寸法・法線マップ」の2本に分けた（21/21、7/7）。全体は1023件中1019合格で、残る失敗は既存の3件＋まるぃものメモリ不足（TRELLIS・Blenderと同時実行で41 MBの比較が確保できず、単独実行で合格）。

## 既知の判断・注意

- 頭部（画面いっぱいの対象）はTRELLISのtex 1024で6 GB GPUがあふれ約1時間かかる → 頭部はtex 512（承認済み女性頭部と同じ）。
- 大虎の新参照は2回とも縞が強くなり、ユーザーが選んだ「金色・薄い縞」から外れたため、承認済み元画像 `candidate-01.png` から再構築する。
- 松は過去にユーザーが「粒状の針葉が不気味」と却下した経緯があるため、新しい再構築が滑らかな樹冠の基準を満たす場合のみ採用する。
- ゲストキャラクター（524・りもねこ・mae・こはく・まるぃも・Howkey・orb bot）は承認済み参照画像をそのまま使い、同一性を変えない。
- テスト（最終）: `node scripts/build.mjs`・`tsc --noEmit`・`npm run check`（TypeScript、527 JSの構文、依存境界）成功。全1026件中1023合格。失敗3件（hunting-client「resource models deplete visibly」、hunting「both mammoth grounds…」、mammoth-ground「old cliff positions…」）は、未変更の `HEAD` 21e4bf8 の別worktree `../CRO-MAGNON-baseline` でも同じく失敗する既存失敗。`scripts/verify-world-assets.mjs` は71モデルで合格（過去の動作検証は置き換え前の配信に対して実施）、`npm run build:mmo` は561ファイル・331.0 MiB・GLB 120（分割0）で成功、`scripts/remake/check_clip_parity.mjs` は全件一致。


## 性能（代表3体＋焚き火の組み込み後、同条件・GPUキュー停止中）

`scripts/remake/qa-remake-perf.mjs`（Chrome headless、Intel Iris Xe、1280×800、1画面＋通信4人、45bot・524・りもねこ）。基準は未変更HEADのworktree `../CRO-MAGNON-baseline` で同じスクリプトを実行。

| 場面 | 変更前 fps / p95 / draw / 三角形 | 変更後 |
|---|---|---|
| キャンプ | 49.4 / 33.4 ms / 179 / 6,034,076 | 49.7 / 33.4 ms / 179 / 5,982,056 |
| マンモス近景 | 60.0 / 16.8 ms / 90 / 5,052,825 | 60.1 / 16.8 ms / 90 / 5,124,022 |
| 野営地俯瞰 | 46.4 / 33.4 ms / 205 / 5,521,311 | 45.5 / 33.4 ms / 206 / 5,520,874 |
| 読込 | 21.1 s、GLB 85本 557.3 MB | 22.1 s、555.3 MB |

差は測定誤差内。TRELLIS実行中に測った1回目（camp 36 fps、読込52 s）はCPU競合によるもので、比較から除外（記録は `output/asset-remake/perf/after-reps`）。重い資産（190k〜449k三角形の人物・仲間、103k三角形の茂み）の置換後に効果を再測定する。

## 性能（全件の組み込み後、同条件・交互に2回ずつ）

同じ `scripts/remake/qa-remake-perf.mjs`（実Chrome headless、Intel Iris Xe D3D11、1280×800、1画面＋通信4人）を、未変更HEADのworktree（`../CRO-MAGNON-baseline`）とこのブランチで 前→後→前→後 の順に実行（`output/asset-remake/perf/final-*`）。TRELLISキューは空、GPUは未使用の状態。

| 場面 | 変更前 fps（1回目/2回目） | 変更後 fps | 描画三角形 前→後 | draw calls |
|---|---|---|---|---|
| キャンプ | 21.7 / 23.6 | 22.2 / 20.0 | 6,034,076 → 4,928,177（−18%） | 179 → 178 |
| マンモス近景 | 29.9 / 31.5 | 29.4 / 25.9 | 5.14〜5.22M → 4.48〜4.54M（−13%） | 97〜98 → 96〜113 |
| 野営地俯瞰 | 19.7 / 17.9 | 17.9 / 17.8 | 5,521,311 → 4,903,312（−11%） | 205 → 207 |

- 読み込んだGLBの合計: 551〜557 MB → 226〜232 MB（−59%）。JSヒープ: 1.79〜1.85 GB → 0.93〜1.00 GB（−46%）。テクスチャ数: 93 → 132〜152（追加した法線マップ）。
- 準備完了時間: 31.7 / 31.1 s → 49.3 / 31.7 s（変更後1回目はディスクキャッシュが冷えた状態の外れ値と見られるが、断定はしない）。
- **fpsは変化を主張しない**: 同条件でも回ごとに±3 fps揺れ、フレーム時間はheadlessの16.7 ms刻みに量子化される。この時間帯は変更前・後ともに午前の測定（キャンプ49 fps）より大きく低く、マシンの状態（電源・温度）に左右されている。三角形数・読み込み量・メモリの削減は確実に測れた。

## 残る作業と制約

- 全61素材の判断は済み（再制作して組み込み49、理由付きで保持12）。コード製の2件（カラスの装備、ベリーの球）は新しい10素材に置き換え。一覧は `docs/asset-remake/INVENTORY.md`、採用レビューは `assets/asset-remake/reviews/`。
- 未確認: 実スマホ・Safari・物理ゲームパッド・長時間の負荷・展示PCでの表示。fpsの改善は主張しない（上表）。
- 既知の見た目の制約: くノ一の喉の前の小さな暗いくぼみ（近接時）、氷の尖塔の暗い割れ目、黒曜石の刃の縁のわずかな黄土色、新しい人物の首の継ぎ目は近接でわずかに見える。
- 保持した12件（地形タイル5、洞窟、山、川、旧石槍、草、ぱらぱら草、松）は理由を `assets/asset-remake/status.json` に記録。
- ユーザー指示で `main` へマージ。push・公開デプロイ・展示配布・3000/8787番の再起動はしていない。
