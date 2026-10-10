# guarded-surface@1：独立承認済みローポリ主モデルの採用経路

出力専用の証明ツール（proof-lowpoly-high-r04）が `guarded-body` で証明し、ネイティブ確認で個別承認したモデルを、一覧に明記したものだけ現在の主モデル（primary）と差し替える手順。差し替えは新しい候補リビジョンと新しい採用IDで行う。形状は可逆ではない（三角形を減らし、残る頂点はソースと同一）。そのため既存の `verify.mjs` と `exact-repack@1` は変更せず、別のレシピと専用の検証器を設けた。

ローカルで可逆な統合（生成・計画・適用・監査・復元）は、ユーザーがすでに許可している。Claude Opus 5.5・Highが実装し、Codexが素材の選定・実行・独立レビューを行い、28素材を`20261010-r07-a01`として採用した。実行結果は[作業記録](../optimization-assets-lowpoly-2026-10-10.md)にまとめる。

## 構成

- `scripts/optimization/guarded-surface.mjs`：候補リビジョンの生成と検証。
- `scripts/optimization/guarded-adoption.mjs`：基準採用の上に組む連鎖採用の計画。
- `scripts/optimize-guarded-assets.mjs`：`generate` / `verify` のCLI。
- `scripts/optimization/guarded/`：r04証明エンジンから昇格した補助関数（`topology`・`structure`・`checks`・`document`・`coverage`）と、Codexの独立レビューで追加した`preservation`。元の証明エンジンと表面誤差の基準は変更せず、元データの保持検査を強化した。`output/` は読み込まない。
- 既存ファイルへの追加は次の3つだけ。
  - `contract.mjs`：`GUARDED_RECIPE` と `runtimeIndexOf` の分岐。
  - `adoption.mjs`：`planAdoption` の分岐。未知のレシピは従来どおり拒否する。
  - `chained-adoption.mjs`：`guarded-surface@1` のグラフに限り、次の2点を行う。他のレシピの書き換えは従来どおり厳格で、起動用アクターの差し替えと、既存の `supersedes` の末端変更は拒否する。
    - 起動用アクターの `startupCandidate` を更新し、古い `identicalFullCandidate` を削除する。
    - 既存の `supersedes` / `startupCandidate` の末端パスを変更する。

## 生成（`generate`）

入力はすべて明示する。

- 適用済みの基準採用と、その plan.json の SHA-256。
- 1つ以上の完全な証明 summary.json（`--proof-summary` を繰り返す）と、実装ダイジェスト。
- キーごとに、承認した候補の SHA-256（`--accept key=sha,...`）。

既定の範囲は空で、一覧にない素材は扱わない。

複数のsummaryを渡す場合の条件は次のとおり。条件を満たさないものは拒否する。

- 実装ダイジェストが同じで、実装ファイル一覧が同じ。
- ポリシーが完全に一致する。
- キーが互いに重ならない。同じキーが2つのsummaryにあれば拒否する。
- 承認したキーは、どれか1つのsummaryにだけ含まれる。
- どのsummaryも、少なくとも1つの承認キーを提供する。

summaryは統合しない。各原本をバイト単位でそのまま `proof/summary-<n>.json` に保存し、SHA・出典（from）・提供キーを記録する。

実際の証明は次の2つ（同じエンジン `c7ee69f6…7806`、ポリシー同一、キーは重ならない）。

- `output/optimization-audit-20261009/lowpoly-high-r04-initial/summary.json`：16キー、SHA `8fb81f6c…a5b1`。
- `output/optimization-audit-20261009/lowpoly-high-r04-remaining/summary.json`：65キー、SHA `ed5eff41…766a`。

### summaryの方針検査

`summaryProblems` は、生成時と保存済みsummaryの検証時に同じ関数で実行する。保存後に省くのは、エンジン自体のファイルが手元にあるかの確認だけ。

