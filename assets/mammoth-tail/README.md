# マンモスの尾の張り出しと、胴体の透けを修正（r12）

2026-09-13。ユーザーの「付け根が横に行き過ぎている。もっとすぐに垂れるべき」「マンモスが壊れて透けている」に対応。

配信モデルは `public/models/woolly-mammoth/model-tail-r12.glb`。SHA-256は `dc8ddadd93b9ef078cf75e0e6c182521ad167a30d4ecae57b75daf5d01e13ba8`、7,280,948 bytes、26,067三角形。旧r04・r05・r11・元モデルを保存。Tripoは使用していない。

## 原因と修正

r11では、Blenderの全体への `recalc_face_normals` が、UVなどで分断された元メッシュの面を個別に反転していた。尾以外の22,272枚を元のr04と照合すると、位置・三角形数は一致していても **11,290枚が逆向き**。ゲームの片面描画ではそれらが消える。以前の検証は頂点位置と変形を中心に確認し、面の向きの誤りを見逃した。記録は `r11-surface-defect.json`。

`scripts/blender-mammoth-tail.py` は元の面の向きを保持し、新しく押し出す尾だけを局所的に整える。元の体の分割法線を保持し、GLB格納時にも元の位置・UV・法線で照合する。材質は不透明・片面のまま。

尾の中心線は付け根から直ちに下がり、横に張り出してから曲がる形を廃止した。高さ1.9mの中心は後方2.284m、0.7mでは2.345mで、1.2m下がる間の前後差は約6.1cm。円形断面が先に向かって細くなり、先端に毛の房が付く。

後部の分割処理でPythonのBMVert参照が無効になる点も修正した。尾の465頂点に永続IDを付け、分割後に取り直すことで、お尻をならす処理が尾の上部まで潰さないようにした。尾の全頂点が制作した位置を保つことをBlender内で検査する。

正本は `output/mammoth-tail/revision-12/mammoth-tail.blend`。元バイナリ4,425,012 bytes、24骨、逆バインド行列、5クリップは保持。速度・攻撃・当たり判定・座面は従来どおり。

## 検証と証拠

- `scripts/check-mammoth-surface.mjs`：尾以外の22,272三角形に欠落・追加・裏返りなし。元の法線との最大比較差0.000095未満。
- `scripts/verify-mammoth-tail-structure.mjs`：7断面はいずれも丸い閉じた輪が一つ。5動作を240Hzで読み戻し、最低の尾の高さ0.365m、床沈みなし、ループ連続。補修外の変形差は0.000000686m以下。
- Chrome：5動作×6方向×3時点の90条件で、片面／両面のシルエットを元のr04と比較。r11の最大欠け率22.59%に対し、r12は0.0274%以下。微小な毛の縁を含む残差も記録しており、画素差が完全なゼロという検査ではない。
- Chrome：5動作×5方向×5時点の125画像と30fpsの歩行比較動画。`output/playwright/mammoth-tail-structure-r12/`。レビューには検査したGLBのSHAを固定し、採用時に照合する。
- Blender：最終GLBを読み直し、後面を隠す診断材質で待機と全5動作を6方向、計36画像。`output/mammoth-tail/revision-12/final-*.png`。Cyclesでは元の重なった毛の隙間が深い影になる。ゲームの不透明性は実Chromeと面の向きで別途確認する。
- 実Chrome2画面＋通信3人：前面・側面・後面、騎乗歩走・同期・停止・降りる、縦横画面・再読込を確認。エラー0。`game-qa.json` と `output/playwright/mammoth-tail-r12-game/`。
- 通常3000番の配信、資産検証、型・構文・依存境界、狩猟／騎乗32テストは `delivery.json`・`checks.json`。r11の記録はそれぞれ `*-r11.json` に保存。

元の腹下・お尻にある不規則な毛の層は残る。全メッシュの自己交差・脚別の坂IK・長時間負荷は今回の検査範囲外。通常3000番は照合時に停止していたため開発サーバーを新規起動した。既存サーバーの停止・古い保存の再適用・公開デプロイ・展示／PC2更新・コミットは行っていない。

## 再現

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b -t 6 --python scripts/blender-mammoth-tail.py -- build 12
node scripts/build-mammoth-tail-glb.mjs 12
node scripts/verify-mammoth-tail-structure.mjs output/mammoth-tail/revision-12/model.glb
node scripts/qa-mammoth-tail-structure.mjs 12
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b -t 6 --python scripts/blender-mammoth-tail.py -- render 12
node scripts/adopt-mammoth-tail-structure.mjs 12
node scripts/qa-mammoth-tail.mjs output/playwright/mammoth-tail-r12-game
```

Blenderの列挙順で再制作したバイナリのSHAが変わる場合があるため、採用済みのGLBは上書きせず、新しいrevisionを使用する。以前の工程は `README-r11.md` に保存したが、r11の外観を合格とした判断は今回の指摘で訂正した。
