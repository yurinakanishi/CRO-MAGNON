# 壁画の人物差し替え素材 r36

2026-10-12。元の壁画と同じ顔料・画風の動物画を内蔵imagegenで制作し、22キャラクターを個別に入れ替えられるようにした。全員表示が採用状態。ゲーム中の人物・クレジットの表示設定とは独立する。

- `*-animals-source*.png`：生成原本。草原群は小さなアイベックスを足したr02を使用し、最初の版も保存。
- `*-animals.png`：透過を保持した1024×341の合成用素材。背景色を加えず、原本全体を同じ座標系へ正規化した。
- `recipe.json`：元の配信ファイル、原本と動物版のSHA・bytes、各人物の変更領域、表示を保持する隣人の輪郭。
- `prompts.json`、`friendsMeadow-r02-prompt.txt`：実際の生成指示と入力画像。
- `before-manifest.json`：r36配置採用前の洞窟マニフェスト。

操作はリポジトリ直下で `npm run cave:murals -- --hide <ID>`、復帰は `--show <ID>`。確認だけなら `--preview output/mural-preview` を追加する。`--all-animals` はプレビュー限定。`cave-mural-visibility.json` に保存した人物を非表示にする。

| 壁画 | 個別ID |
| --- | --- |
| 524 | `524` |
| りもねこ | `rimo-neko` |
| 丸Bot | `white`, `blue`, `green`, `purple`, `orange` |
| 形Bot | `beret`, `frog`, `triangle`, `heart` |
| まるぃも | `maruimo-mascot` |
| まえ・こはく | `mae`, `kohaku` |
| 草原の仲間 | `saber-mascot`, `fairy-mascot`, `nukonuko-mascot`, `sagasa-mascot` |
| 川辺の仲間 | `otani-mascot`, `urata-mascot`, `howkey-scientist`, `rei-mascot` |

合成は指定された領域内に限定し、残す人物の輪郭を保護する。元の配信PNGを上書きせず、新しいSHA名のPNGと由来を2つの配信マニフェストへ記録する。再表示で元の配信PNGへ戻る。画像数・描画形状を増やさず、同じ凹凸と照明で見える。

素材や配信基準が更新された場合は、新しいrecipe revisionが必要。未知の原本SHAや配信SHAは拒否する。変更後は `npm run cave:murals -- --check`、関連テストと実Chromeで確認する。

実装・検証範囲は [作業記録](../../../docs/cave-murals-2026-10-12.md)。
