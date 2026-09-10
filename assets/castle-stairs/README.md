# 城の中央階段の上がり口

2026-09-10。大猿が階段上から左右へ抜けられない問題を修正した。

元の城の床を80cm分多く残し、体の半径0.76mを維持して通路を接続。revision08を実GLB・実Chromeの往復で検証して採用。旧モデル・素材・制作履歴は保持。

- `adoption-review.json`: 外観の採用判断とSHA。
- `revision-08-inspection.json`: 独立した最終GLB構造検査。
- `stairs-mesh-verification.json`: 材質・画像の一致、20セルの差分、480本の床レイ検査。
- `game-qa.json`: 実Chrome2画面＋通信3人、移動と準備値の区別。
- `normal-delivery.json`: 通常サーバーの再起動後、自動保存と5配信ファイルの照合。

詳細・検証の制約・再現手順は `../../CASTLE_STAIRS_FIX.md`。
