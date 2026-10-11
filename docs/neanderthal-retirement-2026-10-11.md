# ネアンデルタール人を除外し、再導入できる状態で保管

2026-10-11。ユーザー指定は、男女と交易用ネアンデルタール人を容量削減のために除外し、データを残してすぐ再導入できるようにすること。

## 現在の設定

`shared/character-roster.mts` の `CHARACTER_ROSTER` にある `species: 'nea'` の `enabled` を `false` にした。一つの設定が以下に適用される。

- 開始時・ゲーム中の人物選択、サーバーの参加と人物変更。通常のローカル設定／公開MMOの選択肢は5種類。
- `WorldRenderer` の人物プロバイダーと `WorldAssets` のカタログ。男女のモデルを準備・要求しない。
- 交易NPCオルの状態配信・描画・名前・地図マーク・当たり判定。近くの交易操作と4キーも無効。古いクライアントからの交易要求もサーバーが拒否する。
- Node配信のカタログと直接URL。男女のGLB・肖像・メタデータは404。大文字・エンコード・経路正規化後のURLにも適用。
- `scripts/delivery/prepare-overlay.mjs` の変換対象と `scripts/cloudflare-public-build.mjs` の公開ファイル。公開版の肖像CSSも除外。

オルがいた場所の焚き火・周辺景観は維持し、ワープ先の名前は「谷の集落」とした。集落の住人データは元から無効化済みの地域に属し、今回も生成されない。歴史の説明文や過去の制作記録は保存する。

## 保管場所と保存データ

元のファイルを移動・削除・加工していない。

- `public/models/neanderthal-woman/`、`public/models/neanderthal-hunter/`：採用モデル、肖像、リグ／動作を含むGLB、メタデータと保管済みrevision。
- `assets/neanderthal-woman/`、`assets/neanderthal-hunter/`、`assets/face-remake/` と `output/model-generation/` など：既存の画像・制作物・QA記録。
- `shared/character-profiles.mts`：男女のプロフィール定義。`shared/world.mts` の `RETAINED_TRADER`：オルの元の定義。交易処理も条件付きで保持。

以前の人物が `nea` なら、現在の姿は同じ性別のクロマニョン人になり、元の種族・性別は非公開の `unavailableCharacter` に残る。ID・持ち物・進行は維持する。再導入すれば元の外見へ戻り、除外中にユーザーが別の人物を明示的に選んだ場合は新しい選択を優先する。公開Workerはブラウザーに渡す選択肢と別に、保存復元に必要な人物定義を保持する。ユーザーの `.cro-magnon-save/` は開いていない。

現行マスターGLBの合計は **12,407,808 bytes（11.83 MiB）**。オルは男性モデルを共用しているので3体分として重複計上しない。これは除外した元GLBのサイズで、配信用圧縮後の前後差・通信量やFPSの改善値ではない。

| モデル | ファイル | bytes | SHA-256 |
| --- | --- | ---: | --- |
| 女性 | `model-face-lp-r08.glb` | 4,859,144 | `343c7ae31d2c39ba13cb69a69e6fc5d6b2095055872a43bd085db9bf28b0e52a` |
| 男性・オル | `model-face-lp-r08.glb` | 7,548,664 | `c5c93e0298d70f684fd274aef29bf655a89733d1d0b23bb0341ceb534d4c6ed6` |

## 再導入

ユーザーから再導入の依頼を受けたら、`shared/character-roster.mts` の `nea` の `enabled` を `true` にして `npm run build`。GLBの再生成や移動は不要。開始時・ゲーム中の選択肢、NPC、当たり判定、交易、元の焚き火名、配信対象が同時に戻る。

稼働プロセスは設定を起動時に読むため、次の許可された起動・反映でサーバーとブラウザーの版をそろえる。配信用変換を使う場合は通常の起動／cook手順で対象を再生成する。公開版は通常のビルドと検証後、明示された公開作業で反映する。保存を手で書き換えたり古いチェックポイントを再適用したりする必要はない。

## 検証

- 関連11ファイル・91テスト合格：選択・切り替え・5人同期・保存復帰・交易拒否・配信URL・当たり判定・描画の読み込み。最初はWindowsサンドボックスのloopback拒否／一時保存rename拒否で18件失敗し、同じテストを許可された実行環境で再検証して失敗0。テストの保存復帰はメモリーまたは専用一時フォルダーのみ。
- `npm run check` 合格：型・strict・613 JS構文・依存境界。変更した整形対象はPrettier、全差分は `git diff --check` 合格。
- `scripts/qa-neanderthal-retirement.mjs`：実Chrome 1440×900、390×844の画面幅確認、ブラウザー1人＋WebSocket4人。タイトルから実操作で入場し、5種類の選択、旧設定の受け入れ、元の交易場所にNPC／ラベル／行動がないこと、実キー移動、ゲーム中の人物選択を確認。男女のモデル／肖像への通信0、ブラウザーエラー0。元の交易場所への配置だけは隔離世界の準備用状態設定。
- `node scripts/build-cloudflare.mjs --exact-assets --output-root=output/neanderthal-retirement-20261011/mmo-final` 合格：既存配信先を差し替えない隔離ビルド。591ファイル、120,895,167 bytes、79 GLB、分割0。build ID `d6fba2c7f222de122f0bd6d0f6daeb74c1dd1e124cf013fb380a70d6175581bd`。公開済みの版ではない。
- `scripts/verify-neanderthal-release.mjs`：生成された公開ファイル一覧・カタログ・選択肢・肖像CSSからの除外と、元GLBのSHA一致を確認。生成されたWorkerを実際に読み、5人の旧人物参加、NPC不在、保存された外見の再有効化による復元を検証。

証跡は `output/playwright/neanderthal-retirement-20261011/final/` と `output/neanderthal-retirement-20261011/mmo-final/`。最終Chrome QAでは旧4キーを押しても交易コマンドが送られないことまで合格。実スマートフォン・物理コントローラーは未検証。既存サーバーの停止・再起動・公開デプロイ・展示ビルド／配布は実行していない。
