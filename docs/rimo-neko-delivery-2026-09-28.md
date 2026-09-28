# リモねこのローカル実装と展示配布

2026-09-28。制作・ゲーム挙動・検査は `assets/rimo-neko/README.md`。
TRELLIS更新記録は `docs/trellis-update-2026-09-27.md`。

## 現在の検証済み配布物: 低い威嚇・ギャロップへの修正版

- フォルダー／ZIP: `output/exhibition-20260928-rimo-r02` / 同名 `.zip`
- Build ID: `f9a692448a7ee7e86e2080c859cc156b6e6245a61f3b361fb1bbc2b9504cee68`
- ZIP SHA-256: `f795e756f9938f6f12410cc4e78da98c60944135541485adbbb62de036aa6fbd`
- ZIP: 380,530,895 bytes。418ファイル、79 GLB、展開約534.3 MiB。
- 猫GLB r08 SHA: `19e44d1e02c501bc10cc02929383e55a0f6ee9f31e1b5ec76c42686c606dcfb1`。
- 修正版の全605テストと素材検証、実Chrome2画面＋通信3人の17検査群が成功。
  ゲーム検査は `output/playwright/rimo-neko/game-motion-r08-c/`。
- 同梱Nodeの起動4項目が成功。`output/exhibition-20260928-rimo-r02-launch-qa.json`。
- PC0へ予備配置して418ファイル・79 GLBを全SHA照合。
  `output/exhibition-20260928-rimo-r02-pc0-install.json` の `runningUnchanged: true` を確認。
- PC1/PC2は直前の接続失敗を継続扱いとし、この修正では再接続を行っていない。
  r02は未配布・未切替。PC3の未配布指定も継続。

現在のモデルライブラリはCandidate 1 / r08。786ファイル、1,500,362,959 bytesを
照合して旧版・試作・検証を保存。全SHA一覧は`assets/rimo-neko/archive.json`。
プレビュー `../threed-model-creation/models/rimo-neko/qa/candidate-1/viewer.html` は
同じGLBを内蔵し、通常・1/2・1/4速度に対応する。開いたままの旧表示は再読み込みで反映。

## 初回r01の配布履歴

- フォルダー／ZIP: `output/exhibition-20260928-rimo-r01` / 同名 `.zip`
- Build ID: `79fc52bf3e9afb9122f391cdc9ffa0bb43187f231f63c833acdecdce666c1e1b`
- ZIP SHA-256: `95d7b5dd034ffb55641c5892d8d8ff88ca0ed9af919fb21085df3b387e8a67cd`
- 418ファイル、79 GLB、約533.6 MiB。
- 同梱Nodeの起動4項目が成功。`output/exhibition-20260928-rimo-launch-qa.json`。
- この配布物を実Chrome2画面＋通信3人で検査。PS4／Switch Pro表記、メニュー、食事、人物変更、6地点ワープ、縦横画面、再読込の14検査群が成功。`output/playwright/exhibition-menu-1790522445035/`。

## 初回r01時点の各機の状態

| 機体 | 今回の状態 |
| --- | --- |
| PC0 | `C:/Users/Public/CRO-MAGNON/releases/exhibition-20260928-rimo-r01` に予備配置。418ファイル・79 GLBを全SHA照合。選択中の版と稼働プロセスは保持。 |
| PC1 | TCP22がタイムアウトし、未配布・未切替。 |
| PC2 | TCP22がタイムアウトし、未配布・未切替。 |
| PC3 | 既存の未配布指定を継続。接続していない。 |

PC0の配置は `exhibition-station.ps1 -Action Install` で実施し、`runningUnchanged: true` を確認。
記録: `output/exhibition-20260928-rimo-pc0-install.json`。
接続状態: `output/exhibition-fleet/20260928-001648-status-fbd5efb2f6bb48d8a798485ede1521ba.json`。
標準ユーザーの処理だけで行い、遠隔UAC、自動昇格、公開サイトへのデプロイはしていない。

接続復旧後は現在のr02 ZIPを使用する。配布スクリプトは全対象の照合後に停止・選択・起動を行うため、展示の区切りで実行する。

```powershell
./scripts/exhibition-fleet.ps1 -Action Deploy `
  -Machines PC0,PC1,PC2 `
  -ReleaseName exhibition-20260928-rimo-r02 `
  -ZipFile output/exhibition-20260928-rimo-r02.zip
```

通常のローカル3000番も読み取り確認時に接続拒否だったため、現行サーバーへの配信SHAと保存状態は未確認。手動起動・再起動、既存保存の書き換えは行っていない。ゲーム操作検査は独立した保存なしの世界で完了している。
モデル単体は `../threed-model-creation/models/rimo-neko/qa/candidate-1/viewer.html` で確認できる。
