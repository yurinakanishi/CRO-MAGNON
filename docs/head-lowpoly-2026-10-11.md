# 顔を作り直した人物3体の頭部の軽量化（2026-10-11）

ユーザー指定「頭部の作り直し、進めて」への対応記録。[配信用変換](delivery-cooking-2026-10-11.md) の「残る根本課題1」。顔の見た目に関わるため、近接比較を見てもらってから採用した（比較画像と数値を示したあと、ユーザー「採用して進めて」、2026-10-11）。**r08を採用済み。**

## 原因：継ぎはぎの頭部を、UVの継ぎ目ごと抱えたまま配信していた

face remake（2026-10-07）で接いだ3体の頭部は、TRELLISのxatlasチャートが1つずつ別の島になった継ぎはぎで、位置で見ると1.7万〜2.5万本の開いた辺がある。UVの継ぎ目を守る簡略化ではほとんど減らないため、起動用の最適化（`20261010-r07-a01`）でも頭部は全面のまま残っていた。

| 人物 | 頭部 | 人物全体 | 他の人物の頭部 |
| --- | --- | --- | --- |
| cro-magnon-woman | 52,910三角形 | 72,851 | 約1.35万 |
| neanderthal-woman | 50,800 | 68,553 | |
| neanderthal-hunter | 59,898 | 99,379 | |

## 方法：位置で溶接して簡略化し、新しいUVへ焼き直す

`node scripts/face-remake/lowpoly-heads.mjs --revision rNN` が4段階を順に実行する。正本（いま配信している起動用GLB）と焼き付け元（2048pxのface remake GLB）はSHA-256で固定。

1. **形状**（`lowpoly-head.mjs`）：頭部を位置で溶接し、継ぎはぎの割れ目（T字の接合）を閉じ、裏返しの面を外向きにそろえる。同じ3頂点に重なった二重層を除き、首の継ぎ目から2.5cmを固定して、髪・顔以外の肌・顔を順に簡略化する（誤差の上限：顔0.8mm、肌2mm、髪は頭の大きさの2%＝約5〜6mm）。最後に、つながった面ごとに巻き方向を1つにそろえる。残る頂点はすべて採用中の頂点で、位置・関節・ウェイトをそのまま写す。
2. **UVと焼き付け**（`bake-head.py`、Blender 3.6、`-t 1`）：顔を1枚の等角チャート、残りをSmart UV（66°）で展開する。チャートが折り返して重なった面は切り出して投影し直し、最後は1面1チャートにして、焼き付けの全テクセルが1つの面にだけ属する状態にする（最後にテクセル単位で証明し、共有が1つでもあれば停止）。顔の島は他の2倍の密度、島どうしの間は焼き付けで4テクセル（配信で2テクセル）。2048pxで色だけを焼き、1024pxで配信する。
3. **組み立て**（`assemble-head.mjs`）：頭部の部品だけを差し替える。体の部品・スキン・逆バインド・ノード・全動作がデコード後に正本と一致することを検査する。
4. **顔の比較**（`qa-lowpoly-head.mjs`）：実Chrome（ANGLE D3D11）とゲームのThree.jsで、正本と並べて描く。0.55mの正面・斜め・横・後ろ・あごの下（照明あり／照明なしの色だけ）、1.3mで4つの動作、3.2mで全身。首の継ぎ目は6動作で位置のずれと法線の角度を測る。

同じ入力・同じスクリプトから2回作った版（r08とr09）は、中間ファイルとGLBが全件バイト一致した。

## 途中で見つけて直したこと

最初の候補（r02〜r04）は見た目がほぼ同じだったが、照明なしの比較と数値で次の問題が見つかった。

- **あごの下の暗い三角形（r04）。** 二重層が同じ3頂点に重なって残り、片方のUVが1点につぶれていた（溶接後に3体それぞれ約560〜1,770枚、簡略化後にも約230〜640枚）。さらに隣り合う三角形の巻き方向が2,210本の辺で食い違い、Blenderの展開が顔チャートの2割を折り返していた。焼き付けの外殻（ケージ）も巻き方向から押し出し方向を決めるため乱れる。→ 二重層の除去と巻き方向の一貫化（食い違い2,210→3本）、折り返し・重なりの切り出しで解消した。
- **テクスチャの使用率4〜8%。** 島の間隔を「各島の大きさに比例」で指定していたため、髪の数千の小さな島の余白が画像の9割以上を占めていた（r04の髪は現行の約3分の1の解像度）。→ 画像に対する割合で指定し、使用率は34〜38%。顔の密度は現行の約2〜4.5倍、髪も現行以上になった（下表）。
- **焼き付けが実行ごとに少し違う。** Blenderの既定のスレッド数だと、髪の重なった層に当たる光線の順が変わり、小さな島の色が変わる。→ `-t 1` でビット単位で再現する。

## 結果（r08）

