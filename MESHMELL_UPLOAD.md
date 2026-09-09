# Meshmell CLI アップロード手順

## 2026-09-09 最新追記：手元からの発射と残光を修正（展示revision 06）

「魔法が体の後ろから出る」という追加指摘を修正した。原因はゲームの描画が物理判定用の体の中心から光を描き、発射時点でも約47cmの残光を後方に付けていたこと。`src/spell-effects.ts` で発射時の両手の中間位置を記録し、飛行に応じて前方へ進め、残光は飛行済みの区間だけに制限した。壁抜け防止のサーバー判定と射程・ダメージは保持する。さらに、GLBでは消えた粒子のゼロ座標への補間で光が体へ戻らないよう、非表示中は直近の実座標を保持する。

最新は展示revision 06、SHA `4584cd7e2a432d58404e353e8cfa570656fb6eb18798f100b3320503baffb471`。97フレームのゲームとの照合に加え、240 Hzの384時点でフレーム間も検査した。発射時の光と両手の中心の距離は丸め誤差の範囲（約6×10⁻⁹ m）、光と残光の中心が手元より後ろへ移動する箇所はない。5方向の発射、遅れて届いた弾、近接壁などの9テストを通過。ローカル50882番が修正したゲーム描画コードを配信することも確認した。Cloudflare公開ゲームの再デプロイは今回行っていない。

Meshmellの同じモデル199を公式CLIで更新・再ダウンロード照合済み。英語名 **Desert Fennec Mage**、右向きカバーは画像ID263、初期動作ID98。公開設定とURLは継続。撮影は最終GLBの0.50秒、発射確認は0.41秒。以前のrevision 01〜05と公開履歴は保存する。以下のrevision 04の記録は、この追加修正前の履歴。

## 2026-09-09 最新：Desert Fennec Mageの動作差を修正

ユーザーの「fix」「名前を英語」「写真は右向き」に従い、既存モデル199を公式CLIで更新した。名前は **Desert Fennec Mage**、余分な副題は付けない。右向きの実GLBを0.50秒で撮影した960×960カバーは画像ID262。公開URL、public / CC BY 4.0 / Yuri Nakanishi、初期動作 `Magic_Loop`（ID98）は継続する。

旧展示revision 01ではゲームの0.8秒の動作を1.8秒に伸ばし、発射も0.4秒から0.9秒へ遅らせていた。光の発生位置と速度も展示専用で違っていた。最新の展示revision 04は実際のゲームの `CharacterAnimation`・`SpellEffects`・サーバー戦闘処理から60 Hzで97フレームを採取して書き出す。動作0.8秒、発射0.4秒、光の高さ0.4 m、速度7 m/sを照合し、粒子位置の最大誤差0、骨の姿勢は浮動小数点の丸め誤差の範囲だった。全体1.6秒の展示ループには弾の飛行と待機が含まれる。元のゲームGLB、メッシュ、スキン、9動作は保持した。

GLB SHA: `c092d5e5bfd237e3bdb15effab69d41142a315c9e5b5da6023ae9dfab9535d1b`。公式CLIのexact-ID読み戻しで英語名・カバー・初期動作・公開設定を確認し、再ダウンロードしたGLBのSHAが一致した。検証は `assets/desert-mage-magic-parity-qa.json`、現在の公開状態は `assets/meshmell/desert-fennec-mage-magic.json`、追記履歴は `assets/meshmell/history/`。更新コマンドは `node scripts/update-desert-mage-magic-parity.mjs --update`（省略時はローカル検証のみ）。以下のrevision 01向け手順は履歴として保持し、再公開には使用しない。

光は移植可能なglTFの透過スプライトで表現するため、ゲームの加算合成シェーダーと画素単位で同じ描画ではない。180pxのサイズ上限は記録した撮影カメラで再現し、任意の拡大率には追従しない。ゲームとの数値照合条件は平地・静止・20 Hzサーバー・60 Hz描画・通信遅延なし。MeshmellのWeb画面は開かず、公式CLIで公開後を検証した。

## 2026-09-08 砂耳の魔法使い・発光展示版を公開完了

ユーザーの「go」で公開・CC BY 4.0・Yuri Nakanishiの条件が承認され、公式CLIでモデル199を公開した。URL: https://meshmell.com/ja/viewer/models/desert-fennec-mage 。初期動作は `Magic_Loop`、発光中の撮影カバーは画像ID261。exact-IDで初期動作・公開範囲・ライセンス・クレジット・カバーを読み戻し、ダウンロードしたGLBのSHAが `477e64d38bf74faefa39ac906ecdd8f04e3ba52fc357a66c0382996c1d5af8a0` と一致することを確認した。現在状態は `assets/meshmell/desert-fennec-mage-magic.json`、検証は `assets/desert-mage-magic-qa.json`、追記履歴は `assets/meshmell/history/`。以下の回答待ちは公開前の履歴。

