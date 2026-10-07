# リモートmainとローカル変更の統合（2026-10-08）

## 調査時の状態

- 元リポジトリ：`C:/Users/yurin/Desktop/projects/CRO-MAGNON`、現在のブランチは`main`。
- ローカルHEAD：`77836fee220e3776f1524289f5db71fbef409257`（人物の顔と歩走時の変形修正）。
- `git fetch origin`で確認したリモートmain：`e9c1c3327064a736a170a63872c32c800e9bf2e1`。統合直前の再取得でも同じ。
- ローカルはリモートより3コミット遅れ、ローカル側だけの既存コミットは0件。
- 登録ワークツリーは元リポジトリの1件のみ。追加ワークツリー・未統合の別ローカルブランチ・このチャットに付属する管理ワークツリーはなかった。
- 未コミット変更は追跡済み37ファイル、新規172ファイル、合計209ファイル・144,524,041 bytes。ローディング洞窟、仲間7体、Howkeyのフラスコ、壁画、クレジット、制作工程とQAを含む。
- stashは2件（2026-10-07の顔変更退避、2026-09-10のHUD変更退避）。過去の退避履歴としてそのまま保持し、再適用・削除はしていない。

## 取り込んだリモートの変更

| コミット | 内容 |
| --- | --- |
| `9b467de` | ローポリ、画質固定、スマホ、段階読込の方針を更新 |
| `bbdfef4` | Markdownを整理。作業履歴を月別、機能記録を`docs/history/`へ移動し、展示資料を統合 |
| `e9c1c33` | 上記資料整理に人物の顔修正コミットを統合。動画同期規則を保持 |

## 統合と保全

1. 209ファイルの実体、SHA-256、変更パッチ、HEAD、リモート、ブランチ、ワークツリー、stashの情報を`output/git-integration-20261008/`へ退避。
2. 全ローカル変更を`b016dc688454d7e18fcaa5ea0abead5cce0dd053`（`Add contributor companions and a walkable loading cave`）へコミット。復旧用ブランチ`codex/preserve-local-20261008`も同コミットを指す。
3. 元リポジトリの`main`へ`origin/main`をマージ。競合は`AGENTS.md`の1ファイルのみ。
4. リモートの`AGENTS.md`をそのまま保持。ローカルで追加した作業記録3件は、本文を保持して`docs/changelog/2026-10.md`へ移動。索引にローディング洞窟と本記録を追加。
5. 競合した作業記録以外の208ファイルは、退避時とバイト単位で一致。リモート側の111パス（移動元の削除を含み、意図的に追記した月別履歴と索引を除く）もGitオブジェクトと照合。月別の既存履歴とローカル3項目をともに保持し、stash2件も不変。

`node_modules/`、生成物、検証出力、`.cro-magnon-save/`等のGit無視対象はコミット対象に含めない。既存サーバーの停止・再起動、保存の再適用、公開・展示配布、pushは行っていない。

## 検証

- `npm run check`：成功。3設定の型チェック、538 JSの構文、依存境界。
- 変更したTS/MTSのPrettier検査：成功。
- 全体の`npm run format:check`：既存5件を指摘（`shared/behemoth-rules.mts`、`shared/sabertooth-rules.mts`、`src/enemy-state.ts`、`src/lean-pose.ts`、`src/octopus-pose.ts`）。5ファイルとも元HEADから変更なし。
- マージ差分の`git diff --cached --check`：成功。保存コミットに含む既存の画像生成プロンプト3件の末尾空白は、入力記録を変えないため保持。
- 全テスト：1,039件中1,036件成功、3件失敗。過去の作業記録にもある資源・マンモスの既存失敗と同じ。初回の通常サンドボックスでは一時テストサーバーへのループバック通信等が`EACCES`で拒否されたため、制限を外して再実行し、通信テストも検証した。
  - `resource models deplete visibly: fruit count and boulder scale`
  - `both mammoth grounds have a continuous body-clear roaming area and substantial natural movement`
  - `old cliff positions and homes migrate once while health and safe riding locations are preserved`
- 実ブラウザーQAは今回再実施していない。ゲームコードと素材は、既存QA付きのローカル変更からバイト単位で保持した。

実行ログ：`output/git-integration-20261008/{check.log,format.log,format-changed.log,tests.log,tests-unrestricted.log}`。退避・照合記録：同フォルダーの`before.json`、`resolution.json`、`audit.json`、`files/`。
