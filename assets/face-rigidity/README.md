# 大きい顔の人物のスキンウェイト修正 — 2026-10-15

ユーザー指定「歩いたとき、走ったときに顔の形を変形しないで」「大きい顔の子たち」への対応。対象はクロマニョン人女性と、羽根・子グマ・子オオカミ・ツインテール・トナカイの女の子、貝の鉢巻き・子ライオン・三つ編み・ちょんまげの男の子の計10人。

## 原因と修正

顔・髪・フードの頂点に頭以外の骨のウェイトが混ざり、体の動きで顔面が伸び縮みしていた。Codexが既存GLBの `JOINTS_0` / `WEIGHTS_0` だけを修正した。`HeadSurface` 全体を Head 骨に固定し、Chest 骨の高さから HeadSurface の下端まで滑らかに元のウェイトへ接続。全材質に同じ高さの規則を適用して、首の材質境界の開きを防いだ。

元の参照画像→TRELLIS→軽量化→リグの制作系統を維持。形状・法線・UV・画像・材質・骨格・bind行列・全10クリップを含め、ウェイトと骨番号以外のバイトが同一であることを確認した。画像解像度・三角形数・GLBサイズ・ランタイム処理量は増やしていない。制作元の履歴にある別エージェントの表記は過去の事実として保持し、今回の修正者は各QAへ `Codex` と記録した。

## Revisionと採用

- `20261015-r01/` は最初の修正。顔の上部は安定したが、Head骨より下へ伸びる髪とフードに引きつれが残ったため不採用。失敗版と測定を保持。
- `20261015-r02/` は頭部全体と首の接続を修正した採用版。元候補の別revision `*-face-r01` として新しいURLへ保存した。旧GLB・旧manifestは保持。
- [採用10件とSHA](20261015-r02/adoption.json)、[修正範囲と旧SHA](20261015-r02/repairs.json)、各人物フォルダーの `repair.json` / `inspection.json` / `comparison.png`、`assets/<人物>/qa/*-face-r01.json` に詳細を保存。
- 現行manifest・`assets/world-models.json` の配信URL、SHA、revision、QA参照を更新。女性モデルの `sourceRevision` は既存の最適化元との検証連鎖を維持した。

## 検証

Windows / Node 24.16.0 / 実Google Chrome headless。同じGLBとゲームの `CharacterAssets` / `CharacterAnimation` を使用。

- exact GLB: 全10件の `inspect-glb --humanoid --hunting` が合格。Head骨より上の頂点について、全クリップ31時点ずつの修正前最大偏差は26.7〜482.7mm、修正後は1.46e-15m以下。形状の基準はbind poseのHeadローカル座標で、頭自体の回転・移動を除外した。[修正前](20261015-r02/before-head-measurements.json) / [修正後](20261015-r02/measurements.json)。
- 最終回帰検証では、上記に加えてHead骨より下の髪・フードを含む `HeadSurface` 全頂点を測定。10人×10クリップ×31時点と、Idle/Walk/Run切替720フレームが許容20μm以内、材質境界の開き0。[全頭部の測定](20261015-r02/full-head-measurements.json)。
- 実Chromeで旧/新20モデル×10画面、計200画面を撮影。正面のIdle/Walk/Run複数時点、斜め・横・後ろ・全身を確認。10人分の比較と一覧を目視し、顔と髪・フード・首の接続を確認。[撮影記録](20261015-r02/visual-qa.json)。
- 保存なしの独立サーバーへ2 Chromeクライアント＋3 WebSocket参加者、合計5接続。5人の採用SHAを両画面で確認。女性と子グマの実キー操作で歩行・移動キー2回押しダッシュと相手側のクリップ再生を確認。頭部の約40頂点ずつを実描画後にも測定し、最大偏差8.65e-14m以下、ブラウザーエラー0。[ゲーム内QA](20261015-r02/game-qa.json)。準備用に位置・敵なし・プロフィール・無操作退出防止を設定した。現在のオンライン入口はソロへ移るため、検証用LAN接続設定を使用。展示用ビルドの生成・機体への接続は行っていない。
- 関連13ファイル92テスト、`npm run check`（型・strict・673 JS構文・依存境界）、追加スクリプトと全TypeScriptの書式、差分空白が合格。
- 通常3000番の10 manifestの内容と10 GLBの配信SHA・bytesが一致。配信manifestはサーバーでJSONが再整形されるため、内容を比較した。health/status正常、作業前後の保存3部屋の内容一致。[配信確認](20261015-r02/dev-verification.json)。

`npm run verify:assets` は今回変更していない `neanderthal-hunter` の古いvisualReviewとmanifestのSHA不一致で停止。Git HEADにも同じ不一致があることを確認し、対象10人の個別検証とは分けた。[既存の不整合](20261015-r02/existing-asset-verifier-failure.json)。初回の関連テストはWindows sandboxの一時ファイルrename制限で19件が失敗し、通常権限で再実行して92件すべて合格した。撮影初回のfavicon 404と、オンライン設定をソロへ変換する現行仕様に合わせる前の5接続QAの失敗記録も `output/playwright/face-rigidity-20261015/` に保持。

実スマートフォン・物理パッド・5台の実ブラウザー・公開MMO配信は未検証。既存サーバーの手動停止/再起動、保存の手編集/再適用、公開、展示作成/配布、commit/pushは行っていない。

## 再検証

`node scripts/face-remake/measure-chibi-heads.mjs current <出力JSON>` と `node --test tests/character-face-rigidity.test.mjs` で現在の配信対象を測定する。`scripts/qa-character-face-rigidity.mjs <stage> <出力先>` が比較撮影、`scripts/qa-character-face-game.mjs <出力先>` が保存なし5接続QA。`stabilize-chibi-heads.mjs` は新規stage専用、`adopt-rigid-chibi-heads.mjs` は元SHAと検証結果を照合して採用する一度限りの処理で、既存revisionを上書きしない。