| | cro-magnon-woman | neanderthal-woman | neanderthal-hunter |
| --- | --- | --- | --- |
| 頭部の三角形 | 52,910 → **21,080** | 50,800 → **17,563** | 59,898 → **26,614** |
| 人物全体の三角形 | 72,851 → **41,021** | 68,553 → **35,316** | 99,379 → **66,095** |
| 配信ファイル | 3,061,772 → **2,316,120** B | 2,767,304 → **2,134,072** B | 4,635,128 → **3,617,580** B |
| 顔の解像度（1024px、テクセル/mm²） | 0.72 → **3.24** | 0.67 → **2.01** | 0.75 → **1.61** |
| 後頭部の髪の解像度 | 0.78 → 0.79 | 0.72 → 0.90 | 0.57 → 0.61 |
| 首の継ぎ目（6動作） | ずれ0、法線の差4.31°（正本と同じ） | ずれ0、0.65°（正本と同じ） | 共有頂点なし（首は襟の内側で重なる設計） |
| UVの重なり | 0 | 0 | 0 |

- 顔の解像度は、元の2048pxテクスチャ（2.9〜3.0）にほぼ届く。
- 見た目の比較（ユーザーが確認した画像）：`assets/face-remake/lowpoly-head-r08/review/`（faces-close：正面と斜め、faces-albedo：照明なし、poses-body：走行と全身。各組の左が採用前、右がr08）、各人物の全シート `assets/<key>/qa/lowpoly-head-r08/`。
- **見える差：** cro-magnon-womanのあごの下を見上げた時に出る明るい帯（face remakeの首の接続部。正本にもある）の縁が、候補では少しぎざぎざになる。見上げる角度でしか見えない。髪は形の簡略化（約5〜6mm）で近距離では少し角ばる。

計測（採用前に実施。実スマホではない。Windows Chrome・390×844・CPU4倍・10Mbps／50ms・空キャッシュ。採用前の持ち運び版 `output/delivery-r04-local-a01` に候補3体だけを配信形式で差し替えた `output/head-lowpoly-qa-local-a02`。性能は5人接続）：

| 指標 | 採用前（2回） | r08（2回） |
| --- | --- | --- |
| 確定→洞窟で操作可能（アプリ内） | 6.50〜6.58秒 | **5.88〜6.02秒** |
| 確定→通常世界の操作有効化 | 19.73〜19.99秒 | 19.26〜19.43秒 |
| 確定タップ→実タッチ移動の確認 | 23.11〜23.36秒 | 22.91〜22.97秒 |
| 操作可能までの受信本文 | 18.02〜18.81MB | 17.40MB |
| 読み込んだモデル（5人接続） | 57.56MB | 55.16MB |
| 描画三角形（キャンプ／マンモス／遠景） | 70.1万／55.0万／86.0万 | **63.6万／48.5万／79.5万** |
| GPU時間p50（同） | 4.84／3.99／6.12ms | 4.70／3.86／5.67ms |
| fps | 30（上限） | 30（上限） |
| GPUテクスチャ（同） | 315.07／322.59／397.07MB | 315.16／322.67／397.16MB |

- 起動時に読むのは自分の人物（cro-magnon-woman）だけなので、起動の短縮はその1体分（約0.75MB）。残る2体は仲間として表示するときに読む。
- 三角形の削減はこのデスクトップGPUではGPU時間の誤差程度にしか表れず、fpsは上限の30のまま。スマホでの効果は未検証。
- GPUテクスチャの+88KBは、頭部画像が1016×1024から1024×1024になった分。
- 5人接続のゲーム画面：`output/playwright/delivery-r01/perf-heads-r08/camp.png`、`heads-r08-net-r01/first-movement.png`。

## 採用

`node scripts/face-remake/adopt-lowpoly-head.mjs --revision r08 --reproduced r09 --date 2026-10-11 --approved "…"` で採用した（[source-model-revision](../scripts/source-model-revision.mjs) による正本の更新。洞窟 r27 と同じ仕組み）。

| 人物 | 配信する正本（新） | SHA-256 | 置き換えた起動用ファイル（残す） |
| --- | --- | --- | --- |
| cro-magnon-woman | `/models/cro-magnon-woman/model-face-lp-r08.glb`（5,278,800 B） | `c495179a518d8d557ef9d0ef8795b85a58403da9debef4212039e944a064314a` | `startup.opt-f414686fe312f6e3.glb` |
| neanderthal-woman | `/models/neanderthal-woman/model-face-lp-r08.glb`（4,859,144 B） | `343c7ae31d2c39ba13cb69a69e6fc5d6b2095055872a43bd085db9bf28b0e52a` | `startup.opt-fabb21a67061a199.glb` |
| neanderthal-hunter | `/models/neanderthal-hunter/model-face-lp-r08.glb`（7,548,664 B） | `c5c93e0298d70f684fd274aef29bf655a89733d1d0b23bb0341ceb534d4c6ed6` | `startup.opt-ef3e3fa2f2931daf.glb` |

