# 歩行・走行のかくつき修正

2026-09-09。原因と反映状態は [MOVEMENT_SMOOTHING_PLAN.md](../../MOVEMENT_SMOOTHING_PLAN.md)。

## 再現と検査

1. `node scripts/build.mjs`
2. `node --test tests/movement-smoothing.test.mjs tests/exhibition-lan.test.mjs tests/character-animation.test.mjs tests/creature-motion.test.mjs tests/manual-movement.test.mjs tests/jumping.test.mjs tests/boat-renderer.test.mjs`（関連38件通過）
3. `node scripts/qa-movement-smoothing-host.mjs`（3023番、独立したメモリー上の世界）
4. `node scripts/qa-movement-smoothing.mjs after cro`、`after bear`、`after ape`

Playwrightはこの端末に既設のバンドルを使用する。他の環境では `PLAYWRIGHT_MODULE` に既存モジュールへのパスを指定する。CLIの取得はネットワーク制限により使用できなかったため、プロジェクトの既存QAと同じPlaywrightライブラリを使った。

修正前の計測は `output/movement-smoothing/before/` に保存した元ソースを `before` 指定で読み込む。これは比較専用で、配信中のパッケージを書き換えない。

## 証拠

- `output/playwright/movement-smoothing/before-cro/` と `after-cro/`: 人間の動画・フレーム・画面。
- `output/playwright/movement-smoothing/before-bear/` と `after-bear/`: 魔法使いの同条件比較。停止区間は複数あるため、bear以降は各区間の先頭400msを除いて集計した。初回croの停止集計には次の停止区間の過渡フレームが含まれ、定常停止の数値として扱わない。
- `output/playwright/movement-smoothing/after-ape/`: 大猿の動画・フレーム・画面。全テストと並行した負荷を含む。
- `output/movement-smoothing/tests.txt`: 全419テスト通過。
- `output/movement-smoothing/package.json`: 修正前後のパッケージIDと変更2ファイルのSHA-256。

全ブラウザー検査のプロフィールは準備値。キー移動・停止・ジャンプ・攻撃は通常入力で、時計・ワールド位置・材料を設定していない。動画出力とレンダラー観測はQA用。ブラウザーエラー0、歩行／走行中のモデル非表示0、修正後の定常移動中に混ざる待機0。

影は毎フレーム更新する。前の姿勢の影を再利用するちらつきは防げるが、光源を含む全シーンのGPU負荷をなくす修正ではない。常時60FPS、物理PC2・物理Gamepad・長時間負荷・全地形は未検証。

## 提供物と現在のゲーム

`output/exhibition-motion-r01` は現在の展示版からクライアントの2ファイルだけを替えた検証済み候補。モデルとサーバー等の291ファイルは元と同じ。`scripts/package-movement-smoothing.mjs` が元版を照合し、新しい空のフォルダーに作成する。

稼働中の4173番への切替は自動承認審査により拒否され、実行されていない。ユーザーの明示的な許可が必要。復元確認に使った私的なスナップショットはGit対象外・非配信の `output/movement-smoothing/` に保存され、再適用していない。許可後の切替にはその直前の状態を新しく保存する。PC2は今回の対象外。

## push時の統合確認

先行する `e134097` のDowned追加を保持して統合。`world3d.ts` はDowned・ジャンプの優先順位を残し、通常移動だけ修正済みの速度を使う。両方のAGENTS記録を保持した。分離ビルドで型・strictを含むビルドと関連45テストが成功。初回の分離コピーには `exhibition.env` が欠けていたため補完して45件を再確認した。稼働中サーバーと通常distは変更していない。

既存の `exhibition-motion-r01` は統合前の検証済み候補として保持する。Downed等の新しいアニメーションAPIを含む現在のソースから古い展示版へ2ファイルだけをコピーすることはできないため、専用パッケージ補助はその不一致を拒否する。統合後の機能をすべて含める場合は通常の完全な展示ビルドを作成する。

続いて先行した `890e397` の衝突時の向き修正も保持。共有移動の入力方向と、描画での `facing` 追従を統合し、分離ビルドと衝突を含む関連50テストが通過した。
