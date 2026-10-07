# CRO-MAGNON 作業ルール

このファイルは毎セッション読み込まれる恒久ルールだけを置く。作業の記録はここに積まず、`docs/changelog/YYYY-MM.md` の先頭へ日付付きで追記する（2026-10-07にそれまでの223項目を [2026-09](docs/changelog/2026-09.md)・[2026-10](docs/changelog/2026-10.md) へ移した）。機能ごとの設計・検証の記録は `docs/history/`、モデルと機能の制作記録は `assets/**/README.md`、日付付きの作業記録は `docs/*-YYYY-MM-DD.md`。索引は [docs/README.md](docs/README.md)。

## 現在の方針

- ゲーム全体の方向は [GAME_IMPROVEMENT_PLAN.md](GAME_IMPROVEMENT_PLAN.md)（2026-10-07）。BotW／TotKのようにローポリで世界観を出す。画質選択はなくし、現在の「軽量」を唯一の画質・30fpsで統一する。スマートフォンで動くことを前提に予算を決める。初期読込は自分の人物と出発地点の周囲だけで準備完了にし、残りは距離順に後続で読む。
- 残っている課題は [FUTURE_WORK.md](FUTURE_WORK.md)。過去の記録にある「次に行う」「残る」を根拠に作業を自動継続しない。再開の指示を受けてから対象・順序・仕様を決める。明示して削除した仕様（自動移動・遠征・手帳・航路案内・手認識入口など）は将来作業として復活させない。
- 世界観・時代設定の調査は [WORLD_SETTING_PLAN.md](WORLD_SETTING_PLAN.md)。農耕・三つの国・ネアンデルタール人の共存は意図的なファンタジーとして残す。
- 性能の改善は、再現→状態と画面の観測→原因の修正→同条件の再検証。準備用の状態設定と実操作の検証を区別し、性能の主張には対象・環境・変更前後の数値を添える。常時60fps・実スマホ・物理パッドなど未検証の条件は記録に明記する。

## 進め方

- 必要なもの以外の確認依頼は省略し、こちらで実行できる診断・検証・許可済み作業は自律的に進める。確認のためだけにユーザーの手作業を繰り返し求めない。
- 「MD更新」や方針の記録だけを根拠に、モデル生成ジョブ、サーバーの再起動、外部公開、SNS投稿、展示配布を開始しない。これらはユーザーの明示的な指示で行う。
- 他のセッションが同じリポジトリを同時に編集している。見慣れない差分を `git checkout`／reset で消さず、別作業の変更は保持する。commit／pushはユーザーが指示したときだけ行う。
- ローカルの通常3000番（dev）・MMOの8787・展示4173は、停止・再起動・保存の再適用をユーザーの指示なしに行わない。反映するときは直前の保存を控え、配信物のSHAとhealth／statusを照合して記録する。
- ユーザーの保存データ（`.cro-magnon-save/`）を手で編集しない。古いチェックポイントを再適用しない。
- 変更後は関連テスト、`npm run check`（型・strict・JS構文・依存境界）、書式、必要なら実Chromeの `scripts/qa-*.mjs` を実行し、合格・失敗・未検証を分けて記録する。

## 3Dモデル制作

ユーザー指定: **生き物に限らず、全3DモデルをCodexが参照画像とTRELLISのimage-to-3D方式で制作する。Claudeは使用しない。必要なリギングとアニメーションまで含める。**（2026-09-06の指示「claude 停止したので、代わりにあなたがやって」以降、制作はこのリポジトリの作業者が引き継ぐ。既存の制作物と制作系統は保持する。）

モデルを新規作成・交換・大幅修正するときは、先に [ASSET_WORKFLOW.md](ASSET_WORKFLOW.md) を読む。実行方式と品質基準は隣の `../threed-model-creation` リポジトリを参照する。生き物のリグ・アニメーションを制作・修正するときは [CREATURE_MOTION_GUIDE.md](CREATURE_MOTION_GUIDE.md) も読む。再制作の経緯と制約は `docs/asset-remake/`。