## 2026-09-08 砂耳の魔法使い・発光展示版（公開設定の回答待ち）

ユーザー指定の魔法を初期動作にした展示用GLBを制作。ゲーム採用revision 04のメッシュ・スキン・元9動作のバッファを保持し、`Magic_Loop`（2.4秒）と19個の発光粒子を内蔵した。ゲームの待機動作・攻撃処理は変更していない。`public/desert-mage-magic.html` は開くと自動再生するローカル展示画面。GLBの既定再生は閲覧側の設定も必要なため、Meshmellの `defaultActionId` には登録後の `Magic_Loop` IDを指定する。

`assets/desert-mage-magic-qa.json` に145フレーム／60 Hzの実表面検査と、実GLBの1.10秒時点を撮影した960×960 JPEGを記録。出力は `output/desert-mage-magic/revision-01/`、GLB SHAは `477e64d38bf74faefa39ac906ecdd8f04e3ba52fc357a66c0382996c1d5af8a0`。CLI 1.0.4のproduction認証、必要scope、doctor READY、同slug不在を確認済み。

`node scripts/upload-desert-mage-magic.mjs` は準備内容の検証のみ。ユーザーが公開範囲を選んだ後に限り、`--upload --visibility=public` または `--upload --visibility=private` を付ける。従来の31件の承認を新モデルへ自動拡張せず、公開・CC BY 4.0・Yuri Nakanishiの条件を確認中。最初に非公開で取り込み、アクション登録後に初期動作・カバー・選択された公開範囲を設定し、exact-IDとGLBのSHAを読み戻す。現時点のアップロード実行は0件。履歴用の展示版12ファイルは隣の正本へ追加保存し、既存426ファイルを保持した（`assets/desert-mage-canonical-sync-magic.json`）。

## 2026-09-07 実行完了

続くユーザー指示で、全31件へ背景付き960×960のカバー画像を追加した。`../threed-model-creation` の公開手順と描画ヘルパーを参照し、実GLBから撮影・全画像の目視検査・公式CLIによる既存IDの画像更新・画像ID229〜259の読み戻し確認を完了。`assets/meshmell/covers.json` と `assets/meshmell/cover-qa.json` を参照。

ユーザーが全31件・public・CC-BY-4.0・Yuri Nakanishiを明示承認し、採用版GLB全31件を公式CLIで公開した。モデルIDは168〜198。公開URLと検証結果は [assets/meshmell/README.md](assets/meshmell/README.md)、正確な現在状態は `assets/meshmell/uploads.json`、追記専用履歴は `assets/meshmell/history/` を参照する。

全31件をexact-IDで読み戻し、公開設定・名前・説明・ライセンス・クレジットを照合。表示用GLBをCLIでダウンロードし、元GLBとのSHA-256一致を全件確認した。アニメーション付き8件のGLB内の動作データは保持されているが、Meshmellのactions一覧は空で、サイトの動作選択への登録は未完了。ローカルCLIのdistとソースに差があり、actions照合は隣の公式ソースと既存tsxで実行した。doctorのリリース確認だけは利用できず、詳細を `assets/meshmell/preflight.json` に記録した。

`node scripts/meshmell-upload.mjs` はローカル検証、`node scripts/meshmell-upload.mjs --upload` は成功記録をスキップして実行する。以下の16件・アップロード0件・実行待ちは2026-09-06時点の履歴であり、今回の31件の明示承認と実行結果を優先する。

更新日: 2026-09-06

## 現在の方針

- Meshmellの操作は `../meshmell.com` にある公式CLIを使用する。
- アップロード対象は、このリポジトリの `public/models/<model-key>/model.glb` にある検証済みGLBのみとする。
- **Xへの投稿、リポスト、LikeなどのSNS操作は行わない。**
- **回転動画は作成しない。** Meshmellへのアップロードに動画を添付しない。
- MeshmellのWebエディタではアップロードやモデル編集を行わない。ブラウザは、CLIが新しい認証を要求した場合の認証コールバックにだけ使用できる。
- ユーザーから改めてアップロード実行の指示があるまで、何もアップロードしない。
- 公開範囲は推測しない。アップロード実行時に `public` または `private` が明示されていることを確認する。

## 対象モデル

現在の対象は次の16件。

1. `cro-magnon-hunter`
2. `neanderthal-hunter`
3. `woolly-mammoth`
4. `valley-pine`
5. `meadow-grass`
6. `valley-boulder`
7. `firewood-pile`
8. `berry-bush`
9. `hide-tent`
10. `drying-rack`
11. `stone-firepit`
12. `flint-spear`
13. `stone-axe`
14. `meadow-ground`
15. `river-water`
16. `wood-footbridge`

