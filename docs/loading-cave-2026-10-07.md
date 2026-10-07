# 開始後の「アプデの洞窟」ローディング

2026-10-07。ユーザー指定：タイトルの壁画帯を撤去し、従来の開始メニューと「関わってくれた人たち」を残す。開始後は明るい洞窟を先に表示し、クロマニョン人を操作して壁画を見ながら世界を読み込む。追加回答により、完了後の移動は自動ではなく「世界へ進む」を押す方式。

## 実装

- 通常ローカル／MMOのタイトルは即時操作可能。世界のGLB取得は開始確認後へ移した。展示のQRクレジット・開始手順は保持。
- `LoadingCave` は既存の洞窟GLB、全壁画、クロマニョン男性と既存の歩走クリップを利用。新規モデルや画像、元GLBの編集はない。同じWebGLRendererの独立Sceneで常時照明を設定し、ゲーム本編の昼夜・松明は変更しない。
- WASD／矢印、Shift、ドラッグ視点、タッチ移動パッド＋ドラッグ、Gamepad軸に対応。実測した洞窟の床・壁を使い、未読込の屋外へ出られない。壁画鑑賞中は部屋に接続せず、実プレイヤーや保存位置を動かさない。
- 洞窟を一度描画してから世界のダウンロードを開始。世界と選択した人物の準備完了後にボタンを有効にする。完了後も鑑賞を継続できる。戻る・再入場・遅れて届いた素材の解放に対応。
- `WorldAssets.ensureInitial()` で洞窟を先行取得し、本編でも同じテンプレートを再利用。独立した明るい材質と壁画テクスチャは鑑賞終了時に破棄。
- 山の初回地形調整が約25秒UIを止めることをCPU profileで確認。既存のRiverBankBuilder workerに同じ引数（0.45、mountainOnly）を渡して実行する経路を追加。山のGLB・変形アルゴリズム・共有の当たり判定は変更なし。
- ゲーム接続開始前にキャンプの初期描画を準備し、接続のタイムアウトを防止。世界の読み込み失敗・壁画欠落は既存の再読込エラーへ移る。`autostart=1` の検証用経路は従来どおり。

## 検証と証拠

`output/playwright/loading-cave-20261007/` に記録。

- `final-r08/report.json`：実Chrome 8項目成功、page/console error 0（意図的な取得失敗ケースはconsole errorの除外を明示）。タイトル即時表示／GLB取得0、協力者、世界通信を保留したまま歩走・見回し、模擬Gamepad、完了後も自動参加しないこと、実ボタンで接続して選択人物表示、タッチと縦横レイアウト、戻ると再入場、世界503と壁画404の失敗を確認。
- `mobile-start/result.json`：既存開始画面の7項目成功。320×568／390×844／430×932／844×390、実Chromeタッチイベント、横スワイプ・縦スクロール防止、模擬キーボードviewport、展示の開始地点、PCの矢印／Enter。エラー0。
- `geometry-r02/report.json`：実配信の山の両LODを、ブラウザー内の元の同期計算と実workerで比較。全メッシュの頂点・法線・UV・riverCut・indexのSHA、材質group、drawRangeが完全一致。範囲外の試験片は法線等を保持。3比較成功。
- `tests-focused.log`：worker変更後、洞窟移動／素材再利用・streaming・title・source-surface-fit・実山の被覆の15テスト成功。後続の破棄後worker到着テストを追加し、`tests-final.log` の14テスト成功（重いcave-hillの2件は先のログ）。
- `check.log`：3設定のTypeScript、533 JS構文、依存境界が成功。変更ファイルのPrettierと `git diff --check` 成功。
- 全体一括の中間チェックは `tests-full.log`：1,033中1,030成功。既存記録と同じ3失敗（resource fruit count、mammoth grounds、old cliff migration）。worker変更後の全体一括は再実行せず、上記の関連テスト・実GLB照合・実Chromeを実施。

再現コマンド：

```powershell
node scripts/build.mjs
node scripts/qa-loading-cave.mjs output/playwright/loading-cave-20261007/recheck
node scripts/qa-loading-cave-geometry.mjs output/playwright/loading-cave-20261007/geometry-recheck
node scripts/qa-mobile-start.mjs output/playwright/loading-cave-20261007/mobile-recheck
npm run check
```

旧 `qa-title-mural.mjs` は壁画撤去後のQAへ移譲する互換入口。

## 性能と制約

同じローカルChromeの観測で、worker移行前 `r06` は最大RAF間隔24,900.5ms、移行後 `r07` は2,379.2ms、`final-r08` は4,916.8ms。別実行・負荷の違いがあるため、FPSや端末一般の改善率は主張しない。長い地形計算中のUI停止は解消したが、GLB解釈・初回GPU/シェーダー準備などの引っかかりは残る。完全に滑らかなバックグラウンド読込を保証するものではない。初期洞窟そのものの取得時間も必要。

途中の失敗も保持：r01のsandbox通信制限、camp-caveにenvironment取得を使った失敗（専用initialへ修正）、接続開始時の地形計算によるtimeout（先行worker準備へ修正）、hidden指定を覆っていたworld-loadingのCSS（修正）。最初のgeometry試験の範囲外条件が山拡張に入っていたため、試験片のフラグを修正した。山の両LOD自体は初回から一致。

実スマホ／Safari／物理Gamepad／長時間負荷は未確認。洞窟内の明るさはローディング用Sceneのみ。通信先は検証用の独立した保存なしNode世界。

既存3000／8787の手動操作、MMO配信物の更新、公開デプロイ、展示配布、commit／pushは実施していない。確認用の独立プレビューを `output/loading-cave-preview/server.mjs` から非表示起動（接続先・PIDは同ディレクトリの `server.json`、保存なし）。
