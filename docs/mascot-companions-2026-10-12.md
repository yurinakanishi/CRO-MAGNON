# マスコットは1人1匹・同じ子を何人でも（2026-10-12）

ユーザー指定：MMOでもローカルでも、マスコットは1人1匹まで。同じ子を何人が選んでもよい（各自の分身）。キャンプに最初からいるマスコットは置かない。撫でると反応するだけで、ついてくることも持ち主が変わることもない。連れていくのをやめると短いあいさつの後に消える。投げて放置はできる。

## 仕組み

- 選択は `player.mascot`（保存はこれだけ）。体は持ち主の接続中だけ存在し、切断で消え、再接続で横に現れる（`shared/mascot-selection.mts` の `chooseMascot`／`syncMascots`）。
- Dotsは `room.orbBots`、524・りもねこ・歩く仲間の体は `room.companions`。524とりもねこは投げるための `orbBots` 項目を `companionId` で持つ。
- 撫でるは1つの行動 `petMascot`（対象は体のID）。だれの子でも撫でられ、所属は変わらない。呼び戻し（`recallBots`）は自分の子だけ。口笛での加入・まとめて撫でる・全選択・`travelAlone` は廃止。
- 別の子を選ぶ・「連れていかない」・T で、今の子は `leavingAt` から1秒（`MASCOT_FAREWELL_MS`）あいさつして消える。あいさつ中に同じ子を選ぶと同じ体が戻る。
- mae・こはくちゃん・まるぃもは仲間（`GROUND_MASCOTS`）の共通の動きへ統合。休止の扱い（`mascot-roster.mts` の `enabled`、`local-visibility.json`）は従来どおり。
- 旧保存の部屋単位の所属は、持ち主ごとにカードの並び順（りもねこ、524、仲間、Dots）で最初の1匹へ引き継ぐ（`formerMascotBonds`）。旧フィールドは書き戻さない。

## 実装時の確認

- `npm run check`（型・strict・625 JS構文・依存境界）合格。
- 新規 `tests/mascot-companions.test.mjs` 14件合格。入力案内の3テストファイル17件合格。
- 実Chrome `scripts/qa-mascot-companions.mjs`（2人・同じ524・他人の子を撫でる・別れ・投げて放置・切断）27項目合格、ブラウザーエラー0。証拠 `output/playwright/mascot-companions-20261012/r01/`。
- 当時未完了だった旧仕様の既存テストとQAは、2026-10-12の追加依頼で移行・検証を完了した。全体は1,631件中1,627合格・失敗0・条件付きスキップ4。[最終結果と検証範囲](mascot-tests-2026-10-12.md)。以下のコミット前確認は移行前の履歴。

## コミット前の確認

ユーザーの再度のコミット・push指定により、現在の変更を保存する前に通常ビルド（`src/orb-bots.css` を含む）と関連6テストファイル44件を確認し、すべて合格。`npm run check`（型・strict・627 JS構文・依存境界）、全TypeScriptと変更MJS・CSSのPrettier、差分空白も合格。書式不一致12ファイルを整形し再チェックした。作業記録と索引を追記。全体テストと実ChromeのQAは今回は再実行していない。ログは `output/git-commit-push-20261012-r02/`。