- スキーマとツール、実行状態。
- 実装：ファイル一覧からダイジェストを再計算し、指定値と一致すること。実行後のダイジェストも一致し、`changedDuringRun` が false で、変更ファイルがないこと。
- ポリシー：
  - variantは `guarded-body` だけ（kind candidate、head retain、0.004 m、LockBorder+ErrorAbsolute）。
  - overrideなし。
  - ゲートは固定値。
  - 全配信クリップ、fractions 0.33/0.66、stride 1。
- summary内でキーが重複しない。

次のものは拒否する。

- r02、head・診断用の派生、pose無し・stride>1・クリップ制限付きの実行、custom、不合格の状態。
- 古いLODやパック済みシーンの使用。
- couplingあり、またはcoupling記録がないもの。
- summaryのキー記録と、証拠・配信ファイルの不一致。
- 承認したSHAとの不一致。

### 姿勢検査（失敗時は閉じる）

実ソースのGLTFから次の項目を導出し、証拠と照合する。

- シーンが過不足なく順に並び、重複がない。シーンごとに、インスタンス数、スロット総数（インスタンス×プリミティブ）、比較数が一致する。全スロットが「exact positions and indices」で特定されている。
- クリップ：
  - Three GLTFLoader の名前（`name` がなければ `animation_<n>`）。
  - そのシーンを動かす全クリップ。
  - `clipsNotAnimatingThisScene` は r04 と同じ規則。
  - `clipsBeyondMaxClips` は空。
- clipTracks：
  - applicableChannels は、ソースのチャンネルのうち、対象ノードがそのシーンに属するものの数として計算し、記録値と一致すること。
  - 適用トラック数はソース・候補で同じで、その数以上（weightsは複数トラックになり得る）。
- ポーズラベルは rest と「全クリップ@0.33/0.66」の並びとして正確に一致する。
- 縮約プリミティブの集合が完全に一致し、重複がない。各プリミティブのインスタンスが過不足なく、パスとスキンも一致する。
- インスタンスごとの条件：
  - transformEqual。
  - 対応のずれ0。
  - 記録ゲートが 8/24 mm。
  - そのシーンの全ポーズが記録されている。
- 各ポーズの holes/interiors/webbing の全領域：
  - countは正の整数。
  - max/p99/meanは有限の非負数（p99・meanはmax以下）。
  - 欠落・nullは不可。
- サンプル総数はstride 1で、holesはソース頂点数、interiorsはソース三角形数、webbingは候補三角形数×4。各領域の合計は総数と一致する。
- `locked` はholesにだけあり、数はプランの `lockedVertices` と一致し、距離は0。
- 他の全領域に固定ワールドゲート（p99 ≤ 8 mm、max ≤ 24 mm）を適用する。
- `worst` は、各ポーズから r04 の規則で再計算した値と完全に一致する。
- プランの条件：
  - mode reduce、0.004 m、固定フラグ。
  - worldGateMetres 8/24 mm。
  - 0 < localErrorMetres ≤ 0.004。

### バイトからの再計算

- 対応表：一対一で範囲内。
- 残る頂点属性：バイト一致。
- 素材・画像・スキン・逆バインド・クリップ・未変更の形状：一致。
- ID基準の位相：巻き方向・亀裂・非多様体・法線反転・成分。
- インデックスダイジェスト。
- meshoptフィルター：不使用。
- 容量：raw ≤ ソース かつ gzip -6 < ソース。

`checkCandidate` は、問題が1つでもあれば `verification.status` を `failed` にする。

### 範囲

対象は基準の `ordinary` と `startup` の主モデルだけ。

- 衝突・配置・適合に結びつく素材は拒否する。対象は COUPLED_KEYS と、名前に ground / floor / mountain / cave / castle / landmark / water / river / lake / terrain を含むもの。desert-ground・ice-ground・volcanic-ground も含む。
- LOD却下（violet-behemoth など）、パック済みテンプレート、共有ファイル、基準にないキーも拒否する。

### 出力

