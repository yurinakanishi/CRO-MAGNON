# ゲームの不具合・性能改善

参照：[Building games with Astra](https://developers.openai.com/blog/how-to-build-games-with-astra)（OpenAI Developers、2026-09-14確認）。

記事から採用するのは、体験から要件を決め、再現場面・状態の観測・実操作を使い、同じ条件で改善を測る進め方である。以下はCRO-MAGNON向けの実施方針。

## 開発と検証の方針

- 症状を再現し、原因と期待する挙動を記録してから修正する。画面だけでなく、位置・接続・読み込み状態も照合する。
- 準備用の座標設定と実操作による検証を区別する。参加→移動→操作→再読込の流れを実ブラウザーでも確認する。
- 性能はフレーム間隔の中央値・p95、CPU処理時間、draw call・三角形・geometry・texture数、読み込み待ちを必要に応じて記録する。環境・画面サイズ・人数・準備時間を揃える。
- CPUの局所ベンチマーク、ブラウザーのフレーム時間、GPU実行時間を混同しない。改善率は実測した対象に限定する。
- 読み込みの重複・破棄後の完了・不要な再計算・解放漏れを先に調べる。表示と衝突が食い違う変更を避ける。
- 既存のTypeScript、Three.js、共有ドメインと描画の分離を使う。別レンダラー・物理エンジン・生成方式の導入は実測上必要な場合に検討する。
- 変更に応じた回帰テスト、全体テスト、型・構文・依存境界・書式を確認する。残る問題と未検証の条件も残す。

## 今回の対象（2026-09-14）

1. 描画ループ、素材の非同期読み込みと破棄、通常操作の不具合を調査する。
2. 再現できる問題を修正し、意味のある回帰検査を追加する。
3. 同じ場面で負荷を測り、実ブラウザーで動作と外観を確認する。
4. 結果・再現コマンド・計測条件を本書と `docs/performance.md` に記録する。

モデル制作は引き続き `ASSET_WORKFLOW.md`、モーションは `CREATURE_MOTION_GUIDE.md` に従う。検証には専用部屋または専用サーバーを使う。

## 結果

### 修正内容

- **徒歩の視界**：通行可能な `(76, 68)` でカメラが木の葉に入り、画面全体が緑に覆われた。`src/world3d.ts` が騎乗者だけに渡していた視線の終点を徒歩でも渡し、既存の植生処理でその視線を遮る木だけを省く。木の当たり判定・GLB・他の参加者の視界は変えない。
- **読み込み終了**：`src/world-assets.ts` の未開始の地域読み込みを、通信完了を待たず終了時に拒否する。最初の3本の読込処理も終了後は残りのモデル・LODへ進まず、破棄済みの管理オブジェクトから敵や装備を新しく読み込まない。進行中の通信を強制中断する変更ではなく、遅れて完成した素材は解放する。
- **共有資源の寿命**：LOD間で共有するtexture・geometry・materialをまとめて一度だけ解放し、複数textureが共有するImageBitmapも一度だけ閉じる。オンデマンド素材に地域材質が付く場合の古いキャッシュも破棄する（この組み合わせは模擬素材で検査）。
- **地形と海の負荷**：カメラが静止し、区画に変更がない間は配置・海岸属性の再計算と転送を省く。区画追加・削除・遅延読込は即時に更新を再開する。海の時間、未使用素材の12秒後の解放、読込要求は継続する。`#world.dataset` に `terrainUpdates`／`terrainUploadBytes` を追加した。

### 検証と結果

- 修正前の全587テスト合格。今回の新規11件を加えた全598テスト合格。実資源の解放、待機中の終了、遅延読込、海の時間、キャッシュ更新、徒歩の視線を検査した。
- TypeScript（strict含む）、318JSの構文、依存境界、変更コードのPrettier、差分の空白検査が合格。
- `scripts/benchmark-terrain.mjs` は実ワールドの区画・海岸データと軽量な描画バッファで計測。300回・7試行の中央値は静止中CPU 6.88→2.23ms、転送要求357,600→1,192 bytes（99.7%減）。180視点で区画・地形・海の配置行列と海岸属性が一致。移動中のCPU速度向上は確認していない。
- 実Chrome、RTX 3070 Laptop、1280×800、1画面の180フレーム間隔で中央値は前後とも16.7ms。p95は17.5→17.3msの単回観測で、FPS向上の根拠とはしない。視界を直したため、比較画面の木の描画数は意図的に異なる。
- 実時間の歩行・攻撃、雪原の準備場面と帰還、2描画画面＋通信3人の同期、再読込時のID・位置・持ち物の保持、390×844／844×390の持ち物と地図を確認。ブラウザーエラー0。開始座標・雪原への移動だけは場面準備で設定しており、そこまで歩いた検査ではない。
- 通常3000番で変更した5つのJSのSHAがビルド結果と一致。画面を再読み込みすると反映される。
- 素材の総合検証は `output/model-generation/models/neanderthal-hunter/source/original/reference-v1.png` の欠落で停止。この環境では計34件の制作参照パスが存在しない。検証条件は緩めず、配信対象41モデル・LOD込み56GLBのバイト数・SHA・構造・三角形数を独立に照合し全件合格した（[配信素材検査](docs/astra-delivered-assets.json)）。制作来歴と旧アーカイブまでを含む総合検証の合格は主張しない。

数値と環境は [計測JSON](docs/astra-performance-measurements.json)、画像と全フレーム記録は `output/playwright/astra-improvements/`、検査ログは `output/astra-improvements/`。モデルの新規制作・差し替え、公開デプロイ、展示／PC2の更新、コミットは行っていない。実機スマートフォン、物理コントローラー、長時間負荷、全ての不具合の解消は未確認。

### 再実行

```sh
npm run build
node --test --test-concurrency=4 tests/*.test.mjs
node scripts/benchmark-terrain.mjs
node scripts/qa-astra-improvements.mjs current
npm run check
npm run verify:assets
```

この環境の `npm` ランチャーは、存在しないユーザーディレクトリの `npm-cli.js` を参照していた。今回は同じ検査スクリプトを `node scripts/build.mjs --check`、`node scripts/check-syntax.mjs`、`node scripts/check-architecture.mjs`、`node scripts/verify-world-assets.mjs` で直接起動した。最後の素材総合検証の制限は上記のとおり。

旧版と比較する場合、同じ相対importが解決できる `dist/src/open-world.astra-baseline.js` をベンチマークの第2引数に渡す。今回の元コミットは `ddbc04b3d87dd680dc1dd1ddf6a85905bf71f5c6`。ブラウザーの `baseline` 引数は `output/astra-improvements/baseline/` に保存した変更前の `open-world.js`・`world-assets.js`・`world3d.js` を使う。
