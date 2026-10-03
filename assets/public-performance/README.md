# 公開配信用の軽量素材

原本は `public/models` に保持する。このディレクトリーはCloudflare公開ビルドだけが採用する派生物で、ローカル配信の元画像を置換しない。

`manifest.json` は原本・派生物のSHA-256とバイト数、元URL、画像寸法を記録する。公開GLBのURLには内容のSHAを付ける。原本が変更されている場合、公開ビルドは古い派生物を拒否する。

画像は `scripts/optimize-public-glb.py` のPillow Lanczosで主に1024pxへ縮小する。人物とりもねこは2048pxを保持する。猫の1024px版はUV境界の色にじみがあったため不採用とし、旧生成物と比較画像を残した。PNGのアルファ、頂点・UV・材質・骨・動作・すべての非画像bufferViewは保持する。

524と猫の新LODは元GLBに `scripts/build-performance-lods.py` を適用したもの。Blender 5.2、削減率は524が0.08、猫が0.16。元の骨の順序とスキン属性を照合し、実行時は元モデルの骨・材質・クリップを共用する。採用LODは `public/models/{yellow-524-mascot,rimo-neko}/lod-low-spec-r01.glb`。

再生成は `scripts/prepare-public-performance.mjs`、完全性検査は `scripts/verify-public-performance.mjs`。生成用Pythonは `PERFORMANCE_PYTHON` で指定できる。最初の生成LOD・ログは `output/low-spec-20261002`、実Chromeの比較と全頂点の姿勢検査は `output/playwright/low-spec/models-r01` ～ `models-r03` に保存している。

`verification.json` は採用101 GLBのSHAと14,150個の非画像bufferViewの完全一致を確認した結果。元モデルの画像や幾何を上書きしていない。設定 `cloudflare/public-release.json` の `optimizedAssets:false` で公開素材を元画像へ戻せる。クレジットと人物の公開可否は別の設定で保持する。

実装・測定・公開の記録は `docs/low-spec-public-2026-10-02.md` を参照。