新しいフォルダにだけ書く。先に staging に `wx` で書き、最後に rename する。

- `models/.../*.opt-<sha16>.glb`
- 変更しないLODの同一バイトのアーカイブ（公開コピーせず、URLも書き換えない）
- `proof/summary-<n>.json` と、キーごとの証拠・対応表
- `manifest.json` と `runtime-index.json`

## 検証（`verify`）

基準が適用中であることと、入力マニフェストを再照合する。

保存済みの全summaryには `summaryProblems` を適用し、さらに次を確認する。

- 実装とポリシーが同じで、キーが重ならない。
- 記録した実装と一致する。`--proof-implementation` を指定すれば、その値とも一致する。
- 範囲内の各キーは、どれか1つのsummaryにだけ含まれる。

各候補は、保存したバイト・証拠・対応表から生成時と同じ検査を行う。記録にないファイルがあれば不合格になる。

ハッシュを書き直した改ざんも拒否する。対象は、ポリシー・実装記録・姿勢証拠・頂点・インデックス・画像・巻き方向・対応表。`--write-report` は合格時だけ verification.json を書き、内容の異なる既存ファイルは上書きしない。

## 採用

`adopt-candidates.mjs --plan --base-adoption=...` で、新しいIDのもとに完全なグラフを1つ作る。

- 基準グラフを複製する。対象外の素材、LOD却下とその証拠、テクスチャ、残す画像、デコーダーもすべて含む。
- 通常モデルは主モデルだけを差し替え、LODの記録はそのまま残す。
- 起動用アクターは次のとおり扱う。
  - LODは空のままにし、元の `clearedLods` と原本記録（stampの `original.lods`）も変えない。
  - `startup` は新しい主モデルを指す。
  - 直前の startup / identicalFullCandidate / farTriangles は `supersedes` に記録する。
  - 2回目以降の差し替えでも同じで、却下済みLOD（原本・候補）は `retired` に残り、配信もコピーもされない。
- 置き換えた主モデルは `retired` と `retiredCandidates` に入れる。アーカイブ元は、それを生成したリビジョン内のファイル。
- 公開コピーは新しい主モデルだけ。

適用・監査・復元とjournalは既存の手順を使う。復元すると、基準の適用後のマニフェストのバイトに戻る。

## コマンド（パスはすべて明示）

```
node scripts/optimize-guarded-assets.mjs generate --base-adoption 20261010-r06-a02 --base-plan-sha256 db0c29cdc80a6cc9ce45080ccd7b6700f61cf5ccad9055d03c920b9a3b6d60bb --proof-summary output/optimization-audit-20261009/lowpoly-high-r04-initial/summary.json --proof-summary output/optimization-audit-20261009/lowpoly-high-r04-remaining/summary.json --proof-implementation c7ee69f6a2c0fd96f159e5356ce75b8cc59389340bc56925ac83691db00b7806 --accept <key>=<sha256>,... --out assets/optimized-runtime/<新ID> --dry-run
node scripts/optimize-guarded-assets.mjs generate ...（同じ引数、--dry-run なし）
node scripts/optimize-guarded-assets.mjs verify --revision assets/optimized-runtime/<新ID> --base-adoption 20261010-r06-a02 --proof-implementation c7ee69f6a2c0fd96f159e5356ce75b8cc59389340bc56925ac83691db00b7806 --write-report
node scripts/optimization/adopt-candidates.mjs --plan --base-adoption=20261010-r06-a02 --revision=assets/optimized-runtime/<新ID> --adoption=<新採用ID> --acceptance=<このリビジョン専用の承認文書> --dry-run
node scripts/optimization/adopt-candidates.mjs --plan ...（同じ引数、--dry-run なし）
node scripts/optimization/adopt-candidates.mjs --apply --adoption=<新採用ID>
node scripts/optimization/adopt-candidates.mjs --audit --adoption=<新採用ID>
node scripts/optimization/adopt-candidates.mjs --restore --adoption=<新採用ID>   # 戻す場合
```

