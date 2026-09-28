# TRELLIS実行環境の更新 — 2026-09-27

ユーザーの指示により、リモねこの3D復元を始める前に既存の実行環境を更新した。

- 配布元: https://github.com/pwilkin/trellis.cpp/releases/tag/v0.8.1 （2026-09-25公開）
- Studio v0.6.0 → v0.8.1。Windows x64 CUDA runtimeのCLI／server／DLLも同じ公式リリースへ更新。
- 設置先: `../threed-model-creation/trellis-studio/`
- 旧版: `../threed-model-creation/trellis-studio/backups/before-v0.8.1-20260927-230836/`
- 元の制作物、設定・data、10個のGGUF、ソースcheckoutは保持。
- CUDA archive SHA-256: `d2ea7b57174d3bff438064faf0b5fbcc55c29c31e6bba5f41030936fa366ed48`
- Studio archive SHA-256: `f27d9fbb1dc3d3218625c61756b8089b652a66dada98af79a62d8f5639846b72`

公式GitHub APIのdigestと両archiveを照合し、旧runtimeの全ファイルのバックアップ一致、配置後の全9runtimeファイルとStudioの一致を確認した。RTX A1000 6GBのCUDA認識と既存BiRefNet重みによる背景除去が成功（19.5秒）。配置先からのCLI `--help` は終了0、検査用serverの `/health` は `ok`。検査用serverは終了済み。

証拠: `output/trellis-update-20260927/{release.json,installation.json,verification.json,smoke/cuda-birefnet.log}`。配置先にも `installed-release.json` を保存。

更新後、リモねこの1024生成を同じGPU・既存重みで完了した（約18分）。高密度GLB、ログ、実行コマンド、参照・出力SHAを `output/model-generation/models/rimo-neko/work/trellis/` に保持。ゲーム用リグの制作と検証は `assets/rimo-neko/README.md`。

v0.8系にはPixal3D対応と1024生成のメモリ削減が含まれる。今回の制作は従来のTRELLIS-2重みを継続する。公式バイナリには任意のquad retopology helperが含まれないため、更新だけでその機能を検証済みとはしない。Microsoft/TRELLIS.2本体のmain先頭はAPI確認時点で2026-06-05の `75fbf0183001ed9876c8dbb35de6b68552ee08bd`。
