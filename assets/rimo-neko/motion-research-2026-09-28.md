# りもねこ: 低い威嚇と疾走の資料（2026-09-28）

ユーザー指定によりGoogleで姿勢・実映像・連続写真を検索し、Candidate 1の
Hiss / Run_Loopを修正する。資料の猫を新しいモデルに置き換えるのではなく、
既存の灰白色の長毛モデルとリグを使う。

## 資料と観察

- Google検索: `cat defensive low crouch hissing ears flat body language`、
  `cat hissing crouching low`、`cat gallop slow motion footfall spine flexion`、
  `Muybridge cat galloping sequence`。Chromeで実際に検索・画像・動画を確認。
- [Humane World for Animals: Understanding cat behavior and feline language](https://www.humaneworld.org/en/resources/understanding-cat-behavior-and):
  防御時は低くかがみ、耳を伏せ、尻尾を身体に寄せる。背中を高く見せる別の
  威嚇表現もあるため、「威嚇は常に低い」と一般化せず、今回指定の防御姿勢を採る。
- [Cat Friendly Homes: Hiding and Hissing](https://catfriendly.com/why-does-my-cat/hiding-hissing/):
  Google画像で掲載写真を確認。伏せた耳と開口、前脚を曲げた防御姿勢の参考。
  写真を転載・素材化していない。
- [University of Edinburgh: Feline body language](https://vet.ed.ac.uk/sites/default/files/2024-09/Feline%20body%20language.pdf):
  耳を後ろに伏せ、身体を低くして尾を寄せる解説を確認。ブラウザーのPDF表示は
  完了せず、図版の詳細な視覚検証資料としては扱わない。
- [Celia Haddon: How a cat runs ... the gallop in slow motion](https://www.youtube.com/watch?v=dKiNVK_Fb7s):
  飼い猫Tobyの実写18秒。YouTubeで再生・静止して、前脚の接地、後脚の送り込み、
  丸まる背中を観察。動画説明も前脚の小さな時間差、後脚のまとまった動き、
  速度によるhalf-bound/full-boundの変化に言及。真正面寄りの映像で、
  全関節の三次元角度や実速度は計測できない。
- [Muybridge, Cat; trotting; change to galloping, Royal Academy](https://www.royalacademy.org.uk/art-artists/work-of-art/cat-trotting-change-to-galloping):
  Google画像の連続写真を観察。側面で、胴を伸ばした空中姿勢と後脚を腹下へ
  送り込む姿勢の差を確認。所蔵館の詳細ページは自動アクセス確認で未読。
- [Bertram & Gutmann (2009), Motions of the running horse and cheetah revisited](https://doi.org/10.1098/rsif.2008.0328):
  原著PDFの公開複製を閲読。接地で重心の落下を受け、次の空中局面へ移る
  力学的な区別の参考。チーターの数値をこの家猫へそのまま適用しない。

## このモデルでの作画判断

Hissは脚を曲げて胸・腰・頭を下げ、四つの足裏を接地させる。耳は左右それぞれの
向きから後ろ・外側へ倒す。尾は低く身体へ寄せ、先端だけ小さく動かす。
移動や飛びかかりは足さず、被弾後に相手へ警告する意味を保つ。

Runは旧版の対角脚ペアのトロットから、前脚→後脚へ支持が移る非対称の
ギャロップへ変更。前後脚の左右に小さな着地差を設け、腰・背骨・胸郭を
連動させる。足先を回収するときは手根／足根をたたむ。
基準速度・一周期・関節角度は、この長毛の体型に合わせた手付けであり、
実猫から抽出したモーションキャプチャではない。

## 最終GLBの検証

採用revision 08、SHA-256
`19e44d1e02c501bc10cc02929383e55a0f6ee9f31e1b5ec76c42686c606dcfb1`。
既存のTRELLIS形状・材質・リグ・ウェイト・他5動作はbyte-identical。
2動作を240Hzで焼き込み、書き出したGLBを480Hz（コマ間を含む）で再計測した。
旧5動作は120Hz、計2,057姿勢・全頂点。最小Yは+0.232mm、走行の接地中水平ずれは
0.0688mm以下、ループ端の最大差0.0000811mm。
これは基準の平面上の値で、すべてのゲーム地形を同じ精度で保証するものではない。

`qa/rig-08/motion-frames/` の42画像は実GLBをBlenderへ再読込した固定縮尺の連続コマ。
`qa/rig-08/motion-browser/` は実GLB内蔵のブラウザープレビューを5方向、通常／低速で
再生した70録画。録画対象は実際に表示されたcanvas、要求30fps。
Googleで見た参考写真・動画の転載やダウンロードはしていない。

Runの1周期0.5秒・基準2.0m/sは作画値。前左0、前右0.0667、後右0.5、後左0.5667で
接地し、各脚の接地比は0.2333。0.30〜0.50と0.80〜1.00に支持脚のない局面を置く。
Hissは2.1秒。0.22秒で低く構え、1.70秒以降0.40秒で緩める。
骨の高さは待機比で腰0.105m、胸0.0976m、頭0.1376m低下。
毛の物理・細かな表情筋・全メッシュ間の自己交差の完全証明は対象外。

実ゲームでもChrome2画面と通信3人、17検査群を通過。実入力の走行追従・旋回・減速、
橋・緩い坂への接地、被弾後の威嚇、7人物の撫で、再接続、縦横画面を確認した。
証拠: `output/playwright/rimo-neko/game-motion-r08-c/`。
