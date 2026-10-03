# りもねこの撫で終わりの仕草とハート

2026-09-30。撫で完了後に524と同じピンクのハートを5つ出し、足を固定したまま
しっぽを上げ、首をこてんと傾ける1.6秒の仕草を追加。その後に追従する。
制作・動作・制約は `assets/rimo-neko/README.md`、採用状態は同 `adoption.json`。

## 検証した配布物

- フォルダー／ZIP: `output/exhibition-20260930-rimo-happy-r01` / 同名 `.zip`
- Build ID: `578c1f6aa78af69790b741737e3182f68c690b0d21452c87d89fa2abe72be95b`
- ZIP SHA-256: `1386d4b3b43b5943687e739d2150dfc2150f6f6a7197308bc116d7819d7cde66`
- ZIP: 405,799,464 bytes。423ファイル、81 GLB、展開約563.9 MiB。
- 猫: Candidate 1 / rig r10、26,147,952 bytes、136,745三角形、29骨、7動作。
  SHA `545900f93a483fb1b9cb7483c4fa79a97c3b40d107054e6ef4cadd34fe12205b`。
  r08の形状・画像・リグ・ウェイト・Happy以外の6動作を完全保持した。
- Howkeyを含む既存8人物と既存の内容を含む。

全616テスト、型・strict、391JS構文、依存境界、48素材の検証が成功。
同梱Nodeの起動4項目が成功し、実際の配布物を実Chrome2画面＋通信3人で確認した。
19検査群には8人物の撫でとハート、追従・走行・旋回、橋と坂、帰還、被弾・威嚇、
中断、再読込、縦横画面と、追加のリアクション寿命12項目を含む。ブラウザーエラー0。
5接続は保存しない検査部屋での検証であり、実展示PCや物理コントローラーの検証ではない。

証拠:

- `output/playwright/rimo-neko/game-happy-r10-b/`
- `output/exhibition-20260930-rimo-happy-r01-launch-qa.json`
- `output/rimo-happy-all-tests.log`、`output/rimo-happy-assets.log`
- `output/model-generation/models/rimo-neko/qa/rig-10/`

## 配置状態

| 機体 | 状態 |
| --- | --- |
| PC0 | Publicの`releases/exhibition-20260930-rimo-happy-r01`へ予備配置。423ファイル・81GLB・ビルドIDを全照合。選択版と稼働を保持。 |
| PC1／PC2 | 直前の接続失敗後の再接続は行っていない。今回の版は未配布・未切替。 |
| PC3 | 既存の未配布指定を継続。接続していない。 |

PC0は標準の`exhibition-station.ps1 -Action Install`だけを実行した。
`runningUnchanged: true`、`station.json`と`running.json`の前後SHA一致を確認。
記録は `output/exhibition-20260930-rimo-happy-r01-pc0-install.json` と
`output/exhibition-20260930-rimo-happy-r01-pc0-state-preserved.json`。
通常3000番の手動起動・再起動、ユーザー保存変更、遠隔UAC、公開デプロイは行っていない。
今回の変更は未コミット・未push。直前の3機能別コミットは既にmainへpush済み。

## 制作物の保存

`../threed-model-creation/models/rimo-neko/`へ、r09の試作とr10の最終版、
Blender、生成処理、モデルQA、ゲームQAを保存。計1,155ファイル・1,917,833,830 bytes。
コピーと全ファイルSHAを記録した `assets/rimo-neko/archive.json` を保持する。
既存Candidate 1の `qa/candidate-1/viewer.html` をr10に更新し、以前の表示用ファイルは
`qa/presentation-history/before-happy-r10/`へ保存した。候補番号は増やしていない。
プレビューは猫の骨格動作を表示する。ハートを含む実ゲームの動画は
`output/playwright/rimo-neko/game-happy-r10-b/howkey-scientist.webm`。

物理コントローラー、実展示画面、長時間稼働、全表面組の自己交差は未検証。