15件の世界素材の正本は `assets/world-models.json`、クロマニョン人を含む配信GLBは `public/models/` を参照する。`lod1.glb`、`preview.glb`、`review-v2.glb` はアップロード対象にせず、各ディレクトリの `model.glb` を使う。

## 参照する実装と手順

- CLI実装: `../meshmell.com/packages/cli`
- CLI利用方法: `../meshmell.com/packages/cli/README.md`
- 既存の公開手順: `../threed-model-creation/docs/MESHMELL_CLI_RELEASE.md`
- 制作・QA方針: `ASSET_WORKFLOW.md` と `../threed-model-creation/AGENTS.md`

`../threed-model-creation` の手順にある回転動画とX公開工程は、CRO-MAGNONモデルの今回のアップロードでは実施しない。GLBの制作・QA系統、CLI限定、認証確認、slug重複防止、idempotency、exact-ID readback、履歴保存だけを引き継ぐ。

## 実行前チェック

PowerShellでCLIの実体を固定する。

```powershell
$MeshmellRepo = "C:\Users\yurin\Desktop\projects\meshmell.com"
$MeshmellCli = Join-Path $MeshmellRepo "packages\cli\dist\src\bin.js"
$env:MESHMELL_CREDENTIAL_STORE = "file"

node $MeshmellCli --version
node $MeshmellCli models upload --help
node $MeshmellCli --json capabilities --command "models upload"
node $MeshmellCli --json auth status
node $MeshmellCli --json doctor
```

確認条件:

- CLIがMeshmell公式のビルドで、必要なupload optionを公開している。
- `doctor` が `READY`。
- principalが `yurinakanishi@meshmell.com`。
- `models:read`、`models:write`、`uploads:write` scopeがある。
- 認証情報、token、cookie、認証URLをログやGitへ保存しない。
- 各GLBのSHA-256が `assets/world-models.json` や既存QA記録と一致する。
- 実行前に公開範囲、license、credit、name、slug、descriptionが確定している。

## 重複確認

全件一覧が取得できなくても、各slugを個別に検索する。

```powershell
node $MeshmellCli --json models list --query "<model-key>" --limit 10
```

結果に同じslugがある場合、新規アップロードしない。所有する意図したモデルなら、そのmodel IDに対して `models update --file` を使う。所有物か判断できない場合は停止する。

## アップロードコマンド

以下は将来の実行例であり、現在は実行しない。

```powershell
$ModelKey = "cro-magnon-hunter"
$ModelPath = Join-Path $PWD "public\models\$ModelKey\model.glb"
$Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ModelPath).Hash.ToLowerInvariant()
$IdempotencyKey = "$ModelKey-$($Hash.Substring(0, 16))"

node $MeshmellCli --json models upload $ModelPath `
  --name "Cro Magnon Hunter" `
  --slug $ModelKey `
  --license "CC-BY-4.0" `
  --description "Rigged and animated prehistoric Cro-Magnon hunter created for the CRO-MAGNON multiplayer game." `
  --credit "Yuri Nakanishi" `
  --idempotency-key $IdempotencyKey `
  --wait-timeout 10m
```

公開する場合だけ、明示された指示に基づいて `--public` を追加する。private uploadでは `--public` を付けない。CLI v1.0.4ではuploadの既定値はprivateである。

モデルは一件ずつ直列で処理する。成功応答を確認してから次へ進み、同じGLBの再試行では同じidempotency keyを使う。処理タイムアウト時は新規作成を繰り返さず、返されたoperation IDまたはresume IDを使って継続する。

## アップロード後のCLI検証

ブラウザで公開URLを開かず、返された正のmodel IDを直接読む。

```powershell
node $MeshmellCli --json models get <model-id>
node $MeshmellCli --json models actions list <model-id>
```

確認項目:

- model ID、name、slug、visibility、description、license、credit
- display fileが `READY`
- リグ付きGLBでは期待するanimation actionが登録されている
- ローカルのファイルパス、byte size、SHA-256
- CLI upload/update応答とexact-ID readback

アップロードごとに、秘密情報を除いた現在状態と追記専用履歴を `assets/meshmell/` 以下へ保存する。推奨構成:

```text
assets/meshmell/
  uploads.json
  history/
    YYYYMMDDTHHMMSSZ-<model-key>-upload.json
```

履歴にはUTC時刻、action、account email、model ID、name、slug、URL、visibility、ローカルパス、SHA-256、byte size、CLI応答のrequest/operation ID、exact-ID readbackを記録する。token、cookie、認証URL、OAuth state、PKCE情報、resume capabilityは記録しない。

## 今回の状態

2026-09-06時点では、CLI v1.0.4のcapability、認証principal、doctorのREADY、16件のslug未登録をread-onlyで確認した。**モデルのアップロードは0件。X投稿は0件。回転動画の生成は0件。**
