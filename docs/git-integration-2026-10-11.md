# リモートmainと全ローカル変更の統合（2026-10-11）

ユーザーの「git pullして、今のlocal changesを全部残したままmainに統合して」という依頼で実施した。

## 更新と保全

- 元HEAD：`e9c1c3327064a736a170a63872c32c800e9bf2e1`。
- `git pull --ff-only origin main` で10コミットを取得し、`2fda5d8`（装備の排他選択・確認）まで更新。
- 退避前のローカル変更は173パス（追跡済み72、新規101）。展示方針、石斧の持ち方、全音源・BGMの改修、旧音源の保管、制作スクリプト、記録、テストを含む。
- `git stash push --include-untracked` で全件を退避。復旧用stash `0b8a24308f1ceb9fd3bd129c8fba91e4a7bc7fb9`（`codex: preserve all local changes before main integration 2026-10-11`）は統合後も保持。
- Gitオブジェクトの照合では161パスが退避時と一致、9パスはリモート変更と統合、3パスは元からの削除を維持。欠落・想定外の変更は0。削除は旧単発採集音3本で、ローカル改修に含まれる各2種への置換を保持した。
- 復旧用ファイルとGit blob／SHA-256の一覧は `output/git-integration-20261011/local-snapshot/` と `local-snapshot.json`、照合結果は `preservation.json`。最初に作った一時ディレクトリは実行ごとのサンドボックス外から参照できなかったため、永続stashからこの作業フォルダー内へ改めて保存・照合した。
- Git無視対象の音源原本・PCMマスター、生成物、ユーザー保存はコミット対象に含めず、そのまま保持した。

## 競合の解消

競合は `AGENTS.md`、`README-EXHIBITION.md`、`README.md`、`docs/changelog/2026-10.md`、`src/character-assets.ts`、`src/model-review.ts` の6ファイル。

文書は10月9日の展示作業停止と10月10日の展示終了を両方保持。月別履歴はローカルの3項目とリモートの26項目を本文ごと保ち、日付順に統合した。

人物コードはリモートの検証済みGLB読込、読込キュー、キャンセル、LODの共有とメモリ解放を保持したうえで、ローカルの `axeGripPlacement` と人物インスタンスの `axeGrip` を追加。モデル確認画面も新しいGLB読込方式と石斧の持ち方を両立させた。自動統合された `src/world3d.ts` の石斧配置、`src/nature-foley.ts` の仲間の撫で音と音量改修も確認した。

## 検証

- `npm run check`：成功。型・strict、602 JavaScriptファイルの構文、依存境界。
- 変更したTSファイルと関連テストのPrettier：成功。
- 通常ビルド：`npm test` のpretestで成功。
- 全体テスト：1,441件中1,437件成功、失敗0、条件付きスキップ4件。全9人物の石斧テストと音関連テストも成功。
- 差分空白・競合マーカー・変更の保全：成功。

初回の通常サンドボックスでは一時ディレクトリの `realpath` が `EPERM`、一時テストサーバーのloopback通信が失敗したため、その実行を中断。加えてリモートで追加されたmeshoptデコーダーがローカルの生成済みvendorに不足していたため、`node scripts/prepare-vendor.mjs --without-hands` で配置した。ビルド済みコードを使い、許可実行の `node --test --test-reporter=tap tests/*.test.mjs` で上記の全体テスト結果を確認した。ログは `output/git-integration-20261011/{check.log,format.log,tests.log,tests-unrestricted.log}`。

実Chrome・実スマホ・物理パッドのQAは今回再実施していない。既存3000／8787／4173の停止・再起動、保存の編集・再適用、展示ビルド・配布、外部公開、pushは行っていない。統合内容はローカルmainのコミットとして保存する。

## 同日追記：統合済みの復旧用コピーを整理

後続のコミット・push依頼時に、上記173パスがorigin/mainの履歴にある `6b8dec8` に保存されていることを再照合した。ユーザーの許可により、不要になったstash `0b8a243` と `output/git-integration-20261011/local-snapshot/` の170ファイルを削除。QAログ・SHA一覧・保全照合の記録は保持した。[後続のpushと整理の記録](git-pull-2026-10-11.md#同日追記コミットpushと復旧用バックアップの整理)。
