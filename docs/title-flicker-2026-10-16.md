# 初回タイトルのちらつき修正（2026-10-16）

ユーザー報告: 最初のタイトル画像が、表示直後にまばたきのように一瞬途切れる。PC・スマホ相当の両方で再現し、原因を修正した。今回の修正はコードとローカル検証までで、公開サイトへはまだデプロイしていない。

## 原因と修正

軽量なタイトル表示からゲーム本体へ引き継ぐ際、`src/title-shell.ts` の `release()` が表示中のタイトルをDOMから外し、`src/main.ts` が新しいviewportへ挿し直していた。同じ画像要素を再利用していても、この取り外しでCSSアニメーションが再開する。

`screen-in` と `title-rise` が2回始まり、タイトルと画像の実効透明度が0へ戻っていた。スマホでは8秒の `title-logo-settle` もやり直されていた。画像のリクエスト自体は1回で、画像の再取得が原因ではない。

タイトルのviewport・`#screens`・タイトル・画像・ダイアログを、元の場所に残したまま引き継ぐようにした。ゲーム本体のマークアップを切り離したtemplateで準備し、既存の画面へcanvas・HUDとセットアップ画面を追加する。最初のフェードやスマホのゆっくりした拡大演出は保持し、引き継ぎで再開させない。

## 再現と同条件の再検証

実Chrome 155.0.8059.41、PC 1440×900・スマホ相当390×844、独立したブラウザー保存・一時ポートで検証。各ケースはキャッシュを無効にした新しいコンテキストを使用した。

通常の読み込みに加え、タイトル画像のdecode後にゲーム本体のリクエストを1.4秒以上保留するケースも用意した。後者は読込順の再現用の準備であり、実通信の速度測定ではない。観測用のrequestAnimationFrameでDOMの同一性・実効透明度・アニメーションを記録し、Chromeのscreencastで表示フレームも保存した。ちらつきの観測中はアニメーションを無効にしていない。

| 条件                         | 修正前の透明度の低下 | 修正後の突然の低下 | 表示演出の開始回数（前→後） |
| ---------------------------- | -------------------- | ------------------ | --------------------------- |
| PC・通常                     | 0.403 → 0            | 0件                | 各2回 → 各1回               |
| スマホ相当・通常             | 0.330 → 0            | 0件                | 各2回 → 各1回               |
| PC・本体の読込を保留         | 1 → 0                | 0件                | 各2回 → 各1回               |
| スマホ相当・本体の読込を保留 | 1 → 0                | 0件                | 各2回 → 各1回               |

修正前4ケースは各1回の突然の消失を検出。修正後4ケースでは、タイトルの親要素・画像とも同じものを維持し、各画像リクエスト1回、突然の透明度低下0だった。記録は以下。

- 修正前: `output/playwright/title-continuity-20261016-before/report.json` と同フォルダーのtrace・連続PNG。
- 修正後: `output/playwright/title-continuity-20261016-verified/report.json` と同フォルダーのtrace・連続PNG。
- 再実行: `node scripts/qa-title-continuity.mjs output/playwright/title-continuity-<任意の名前>`。

同じスクリプトで、PC／スマホ相当それぞれ、読み込み中の開始操作・開いたクレジットの4ケースも検証。元のviewport・screens・タイトル・画像・ダイアログの5要素を保持し、開始操作は1つのセットアップ画面へ進み、開いていたダイアログは開いたまま。引き継ぎ後の戻る・言語切り替え・再度の開始も合格。エラー・ゲームAPI・WebSocket通信・サーバー側のゲーム部屋0。

## 回帰検証と限界

- `npm run build`、`npm run check`: 型・strict・686 JavaScript構文・依存境界が合格。
- `npm run format:check`、新規QAスクリプトのPrettier、`git diff --check`: 合格。
- `node --test tests/title-boot.test.mjs tests/title-shell.test.mjs tests/screens.test.mjs tests/language.test.mjs`: 関連30件合格、失敗・スキップ0。
- `node scripts/qa-selection-sound.mjs output/playwright/title-handoff-selection-sound-20261016`: 7項目合格。前回の人物と仲間の順序・スマホ4人表示・実スワイプ・セットアップの戻る・実際のゲーム開始・音声出力と停止を再検証した。
- 全体テストは1,804件中1,799件合格、失敗1、条件付き4件スキップ（Pillow環境未指定2件・ベンチマーク未指定2件）。失敗は今回変更していない `tests/atomic-write.test.mjs` の同時読込・置換試験で、Windowsの一時ファイルのrenameがEPERMのまま10秒の期限を超えた。関連テストと組み合わせた再実行でも同じ1件が失敗した。ファイル置換処理やそのテストを変更・省略して合格扱いにはしていない。

全体結果は `output/title-flicker-20261016/tests.log`、再実行は `related-tests.log`、タイトル関連の合格結果は `title-tests.log`。実スマホ・Safari・物理コントローラーは未検証。今回は表示継続性の検証であり、初期表示速度やfpsの性能改善は主張していない。

## 保存・配信状態

作業前に保存を `output/title-flicker-20261016/save-before/` へ控え、作業後の `world.json` と `world.backup.json` は控えと全SHAが一致した。通常3000番のhealth／statusはECONNREFUSEDで、稼働配信のSHA照合は未実施。記録は同フォルダーの `local-verification.json`。今回のChrome検証は独立した保存と専用の一時サーバーを使用している。

通常サーバーの起動・停止・再起動、保存の編集・再適用、公開デプロイ、展示物生成、commit／pushは行っていない。前回までのUI修正と、別作業の差分も保持した。
