# 1人1匹のマスコット：既存テストとQAの移行（2026-10-12）

対象は [仕様変更の記録](mascot-companions-2026-10-12.md) に残っていた既存テストとQAの移行。統合時の全体検査では20ファイル・40項目が旧仕様のため失敗していた。キャンプ常設個体、複数同伴、撫でることによる加入・所有者移転、体の位置の保存を期待する検査を、現在の仕様へ置き換えた。

## 自動テスト

- `tests/mascot-fixture.mjs`：選択して生成した1人1匹のfixtureと、実際のゲームコア・行動メッセージ・接続・保存を使うfixture。
- `tests/companion-behavior.mjs`：全ての地上仲間で、到着、接触、喜ぶ時間、中断、壁・行動制約、近接・光弾の反応、別れ、移動を共通検査。
- `tests/throwable-mascot.mjs`：524とりもねこの実体／投擲代理を照合。持ち上げ・空中・待機・切断で二重個体を作らず、他人の操作で移転・回収されないことを検査。
- 保存は `player.mascot` だけ。旧保存からの選択移行、明示的な選択なし、休止中の選択維持、複数回の保存、接続時の新しい個体、持ち物の維持を検査。
- Dots全9種の撫でる反応と所有者保持、5人が同じ種類を選ぶ通信、他人の個体を使わない投擲、削除した旧コマンドの拒否を検査。
- 描画・効果音・読込順序は `companions` と個体IDに追従。接続が切れた個体の描画削除を検査。
- 元のGLBのSHA、ボーン、クリップ、縮尺、素材、全人物リグの接触・足元・ボーン復元の検査は保持。取り除いたのは廃止されたゲーム仕様を前提にしたシナリオ。

最終全体結果は **1,631件中1,627合格・失敗0・条件付きスキップ4**（`full-suite-r02.log`）。従来の40失敗は全て解消。以下の接触不具合に対する2件の回帰テストも含む。

スキップ4件はマスコットとは無関係な任意実行の検査（`OPTIMIZATION_PYTHON` を指定するPillowの2件と、`CRO_BENCH=1` を指定するベンチマーク2件）。合格したものとして数えない。

## 実Chromeで見つかった接触不具合

休止中のHowkeyを検証環境だけで有効にすると、クロマニョン人の手が頭から最大約45cm離れた。`GroundPettingPose` が相手の高さに関係なく深くしゃがんでいたため。低い仲間への既存の屈み方を維持し、接触点が腰より高くなると滑らかに立った姿勢へ戻すよう変更した。

`tests/tall-companion-petting.test.mjs` は配信中の男女2体とHowkeyの元GLBを読み、3方向・30時刻で手の誤差4.5cm未満、足の変位6mm未満、ボーンの正確な復元を確認する。既存の猫・Dots・524のリグ検査を合わせた36件が合格。実Chromeの同じ接触検査で、手の最大誤差は所有者画面3.30cm・訪問者画面3.43cmになった。GLB、リグ、保存データ、登場設定は変更していない。

## QAの対応表

個別スクリプトで重複していた接続・旧所有権・メニュー処理を `scripts/qa-mascot-harness.mjs` と `scripts/qa-mascot-regressions.mjs` へ集約した。旧名の入口は対応する現行シナリオを実行する。出力先は第1引数で指定できる。旧コードは変更前のGit履歴 `9982deb` に保存されている。

| 旧入口 | 現在の検査 |
| --- | --- |
| `qa-companion-524`, `qa-mascot-menu`, `qa-dot-friendship`, `qa-bot-group-petting` | 個別選択、同種の別個体、所有者を変えない撫でる反応、喜ぶ動作、別れ、PC・縦横画面 |
| `qa-524-squad`, `qa-bot-facing`, `qa-bot-spin`, `qa-whistle-rimo` | 上記＋掴み終えた手との一致、空中の1回転、直立着地、他人の呼び戻し拒否、自分の呼び戻し |
| `qa-524-bond`, `qa-pet-on-start` | 上記＋専用一時ディレクトリへの実保存、QAサーバーの再起動、選択・持ち物の復元、接続後の新しい個体 |
| `qa-petting-524`, `qa-rimo-neko`, `qa-rimo-c2-game` | 選択可能な人物ごとの実UI切替と、両画面の手の接触。足元とボーン復元は元GLBを読む自動テストで検査。制作済み素材が対象 |
| `qa-mae`, `qa-friend-mascots`, `qa-maruimo-mascot`, `qa-howkey-game` | 休止モデルをQAだけで有効化し、現行の個別マスコットとして検査。Howkeyを人物として選ぶ旧仕様は復活させない |
| `qa-524-surface` | 旧524 QAの全頂点51姿勢、浮遊、30cmの高さ、4秒ループの検査を保持 |
| `qa-mascot-surfaces` | 旧個別QAの実W入力への追従、近・遠・近でのLOD、実D入力で橋を渡る際の接地。524・りもねこ・mae・まるぃもを検査 |
| `qa-mae-contact`, `qa-rimo-happy-lifecycle` | 元GLBの手・足の測定、途中参加・カリング・中断・ハートやラベルの破棄を保持 |
| `qa-companion-closeup`, `qa-rimo-arrival-sound` | 実際の近接表示、入力・音設定を現行の個体IDへ移行。鳴き声は現在の `NatureAudio` が配信MP3を実際に再生した回数とミュートで検査し、旧生成器のエンベロープ検査も保持 |
| `qa-mascot-roster`, `qa-local-visibility` | 選択可能なカード、非表示・復元、元の素材、通信、クレジット・壁画を検査 |
| `qa-low-spec` | 5人に合計5匹を配置。固定30fps・720p相当の画素数上限・設定画面・投擲を検査。標準では今回の通常ビルドを配信し、`PERF_BUILD` 指定時は指定配信物を使う |
| `remake/qa-remake-game guests` | 検証用人物が524を選んでから撮影する。キャンプの常設個体を仮定しない |

