# Meshmell CLI アップロード手順

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