- 正本はロスレス（頭部画像はPNG）。配信時は配信用変換でWebPになり、上の「配信ファイル」の大きさになる。
- 各人物の `assets/<key>/` に、採用前のmanifestの保存（`archive-manifest-20261010-r07-a01-20261011.json`）、レビュー記録（`qa/lowpoly-head-r08.json`：承認、方法、設定、中間ファイル・スクリプトのSHA、Blender等の版、制約）、`qa/source-revision-lowpoly-head-r08.json`（採用グラフの旧ファイルとレビューへのハッシュ結合）、QAシート一式を置いた。
- manifestは新しい正本を指し、`runtimeOptimization` は保存したmanifestに移った（`sourceRevision` と `lowpolyHead` で辿れる）。旧GLB・採用グラフ `20261010-r07-a01`・最適化の記録は変えていない。ビルドの採用グラフ検査では3体が `accepted-source-revision` になる。
- `assets/world-models.json` の3体の項目（SHA・配信URL・三角形数・revision）を新しい正本に合わせた（洞窟r27と同じ扱い）。`assets/asset-remake/tracker.json` は2026-10-07以降、起動用最適化でも再生成されておらず、今回も触れていない。
- テストの補助（`tests/cro-magnon-woman-rig.mjs` の `supersededManifest`／`recordedOriginal`、`tests/original-actor-pairs.mjs`、`tests/fixtures/guarded/source-revision.mjs`、`tests/asset-optimization.test.mjs`）を、承認済みの正本更新がある人物でも、置き換えた旧manifest（ハッシュで結合）から元の全面モデル・起動用ファイルを辿り、採用の監査に出る差分（manifest・起動用アクター・採用レコード）を正確に照合するようにした。

採用後の確認：

- 持ち運び版（`node scripts/build-exhibition.mjs --local output/head-lowpoly-local-a01`、263.8MiB）と公開MMO版（`--output-root=output/head-lowpoly-mmo-a01`、113.6MiB、GLBは配信形式で66.1MiB）を作り直し、実Chromeで開始→洞窟→通常世界→タッチ移動・停止（公開MMO版は隔離Miniflare）。採用した頭部の配信ファイルが要求され、正本GLBの要求は0（`output/playwright/delivery-r01/heads-adopted-packages-r01/`）。
- 実ゲームで4人物を実UIから選び、5接続で実キーの歩行・走行・攻撃・ジャンプ、相手画面での同じ動作、顔の近接撮影、390×844／844×390、再読込後の再参加。エラー0（`output/playwright/face-remake/heads-lp-r08-1791684188665/`、`overview.jpg`）。2026-10-07の確認手順の写し（`output/head-lowpoly/tools/qa-heads-game.mjs`）で、28m LODの往復だけを除いた（10-09の起動用最適化以降、人物は単一の本体でLODがないため）。
- 配信形式の3ファイルを正本と並べた比較（`scripts/delivery/qa-cooked-models.mjs`）：PSNR 53.3〜54.1dB、全動作の骨変形後の頂点差は最大0.53mm、構造の不一致0（`output/delivery-qa/heads-lp-r08/`）。
- ローカルの3000番などで動いているサーバーは再起動していない。次に起動したとき、配信用の対応表が作り直されて新しい頭部も配信形式で返る（それまでは正本のまま返る）。

## 検証の範囲

- テスト（採用後）：全体1,445件中1,441件合格・失敗0・条件付き4件未実行。新しい形状処理（二重層の除去・巻き方向の一貫化）は `tests/lowpoly-head.test.mjs`。`npm run check`（型・strict・603 JS構文・依存境界）合格。UV展開と焼き付けはBlender内の処理なので、各実行の最後の証明（共有テクセル0）とQAシートで確かめている。
- 確認していないもの：実Android／iPhone、実回線、発熱・電池。公開サイトへのデプロイ、展示機への配布は行っていない。
- 既存の失敗（今回と無関係）：`scripts/verify-motion-delivery.mjs` は cro-magnon-woman の `provenance.previousDelivery`（C2の `model-c2.glb`）を2026-09の動作の元データと前方一致で比べて食い違い、差分の作成でメモリ不足になって止まる。比べる値とファイル（`status`・`provenance.previousDelivery`・`motionReview` と、その指すGLB）は今回変えていない（コードで確認。採用前の状態での実行比較はしていない）。→ 同日修正：顔を作り直した人物は `previousDeliveries` に残る候補1の配信を比べ、目録は実行時採用の元（`runtimeOptimization.original`）と比べるようにした。動作の配信8件・71クリップ・以前のGLB 55件を照合（`assets/creature-motion/delivery-validation.json`）。
- 分析に使った道具（解像度・使用率・重なり・巻き方向・継ぎ目の法線・比較撮影）は `output/head-lowpoly/tools/`、各候補の中間ファイル・ログ・QAは `output/head-lowpoly/<key>/<revision>/`、失敗版を含む全候補（r01〜r09と試験用のt-*）も同じフォルダーに残している。
- 既存の3000／8787／4173の停止・再起動、ユーザー保存の編集、公開、commit／pushは行っていない。
