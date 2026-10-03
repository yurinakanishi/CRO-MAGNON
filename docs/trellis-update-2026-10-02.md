# TRELLIS実行環境をこのPCでv0.8.1へ更新（2026-10-02）

ユーザーの「trellis2 update来ていたら、updateして」に対応した。
公式の最新安定版は [pwilkin/trellis.cpp v0.8.1](https://github.com/pwilkin/trellis.cpp/releases/tag/v0.8.1)（2026-09-25公開）。GitHubのlatestページとAPIの両方で確認した。

過去の9月27日の文書にはv0.8.1へ更新した記録があるが、今回のPCでは
`trellis-studio.exe` の実際のProductVersionは **0.6.0**、`installed-release.json` は存在しなかった。
文書だけで更新済みとは判断せず、実ファイルを記録して **Studio 0.8.1と同リリースのWindows CUDA runtime** へ更新した。
旧CLIのSHAは `e3d075612388a42fcb9bea73377feac4149e3a463cff2d2e11b24975e85d427d`。

## 適用先と保全

- 設置先: `C:/Users/yurin/Desktop/projects/threed-model-creation/trellis-studio/`
- バックアップ: 同フォルダーの `backups/before-v0.8.1-20261002-183908/`
- runtime内の9ファイルとStudio・README・portable markerの計12ファイルを、バックアップSHA照合後に更新した。
- 既存10個のGGUF（計16,467,590,304 bytes）は更新前後のSHAが全一致。再ダウンロードしていない。
- 設定・生成済み素材・既存のモデル候補・ソースcheckoutは変更していない。更新前にTRELLISプロセスが動いていないことを確認した。
- CUDA archive SHA: `d2ea7b57174d3bff438064faf0b5fbcc55c29c31e6bba5f41030936fa366ed48`
- Studio archive SHA: `f27d9fbb1dc3d3218625c61756b8089b652a66dada98af79a62d8f5639846b72`

両archiveは公式GitHub APIのdigestと一致。配置後の12ファイルも展開元と一致した。
同じ設置先を使う既存の制作スクリプトは、次回からこのruntimeを実行する。

## 実行確認

| 確認                  | 結果                                                               |
| --------------------- | ------------------------------------------------------------------ |
| Studioの実ファイル    | FileVersion / ProductVersionとも0.8.1                              |
| 設置先CLI `--help`    | 終了0                                                              |
| 更新後CLI SHA         | `6c0da69fbb1f4e853082bc5292a1099d501d42b61604362468fb85badf2790b0` |
| 実際のGPU             | NVIDIA GeForce RTX 3070 Laptop GPU、8GB、driver 610.60             |
| CUDA BiRefNet背景除去 | 既存重みとりもねこ元画像で成功、17.628秒、434×434 PNG              |
| CPU fallback          | `--require-gpu` を指定し、CUDA device 0の使用をログで確認          |
| 設置先server          | localhost一時ポートで起動し、`/health` が `ok`                     |
| 検査用server          | この検査が開始したプロセスだけを終了済み                           |

今回の動作確認はCLI・CUDA背景除去・server healthまで。新しい3D候補の生成、完全なimage-to-3D再実行、Studio GUIの操作確認は行っていない。
v0.8.1の任意のquad retopology helperは公式の配布済みruntimeには含まれず、この更新で導入済みとは扱わない。[公式説明](https://github.com/pwilkin/trellis.cpp/releases/tag/v0.8.1)

## 本体側の確認

[Microsoft/TRELLIS.2](https://github.com/microsoft/TRELLIS.2) のmain先頭は、今回も
`75fbf0183001ed9876c8dbb35de6b68552ee08bd`（2026-06-05）で、9月27日の記録から変化していなかった。
このPCが使用する軽量C++実行環境の更新と、MicrosoftのPython本体の更新を区別した。
Context7も調べたがTRELLIS.2 / trellis.cppの該当版は見つからず、別のTRELLISライブラリを代用せずに公式のリリース・固定タグのREADMEを使用した。

## 記録

`output/trellis-update-20261002/` に公式リリースJSON、Microsoft本体の先頭情報、更新前22ファイルのSHA、archive、展開物、installation / verification JSON、CLI help、CUDA / serverログを保持。
設置先にも `installed-release.json` と `update-verification-20261002.json` を保存した。

- 更新処理: `scripts/update-trellis-runtime-20261002.ps1`
- 実行検査: `scripts/verify-trellis-runtime-20261002.mjs`

公開デプロイ、ゲームのサーバー再起動、ユーザー保存変更、commit/pushは行っていない。
