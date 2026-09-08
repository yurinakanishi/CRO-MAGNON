# 描画負荷の改善（2026-09-08）

静止中の植生の再計算と、未使用領域のGPU転送要求を削減した。地形・海にも部分転送を適用し、人物・動物のラベルと地図見出しの不要なDOM更新を抑えた。解像度、GLB、LOD距離、表示範囲、アニメーション速度、衝突ルールは維持する。

## 計測

`scripts/benchmark-vegetation.mjs` は実ワールドの木・草・岩の配置で、300回の更新を7回実行し中央値を比較する。描画先はテクスチャなしの行列バッファであり、CPUの配置計算と転送要求量の検査である。GPU実行時間やゲーム全体のFPSの測定ではない。

| 測定項目（300回） | 変更前 | 変更後 |
| --- | ---: | ---: |
| 停止中の植生更新CPU時間 | 338.4 ms | 4.8 ms |
| 停止中の配置再計算回数（3種類合計） | 900 | 3 |
| 移動中の行列転送要求 | 899,424,000 bytes | 7,803,776 bytes |

移動中の転送要求量は約99.1%減。初回のGPUバッファ確保ではThree.jsが全容量を送るため、この数字は初期ロードの改善率を示さない。停止中のCPU時間は再計測でも大幅に減少したが、絶対時間は端末・他の処理・JIT・GCで変動する。移動中のCPU計算自体の高速化は主張しない。

実ブラウザーはWindowsのCodex内ブラウザー1画面、キャンバス1035×618、人物1人、専用ポート3112・部屋PERF-QA。開始地点の観測FPSは変更前後とも60で、FPS上昇は確認していない。停止中は植生更新カウンターが5、転送要求累計が19,904 bytesで止まり、ズームすると更新が再開した。元から60 FPSに達していた場所の余分な処理を減らした結果である。

生の比較値とブラウザー観測値は [performance-measurements.json](performance-measurements.json) に保存する。

## 実装と検証

- `src/view-update-gate.ts`: カメラの位置・回転・投影行列と騎乗時の視線を記録。既存の0.18秒間隔を保持し、変化がない静的な植生配置の更新を省く。比較は最後に採用した視点を基準とするので、微小な移動も蓄積すれば更新する。配置はLandscapeInstancesの存続中に不変である前提。
- `src/instance-updates.ts`: 完全に書き直した有効範囲のみを転送する。インスタンスが0件なら新たな転送を要求しない。GLBや共有geometry、textureの複製は追加しない。
- 変更前のモジュールとの120視点の比較で、可視インスタンス数と配置行列が完全一致。移動・回転・ズーム・騎乗の視線・遠征を含む。
- Three.jsの実際のWebGLAttributes実装を使い、増加・減少・0件からの復帰時の部分転送をテスト。
- 全202テスト通過。TypeScriptビルド、アーキテクチャ境界、JS構文、整形、差分の空白チェックも実施。
- 実画面で再接続、ズーム、焚き火までの歩行、自由攻撃、地図、雪原への遠征と草原への帰還を確認。ブラウザーのerror/warnログ0件。

実機スマートフォン、5人での実描画、長時間稼働、常時60 FPSは今回の検証対象外。公開版へのデプロイは行っていない。

## 再計測

```sh
npm run build
node scripts/benchmark-vegetation.mjs
node --test tests/render-performance.test.mjs
```

旧版のコンパイル済み`world-assets.js`を、相対importが解決できる場所に保存しておけば、第2引数で比較できる。今回の旧版はコミット`ff34e6ff3b5f1ac1c175a8a7b46d5881c5f4adfd`。ローカル比較コマンドは `node scripts/benchmark-vegetation.mjs dist/src/world-assets.baseline.js`。

ブラウザーの`#world`のdatasetにある`fps`、`frameSimulationMs`、`frameSubmissionMs`に加え、`vegetationUpdates`、`vegetationUploadBytes`を観測できる。後者2つは現在保持する植生群の累計であり、地域の解放時には減る場合がある。