- 対象は人物、動物、植物、岩、地形、建築物、橋、焚き火の構成物、道具、装備、資源など、ゲーム中の全可視3Dモデル。
- `参照画像 → TRELLIS-2 dense mesh → 形状を保った軽量化／補修 → UV・材質・構造 → 必要なrig／animation → exact GLB QA` の系統を維持する。参照画像はCodex CLIの内蔵 `image_gen` で作る（このPCに他の画像生成手段はない）。
- Three.jsやBlenderのプリミティブ、曲線、Geometry Nodes等で可視モデルを一から組み立てて、TRELLIS由来の完成品の代わりにしない。静物にも同じルールを適用する。
- 検証済みGLBだけを読み込み、読み込み失敗時はエラーで描画を止める。旧モデルや別モデルへのフォールバック、未読込時のプリミティブ代用を追加しない。
- 変形する生き物には骨格・スキンウェイト・アニメーションクリップを用意する。静物に不要な骨は付けない。
- カメラ、照明、不可視の当たり判定、配置、LOD、物理、GLB再生、水や火のシェーダー／粒子などの実行時制御はコードで実装できる。これを理由に可視モデルの制作工程を省略しない。
- 完成候補を上書きせず、修正は同じ候補内の別revisionとして保持する。旧GLBは残し、新GLBは別名で採用する。元画像・dense・失敗版・Blender・QAを制作フォルダーへ保存し、SHAを記録する。
- 配信するGLBの外観・材質・スケール・向き・リグ・クリップを検証し、実Chromeと5人接続で確認する。生成、採用、組み込みの状態を混同しない。
- 画質方針（上記）により、新しい素材は1024px以下の画像と中距離LODを前提に作る。高解像度化はしない。

## 展示の継続運用：PC0・PC1・PC2・PC3を同じ最新版へ（2026-09-22 ユーザー指定）

ゲームを変更した場合、PC1／PC2に加えて、PC0と予備PC3の `C:\Users\Public\CRO-MAGNON\releases` にも同じ検証済みオフラインビルドを配布する。通常はPC1ホスト・PC2クライアントだけを起動し、PC0／PC3は最新版を保持して待機する。PC3はPC1またはPC2の代行、PC0はPC1の代行。展示には既存の標準Windowsユーザー `CRO-MAGNON` を使う。固定IPはPC0=.3、PC1=.1、PC2=.2、PC3=.4（10.10.10.0/24）。

現行手順は `README-EXHIBITION.md`、機体一覧は `exhibition-fleet.json`。必要な検証後に `scripts/exhibition-fleet.ps1 -Action Deploy` で同じZIPを4台へ配り、各PCの展開済み全ファイルSHA・ビルドIDと起動対象の実動作を確認する。1台でも未接続・権限不足・未設定なら未完了の台を明示し、全台完了を主張しない。切り替えによるプレイ中断は体験の区切りで行い、待機機は不用意に起動しない。

展示中のPC1／PC2に管理者確認・権限確認を出さない。SSH配布・診断・起動は標準ユーザーで行い、権限不足でも自動昇格せずPC0側へエラーを返す。UACやFirewallの無効化、展示ユーザーの管理者化で回避しない。Public ACL・SSH・TCP8081許可・起動タスクは開場前のローカル初期設定で済ませ、初期設定が必要な実機はその旨を報告する。PC1はPS4、PC2はSwitch Proのボタン表記（`exhibition.env`）。展示版は2人・1日目表示・チャットなし・保存なし。この方針は公開サイトへのデプロイを許可するものではない。

## 公開（Cloudflare）と料金

ユーザー指定：月額$5の基本料は必要なら払ってよいが、従量課金は払わない。公開MMOは専用アカウントのWorkers Free（`cromagnonmmo.cro-magnon.workers.dev`、Static Assets＋SQLite Durable Object、EMBERの1部屋・最大5人）。PaidへのアップグレードやR2等の従量課金サービスを追加しない。公開ビルドはまるぃもを除外しクレジットは公開版。手順は [CLOUDFLARE_DEPLOYMENT.md](CLOUDFLARE_DEPLOYMENT.md)。デプロイはユーザーの明示的な指示でのみ行う。

