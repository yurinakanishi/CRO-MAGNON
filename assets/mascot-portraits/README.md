# マスコット選択用の実物写真

2026-10-15のユーザー指定により、りもねこ・524とDots全9種類を実際の配信GLBから撮影した。人物選択の次に開く「連れていく仲間」の画面と、ゲーム中の同じタブで共通の写真を表示する。

採用revisionは、りもねこ・524の [20261015-r01](20261015-r01/capture.json)（2枚48,966 bytes）と、Dotsの [20261015-dots-r01](20261015-dots-r01/capture.json)（9枚77,530 bytes）。384×320、透明背景、可逆WebPの計11枚126,496 bytes。元のGLB・材質・リグ・動作・旧肖像は変更していない。

## 撮影

`scripts/capture-mascot-portraits.mjs` が独立した保存なしサーバーを起動し、通常配信と同じdelivery overlayを適用する。実Chromeでゲームの `WorldAssets` を使い、SHAを検証して読み込んだモデルを撮る。りもねこは `Idle_Loop`、524は `Floating_Ripple` の0.4秒。524の大きさはゲームの `COMPANION_524.scale` と一致させた。

2匹とも縦0.78mの平行投影、正面から少し斜めのカメラ。半球光2、主光2、補助光0.7、ACES露出1.1。画像を描き直したり、参照イラストへ置き換えたりせず、実物の毛並みと「524」の顔を表示する。カード内では透明な外周余白を少し詰め、全身が切れない範囲で同じ倍率にしている。

- [撮影・元モデル・配信モデル・コード・写真のSHA](20261015-r01/capture.json)
- [配信先・採用画像のSHA](20261015-r01/adoption.json)
- [撮影時のスクリプト](20261015-r01/capture-mascot-portraits.mjs)
- [2枚の確認画像](20261015-r01/review.png)
- `rimo-neko.png`、`yellow-524-mascot.png`：元PNG。
- 同名の `.webp`：PNGの可視RGBと全画素の透明度に完全一致する配信用画像。

配信先は `public/models/rimo-neko/portraits/companion-r01.webp` と `public/models/yellow-524-mascot/portraits/companion-r01.webp`。`src/mascot-portraits.ts` で参照し、公開用ビルドでは有効なモデルの写真だけを含める。

## 再撮影と検証

Dotsは `Idle_Loop` の0.4秒を、ゲームと同じ `installDotBlink` を通した材質、目を開けた状態で撮影した。しろ・あお・みどり・むらさき・オレンジ・ベレーぼう・かえる・さんかく・ハートの9種類。大きさは実行時のまま、縦0.78mの範囲・照明・カメラはりもねこ／524と共通。参照イラストを撮影結果の代わりに使わない。

- [Dotsの撮影・SHA](20261015-dots-r01/capture.json)・[採用・配信先](20261015-dots-r01/adoption.json)
- [Dots全9枚の確認画像](20261015-dots-r01/review.png)
- 同フォルダーの各PNG／WebPと、撮影時点のスクリプトを保存。配信先は各 `public/models/orb-bot-*/portraits/companion-r01.webp`。

`npm run build` の後、`node scripts/capture-mascot-portraits.mjs assets/mascot-portraits/<新しいrevision>` を実行する。末尾へ `--dots` を付けるとDotsの9種類だけを撮る。元候補は上書きせず、画像を目視した後に別名で採用する。新しい3Dモデルの生成は必要ない。

`tests/starting-mascot.test.mjs` は元モデルのSHA・採用画像のSHA・PNG/WebPの一致を確認する。`scripts/qa-starting-mascot.mjs` は写真の表示と、入場後の実際のモデルのSHAが撮影した配信モデルと一致することを検証する。2026-10-15にいずれも合格。PCとスマホ幅の画像を目視した。
