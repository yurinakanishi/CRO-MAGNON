# マンモスの一本の尾をBlenderで構造から補修

2026-09-13。r05の「毛束の頂点を潰して消す」処理をユーザーが不自然と指摘し、象のように一本が垂れる尾をBlenderで作り直すよう指定した。

採用GLBは `public/models/woolly-mammoth/model-tail-r11.glb`。SHA-256は `f6fad8db82228cfb110cb1b513e0a09cfd54b6325de4dcfcf9f4a95525d66712`、7,319,308 bytes、26,067三角形。旧r04・r05・元モデルと以前のレビューは残している。TripoもClaudeも使用していない。

## Blenderで行った補修

`scripts/blender-mammoth-tail.py` がBlender 5.2.0の実際のBMesh・スキン・画像ベイクを操作する。入力は潰していないTRELLIS由来のr04。後方の分岐した面を切り、中央の付け根に存在する31辺の輪から15段を押し出して、一続きの丸い尾を作った。先端は少し太い毛の房にして閉じた。左右の切断部は面を張り、分割して周囲とともにならした。Hips／Tail1／Tail2へ滑らかに荷重を配分し、旧尾の荷重が残る後部の面は腰へ戻した。

修復箇所の毛色は元のテクスチャを保ち、元モデルの脇腹から512角へベイクした。UVの島を跨いだ補間による黒い線を避けている。新しい一式の動物モデルをプリミティブから作ったものではなく、元モデルの局所補修である。

Blender正本は `output/mammoth-tail/revision-11/mammoth-tail.blend`。再読込した配信候補も `final-glb.blend` に保存。r06〜10の診断・修正途中は同じoutput内の別revisionに残した。r06の初期パッチ診断画像は、検討中に同名へ更新したものもある。

`scripts/build-mammoth-tail-glb.mjs` がBlenderからの実メッシュを元GLBへ格納する。元バイナリ4,425,012 bytesを先頭に保持し、24骨・逆バインド行列・5クリップ・元テクスチャをそのまま残した。尾と後部以外の表面の位置は元モデルに一致し、動画中の最大差も0.000000686m。法線は再計算した。移動速度・攻撃・当たり判定・座面の設定は変更していない。

## 検証

- `scripts/verify-mammoth-tail-structure.mjs`：全5動作を240Hz相当で読み戻し、尾の床下への沈みなし。走行中の尾の最低高さは0.3626m。ループの継ぎ目は0.01mm以内。
- 高さ0.7〜1.9mの7断面で、閉じた輪が一つだけであることを検査。断面の幅と厚みは約9.5〜16.8cmで、扁平な面ではない。
- Chrome：5動作×5方向×5時点の125画像、歩行72枚・30fpsの比較動画。`output/playwright/mammoth-tail-structure-r11/`。
- Blender：最終GLBの待機姿勢と全5動作を、後方・斜め・横・近接から再描画。`output/mammoth-tail/revision-11/final-*.png`。
- 狩猟・騎乗の32テスト、型・strict・313JS構文・依存境界、42モデルの `verify:assets` が通過。
- 実Chrome2画面＋通信3人で、後方4方向・騎乗歩行・騎乗走行・相手画面の走行同期・停止・降りる・390×844／844×390・タイトル経由の再読込を確認し、エラー0。記録は `game-qa.json` と `output/playwright/mammoth-tail-r11-game-verified/`。QAの最初の静止画像だけは巡回を止める専用fixtureを使用し、騎乗後は通常のサーバー移動処理を使用した。
- 通常3000番のURLとSHA照合は `delivery.json`。サーバーの手動再起動なし。初回のQAは既存の大きい接触半径内へ立たせて待ちが失敗し、次は再読込後のタイトル操作が抜けて時間切れになった。QAを修正して再実行した記録を残している。

元の復元にある腹下の不規則な毛の面は残る。全メッシュの自己交差、脚ごとの坂・段差IK、長時間負荷までを保証する検査ではない。展示・PC2更新、公開デプロイ、コミットは行っていない。

## 再現

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b -t 6 --python scripts/blender-mammoth-tail.py -- build
node scripts/build-mammoth-tail-glb.mjs
node scripts/verify-mammoth-tail-structure.mjs
node scripts/qa-mammoth-tail-structure.mjs
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b -t 6 --python scripts/blender-mammoth-tail.py -- render
node scripts/adopt-mammoth-tail-structure.mjs
node scripts/qa-mammoth-tail.mjs output/playwright/mammoth-tail-r11-game-verified
```

Blenderの面・頂点の列挙順でバイナリのSHAは変わり得る。採用済みバイト列は保管したGLBを正本とする。