## 表示・操作で保持する指定

- タイトルはロゴ画像・「はじめる」「関わってくれた人たち」。名前・QR・壁画の人物リンクは `x.com/<handle>` 形式のみで、展示ビルドはQRのままリンクなし。
- 読む操作説明は置かず、プレイ中の入力図とキー表示だけ。状況別の行動は最大3つ。
- コントローラーは右側4ボタンの上（△）がジャンプ、下（×）が乗降・メニューでは戻る。PS4／Switch Proは設定で表記だけ変える。
- 洞窟内は攻撃・投擲禁止、松明だけの手持ち。
- スマホは縦持ちの半透明パッドと直接操作ボタン、会話は下端のダイアログ。視点は自動追従＋なぞって調整。
- ローカル版の非表示人物は直下 `local-visibility.json`（mae・maruimo・howkey）。素材は削除しない。

## 動画の制作・同期の安全規則（Video Timing And Synchronization Safety）

These rules apply only to video/audio creation, editing, rendering, assembly,
and publication. Preserve this repository's existing scope and stricter rules;
this section does not authorize unrelated code changes or publication.

- Keep source time, edited output time, camera offsets, frame positions, and
  audio sample positions separate. Check source coverage in source time; never
  cap it with the shortened output duration.
- Probe the actual selected video/audio streams, including their start times,
  endpoints, time bases, frame rates, and sync offsets. Container/manifest
  duration or a longer audio stream does not establish valid video coverage.
- Validate every resolved source interval after edits, offsets, restoration,
  and camera fallback. Reject missing or unverified coverage before rendering.
- Use a verified synchronized alternate camera when the selected camera ends.
  If none covers the interval, stop with an error; do not continue on a warning.
  Do not conceal missing footage with truncation, `-shortest`, frozen frames,
  silence, or an arbitrary audio delay. Padding requires an explicit edit.
- Derive expected duration from the validated edit plan, not an older export.
  For constant-frame-rate delivery, use the exact rational frame rate and one
  global integer-frame schedule; derive section lengths from shared boundaries.
  Align audio samples, captions, and overlays with it; handle VFR explicitly.
- Validate each rendered section's planned frame count and audio coverage before
  assembly. Stop on unexpected shortening instead of shifting later picture.
- Preserve a common presentation-time origin at joins, accounting for decode
  pre-roll and audio priming. Verify stream-copy/keyframe compatibility and run
  a short join smoke test before full assembly.
- Compare the final decoded frame count/duration against the edit plan. Define
  tolerances using frame rate, sample rate, and codec priming, not arbitrary
  seconds. Encoder success, full decode, or equal A/V length is not sync proof.
- Verify rendered picture and delivered sound directly against original source
  frames/recordings with the planned offsets. Old-export comparisons establish
  preservation only. Check every camera/offset region, changed joins, recording
  endpoints, and the ending; use audio windows that do not cross edit cuts.
- Silence or weak correlation is inconclusive, not a pass. Clearly distinguish
  automated sampling from full manual viewing/listening.
- Produce a lightweight preview first and obtain user acceptance before the
  production render. Publish only after coverage, timing, source-based sync,
  and visual QA pass. This rule does not authorize uploading or replacing files.
- Preserve the plan/config, probes, offsets, commands, expected/actual counts,
  fallback decisions, and QA in the project's established report directory.
  Revalidate reused intermediates against matching input/plan provenance.
- Add regression tests for EOF after cuts, valid fallback, no available source,
  uncut timelines, and inserted-card mapping. Timing/splice changes require a
  join preview. Documentation is a required procedure, not proof that a
  repository already implements these checks automatically.

### Why These Rules Exist

In the 2026-10-05 engineer-type delivery, a close-up requested 0.825967 seconds
beyond its actual video endpoint. Picture shortened while external dialogue
continued, making the final wide shot about 0.8 seconds early. The coverage
checker mixed source/output time and continued without a fallback; QA compared
against an already defective export. This was a render/verification failure,
not an upload-service issue. Never use an old export as the only sync baseline.
