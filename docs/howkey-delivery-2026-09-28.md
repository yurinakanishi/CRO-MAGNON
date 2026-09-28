# Howkeyのローカル実装と展示用ビルド

2026-09-28。制作と操作の検証は [Howkeyの記録](../assets/howkey-scientist/README.md)。

## 検証済み配布物

- フォルダー／ZIP: `output/exhibition-20260928-howkey-r01` / 同名 `.zip`
- Build ID: `2a04dab3f8232586eb5f3af31eaa1765017c63cb81c26b54bd4d0857a1e7f588`
- ZIP SHA-256: `d8f17d483c934f604b90543837e559e4ae673c93df07165b84f346543a21e679`
- ZIP: 405,721,041 bytes。422検証対象ファイル、81 GLB、展開約563.5 MiB。
- Howkey: Candidate 1 / revision 11、GLB SHA
  `f6366ce469d719b2456de06d776bf029e2fdc0a80e9f0ed7c4a51c6bb0ad8c83`。
- リモねこのr08と、それまでの変更も含む。

全615テスト、型・strict、JS構文、依存境界、全48素材を確認。
Howkeyの本体は実Chrome2画面＋通信3人で14検査群、最終HUD・科学パルス・実距離LODは補足3検査群が成功。

この配布フォルダーそのものを `QA_CHARACTER=howkey-female` で実Chrome2画面から開いた。
PS4／Switch Pro表記で初期Howkey選択、人物画像、食事、人物変更と持ち物保持、6地点ワープ、
縦横画面、タイトル復帰と再読込、同期を確認。14検査群、エラー0。
通信3人を追加した独立検査世界を使用し、実展示の保存や稼働プロセスは操作していない。
`output/playwright/exhibition-menu-1790587404268/result.json`。

同梱Node v24.16.0の起動4項目も成功。
未設定のホストIPを明示すること、ローカルホストのWebSocket疎通、二重起動拒否と先行ホスト保持、
クライアント起動を独立したポートで確認した。実PC1／PC2間の検査ではない。
`output/exhibition-20260928-howkey-r01-launch-qa.json`。

## 機体の状態

| 機体 | 今回の状態 |
| --- | --- |
| PC0 | `C:/Users/Public/CRO-MAGNON/releases/exhibition-20260928-howkey-r01` へ予備配置。422ファイル・81 GLBを全SHA照合。選択版・稼働状態を保持。 |
| PC1 | 直前のSSHタイムアウト後、再接続していない。Howkey版は未配布・未切替。 |
| PC2 | 同上。Howkey版は未配布・未切替。 |
| PC3 | 既存の未配布指定を継続。接続していない。 |

PC0は標準の `exhibition-station.ps1 -Action Install` のみを使った。
展開途中と完成配置の全ファイルSHAが一致し、`runningUnchanged: true` を確認。
既存の `station.json` と `running.json` も処理前後で同じSHA。

- 配置: `output/exhibition-20260928-howkey-r01-pc0-install.json`
- 状態保持: `output/exhibition-20260928-howkey-r01-pc0-state-preserved.json`
- ZIP記録: `output/exhibition-20260928-howkey-r01-zip.json`

全機の更新完了とは扱わない。再接続を自動で再開しない。
物理コントローラー、実展示画面、実スピーカー、長時間稼働は未検証。
通常サーバーの手動起動・再起動、既存保存の変更、遠隔UAC、公開デプロイ、コミット・pushは行っていない。

## モデル単体の確認

`../threed-model-creation/models/howkey-scientist/qa/candidate-1/viewer.html` は採用GLBを内蔵した
ローカルプレビュー。回転・拡大、10動作、通常／1/2／1/4速度、停止と時間指定に対応する。
参照画像、試作・不採用版、Blender、QA画像・録画は同じモデルフォルダーへ保存。
保存全ファイルのSHA一覧は `assets/howkey-scientist/archive.json`。