`--accept` に使うのは、自分の証明summaryにしか含まれないキーだけ。片方のsummaryからキーを1つも使わない場合、そのsummaryは渡さない。

## テスト

`tests/optimization-guarded.test.mjs` は一時リポジトリで実行する（`tests/fixtures/guarded/`）。

- 実際の meshoptimizer による縮約を使う。
- 証拠は実際の r04 出力と同じ形式で書く（領域別の統計、stride 1 のサンプル数、worst、ゲート、clipTracks）。起動用アクターは、チャンネル1つのクリップを持つアニメーション付きのグリッド。
- 既定では2つの完全なsummaryに分ける。
- posed値は証明エンジンの代わりの値で、エンジン自体は r04 側で検査している。

検査する内容は次のとおり。

- 成功する一連の流れ：LODを残す通常モデル、LODを消した状態の起動用アクター、対象外のモデルとテクスチャの不変、各summary原本の保存、適用・監査・復元でのバイト一致。
- 範囲外の拒否。
- 複数summaryの不整合（キー重複、ポリシー差、同じsummaryを2回指定、承認キーを提供しないsummary、どのsummaryにもない承認キー）。
- 不正な証拠と姿勢証拠の拒否：数値の改変・null・負値・欠落、サンプル数、領域、locked数、ゲート、worst、シーン・プリミティブ・スロット・スキン、クリップ・チャンネル・トラック・ラベル。
- 保存済みのポリシー・実装記録・姿勢証拠を、ハッシュを書き直したうえで改ざんした場合の拒否。
- `checkCandidate` の状態。
- 容量制限と、未知のレシピ。
- dry-run で何も書かないこと、ID の排他、ずれがあるときの適用停止。
- 起動用アクターの2回目の差し替え：元の clearedLods と原本記録の維持、却下済みLODが復活しないこと、1回目の適用後バイトへの復元。
- 他のレシピの連鎖書き換えが厳格なままであること。

## Codexの独立レビューと実行

Claudeの実装完了時点ではシェル実行を許可していなかったため、以下はCodexが実行した結果である。

- 対象28素材の実GLBで生成・保存後検証・計画・適用・監査が成功した。採用IDは`20261010-r07-a01`、plan SHAは`73870b1350ab872299152473622475f2c5c4d1958e97ec16fe357c444fc0862a`。完全グラフ64モデルのうち28本体だけを置換し、36モデル、既存LODとテクスチャを保持した。
- 保持する頭部の材質番号だけを変えた実GLBをメモリー上で検査したところ、当初の検証器は見逃した。`preservation.mjs`でルート・メッシュ・部品のメタデータ、材質割当、属性集合、未削減部品の属性／morph／indices、アニメーションのsampler数とメタデータ、逆バインドの解釈まで比較するよう修正した。修正後は当該改変を拒否し、正式28候補は合格した。
- 新しい採用テスト11件と保持検査4件が成功した。別途r04証明処理の24テストも成功した。全体テストと実ビルドの結果は作業記録を参照。
- 対象候補を実ChromeとWindows WebKitで読み、顔・首・全身・中間姿勢の画像を確認した。全動作各5時点の残存頂点と元頂点の照合は位置差0だった。

## 検証の限界と対象外

- 保存後の検証器は、実GLBから構造と対象範囲を導出して、保存した表面測定値の整合性と基準を再確認する。高コストの全表面測定そのものを再実行する仕組みではない。承認した候補SHA、凍結した証明エンジンと完成summary、独立した画像・頂点検査を併用する。
- 表面検査は静止と全動作の0.33／0.66時点、ネイティブ頂点検査は各5時点であり、全フレームではない。GLB外の配置倍率・当たり判定、物理スマートフォンや実Safariの性能を保証しない。
- 外観を保留したyellow-524-mascotの既定／custom、orb-bot-triangleは採用していない。地面・洞窟・山など、形状が衝突や配置と結びつく素材も今回の採用対象外。