`qa-cloudflare-persistence` に残る旧フィールド名は古い保存を作る検査であり、削除されたAPIへの呼び出しではない。制作時の資料・過去の配布確認 `verify-mae-rollout` は今回の通常QAに含めず、保存する。

## 実行と証拠

```powershell
npm test
npm run check
node scripts/qa-mascot-regressions.mjs flight output/mascot-qa/flight
node scripts/qa-mascot-regressions.mjs retained output/mascot-qa/retained
node scripts/qa-mascot-regressions.mjs poses output/mascot-qa/poses
node scripts/qa-mascot-regressions.mjs persistence output/mascot-qa/persistence
node scripts/qa-mascot-surfaces.mjs output/mascot-qa/surfaces
```

証拠は `output/mascot-test-migration-20261012/`。各Chrome実行の `result.json` または `report.json` に成否・観測値・例外を保存する。失敗した試行も残す。最終合格の実行は以下のとおり。全実行でブラウザーエラー0。

| 検査 | 結果 | 証拠ディレクトリ |
| --- | --- | --- |
| 公開11種・投擲・他人の回収拒否・別れ | 49項目合格 | `chrome-flight-r04` |
| 休止中の歩く仲間11種 | 37項目合格 | `chrome-retained-r02` |
| 選択可能6外見×524・猫・白Dots | 18組・59項目合格 | `chrome-poses-r03` |
| 個別選択と実ディスク保存・専用サーバー再起動 | 16項目合格 | `chrome-persistence-r03` |
| 近接表示、キーボード・模擬パッド・縦横画面 | 6項目合格 | `chrome-closeup-r03` |
| 公開カード・紹介・壁画、QAだけでHowkey復帰 | 3項目＋4項目合格 | `chrome-roster-r04`, `chrome-roster-howkey-r04` |
| 非表示設定・不正選択拒否・再接続・復帰 | 4項目合格 | `chrome-visibility-r08` |
| 実移動への追従・LOD・橋の接地 | 11項目合格 | `chrome-surfaces-r05` |
| 位置準備なしの猫到着・実攻撃の音・ミュート・音源 | 5項目合格 | `chrome-sound-r10` |
| 5人・5匹で固定描画設定と実投擲入力 | 7項目合格 | `chrome-performance-r10` |
| 制作済み524を自分で選択して撮影 | 可視・浮遊・元リビジョン `c2-t02` 確認 | `chrome-remake-guests-r01` |

軽量描画はWindows／Intel Iris Xe／実Chrome headless、1画面＋通信4人、1280×800（描画1214×758）、通常ビルドを15秒観測。洞窟29.99fps、世界30.02fps、描画間隔中央値33.3ms・95百分位33.5ms。固定上限の回帰検査であり、実スマホや変更前との性能比較の結果ではない。

`mae-contact.json` は元GLBの全対象リグで手4.5cm未満・足6mm未満を確認。全体テストは `full-suite-r02.log`、型・strict・641 JS構文・依存境界は `check-final.log`、TypeScript書式は `format-types.log`、変更MJS書式は `format-final-mjs-check.log` に合格を記録。最終QA修正4スクリプトの `node --check` と `git diff --check` も合格。

旧QAに残った起動シェルへの早すぎるクリック、縦画面の「その他の操作」の省略、切替前の人物を準備完了とする待機、旧3mのLOD前提、古い音再生経路の監視も修正した。QA失敗時の終了コードと例外を保存し、未検査を成功として扱わない。

Chromeの検査はWindowsの実Chromeをheadlessで動かす。基本シナリオは2画面＋通信3人。位置とカメラはQA準備であり、移動・選択・撫でる・投げる・呼び戻す入力と区別する。画面寸法の切替は実スマートフォンの検証ではない。物理パッド、Safari、実端末、長時間プレイ、スピーカーでの聴取は今回の合格範囲に含めない。

既存の3000／8787／4173、ユーザーの `.cro-magnon-save/`、公開デプロイ、展示配布は扱わない。QAの再起動・保存はこの検証で作った独立ホストと一時ディレクトリだけで行う。
