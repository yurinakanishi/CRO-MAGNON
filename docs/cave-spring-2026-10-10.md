# アプデの洞窟の薄明かりと奥の泉

2026-10-10の指定に合わせ、待機画面とゲーム内の洞窟を同じ薄暗い照明、手持ちの松明、丸い奥室と泉に揃えた。松明を消しても岩の輪郭が見え、灯すと近くの床・壁画・人物が暖色で照らされる。

## 岩のくぼみに沿う泉

[Hinagdanan Caveの写真](https://infobohol.com/hinagdanan-cave-in-panglao-bohol/)と[別方向の洞窟泉の写真](https://www.globetrove.com/hinagdanan-cave/)を参考に、丸みのある岩壁、凹凸のある岸、青緑の水を採用した。写真の素材は配信物へ取り込んでいない。

元のimagegen参照画像とTRELLISの洞窟を保持し、採用済みr26の頂点を修正した。入口から壁画のある局所Z=-29.5までは位置と法線が一致する。奥壁は既存の接続面を広げて丸め、床を浅くくぼませた。水際の形は水面と岩の交差で決まり、岩には水際の湿った色を加えた。

水面は96三角形の実行時エフェクトで、弱い波紋を動かす。水用の画像や反射用レンダーターゲットは追加していない。泳ぎや採水の機能は今回の対象に含めていない。

| 項目         | 採用内容                                                           |
| ------------ | ------------------------------------------------------------------ |
| GLB          | `public/models/camp-cave/model-r27-rounded.glb`                    |
| SHA-256      | `f3e513c9f311ba2bafdc8ebb8a846a9de0eba15be4c1f35b302e10efbd58b75b` |
| 容量         | 2,122,080 bytes                                                    |
| 頂点・三角形 | 47,437頂点・74,458三角形。元の接続とUVを保持                       |
| 埋込画像     | 1024px以下。元のバイト列と一致                                     |
| 奥室         | 角張った断面を丸め、最深部を約4m延長                               |
| 泉           | 局所Z=-33付近。水面Y=1.0、最深床Y=0.25                             |
| 当たり判定   | 採用GLBから0.35m刻みで歩行面と天井高を再測定                       |

制作コードは `assets/camp-cave/workflow/refine-spring.mjs`。候補、旧形状、測定値は `assets/camp-cave/work/spring/` に保持し、旧GLBを上書きしていない。採用前のmanifestは `assets/camp-cave/archive-geometry-r26-20261010.json`、採用記録は `assets/camp-cave/qa/adoption-r27-rounded.json`。

## 待機中とゲーム中の照明

`shared/cave-light.mts` の環境光・霧と `prepareCaveMaterials` を両方で使用する。以前の待機画面専用の強い照明と、ゲーム中の二重の減光を改めた。待機中も選択した人物の実リグに既存のTRELLIS松明を持たせ、ゲームと同じ `CaveTorch` で光と炎を動かす。光の到達距離は5m。

待機画面は最初から点火しており、松明ボタンとLキーで切り替えられる。ゲーム内は既存の操作と個別の点火状態を使う。人物の動作更新前に松明の姿勢を戻し、画面を閉じる際は松明・水面の所有リソースを解放する。水面をカメラの障害物に含めない。

## 採用履歴の照合

旧最適化 `20261010-r07-a01` のplan・journal・元GLBは変更していない。今回の形状変更は圧縮ではないため、洞窟本体の旧最適化stampを新しい `sourceRevision` に置き換えた。壁画画像の最適化と他素材は保持する。

`scripts/source-model-revision.mjs` は採用記録のSHA、旧graphのファイル、新GLBのURL・SHA・容量、目視採用記録を照合する。新旧で同じURLを使う更新、受理されていないrevision、旧最適化stampの使い回しを拒否する。既存のbuild用graph照合は、この検査を通った洞窟だけを新しい原本として扱う。

旧最適化の `auditAdoption` は現在のmanifestとの完全一致を検査するため、洞窟と集約catalogの意図した差分を報告する。履歴テストでは差分を無視せず、その2ファイル・2モデル記録だけが変わり、catalog内の他素材、旧GLB、全ての履歴検査が保持されていることを別途照合する。

## 検証

実Chrome 154.0.8037.93、Windows、一時ポートの専用サーバーで確認した。通常3000・MMO8787・展示4173の停止や再起動、ユーザー保存の編集・再適用は行っていない。

- 入口・壁画の頂点と法線、接続、UV、画像の保持、泉の床、閉じた奥壁、実GLBと当たり判定のSHA一致を検査。
- 旧版と採用GLBの7方向、通常材質と無彩色の14比較画像を生成。入口・外殻・底面・向きを目視確認。`output/playwright/cave-spring-20261010/exact-glb/`。
- 待機中とゲーム中の同じ観察カメラで、泉・消灯時の輪郭・点火時の照明を比較。消灯時の画像領域の平均輝度は37.14と37.99（0〜255）。カメラ外の松明位置や人物描画が異なるため、画像全体の完全一致を判定するものではない。
- 5人接続は実Chromeの1描画クライアントと4通信クライアント。各人物の独立した点火状態と、実キー入力による岸の歩行を確認。配置はテスト用状態設定、歩行と切替は実入力。`output/playwright/cave-spring-20261010/adopted/summary.json`。
- 390×844のタッチ移動、松明ボタン、横画面、戻る・再入場、ゲームへの移行を確認。物理スマートフォンと実物のゲームパッドは未検証。フレームレート改善の主張は行わない。
- 現行78素材のmanifest、配信151ファイルのSHAと容量、最適化graphを照合。`output/cave-spring-delivered-assets.json`。
- 全体テスト1,407成功、失敗0、条件付き4件未実行。型・strict・597JS構文・依存境界の `npm run check` も成功。全体テストはWindowsサンドボックスのローカル通信・一時ファイルrename制限を避け、通常環境で実行した。`output/cave-spring-final-tests.log` と `output/cave-spring-check.log`。

最終の画像とブラウザー結果は `assets/camp-cave/qa/spring-r27-rounded/` に保存した。検証一覧と各証拠ファイルのSHAは `assets/camp-cave/qa/spring-validation-20261010.json`。待機画面の正常系・タッチ・必須地面の通信失敗・壁画欠落の8項目が成功した。以前のQAが固定していた人物選択順と、後続読み込みになったマンモスを初期読み込み必須とする前提も修正している。

旧 `npm run verify:assets` は先頭の別素材 `neanderthal-hunter` で、制作原本一覧のSHAと最適化後の配信SHAを直接比較して失敗した。今回の変更とは別の旧検証器の前提によるため、その結果は成功扱いせず `output/cave-spring-assets.log` に保存した。上記の配信実体検査では原本と配信物を区別して照合している。

再現は、ビルド後に `node scripts/qa-cave-spring.mjs <出力先>`、`node scripts/qa-loading-cave.mjs <出力先>`。形状比較は `node assets/camp-cave/workflow/qa-spring-model.mjs assets/camp-cave/qa/spring-model-views.json`。検証用の配置と実操作を分けたまま、既存サーバーや保存を利用しない。
