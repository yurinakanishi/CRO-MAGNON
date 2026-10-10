# docs 索引

2026-10-07にルートのMarkdownを整理した。現在の仕様と方針はルートの文書、作業記録はここ。

## ルートに残した文書

| 文書 | 役割 |
| --- | --- |
| [AGENTS.md](../AGENTS.md) | 恒久ルール（制作・進め方・展示・公開） |
| [README.md](../README.md) | ゲームの現在の仕様と起動方法 |
| [GAME_IMPROVEMENT_PLAN.md](../GAME_IMPROVEMENT_PLAN.md) | 現在の方針（ローポリ・画質固定・スマホ・段階読込） |
| [FUTURE_WORK.md](../FUTURE_WORK.md) | 将来の対応一覧 |
| [WORLD_SETTING_PLAN.md](../WORLD_SETTING_PLAN.md) | 世界観・時代設定の調査 |
| [ASSET_WORKFLOW.md](../ASSET_WORKFLOW.md) | 3Dモデル制作の手順 |
| [CREATURE_MOTION_GUIDE.md](../CREATURE_MOTION_GUIDE.md) | 生き物の動きの制作指針 |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | コード構成と依存境界 |
| [CLOUDFLARE_DEPLOYMENT.md](../CLOUDFLARE_DEPLOYMENT.md) | 公開（Cloudflare）の手順と料金条件 |
| [README-EXHIBITION.md](../README-EXHIBITION.md) | 終了した展示の運用（4台）・基本起動の保存記録。通常更新時のビルド・配布義務は終了 |
| [README-EXHIBITION-SETUP.md](../README-EXHIBITION-SETUP.md) | 終了した展示の初期設定・SSH・配布・安全対策の保存記録 |
| [README-LOCAL.md](../README-LOCAL.md) | 持ち運び版の説明 |

## 作業記録（月別）

- [2026-09](changelog/2026-09.md)
- [2026-10](changelog/2026-10.md)

新しい作業はこれらの先頭へ日付付きで追記する。

## 機能ごとの設計・検証の記録（`docs/history/`）

実装済みの機能の当時の計画と検証。現在の仕様はREADMEとゲームガイドが正。

| 文書 | 題名 |
| --- | --- |
| [guarded-asset-adoption.md](history/guarded-asset-adoption.md) | 承認したローポリ本体だけを採用する検証・履歴保持（2026-10-10） |
| [BARTER_PLAN.md](history/BARTER_PLAN.md) | 集い場での物々交換 |
| [CARRY_SUPPORT_PLAN.md](history/CARRY_SUPPORT_PLAN.md) | 肩乗り中の支えと対象表示（2026-09-09） |
| [CASTLE_STAIRS_FIX.md](history/CASTLE_STAIRS_FIX.md) | 中央階段の上がり口の移動 |
| [CHARACTER_SWITCH_PLAN.md](history/CHARACTER_SWITCH_PLAN.md) | その場でキャラクターを切り替える |
| [COASTAL_CRAFT_PLAN.md](history/COASTAL_CRAFT_PLAN.md) | 貝の暮らしと黒曜石の道具 |
| [COLLISION_FACING_FIX.md](history/COLLISION_FACING_FIX.md) | 衝突時にプレイヤーの向きが変わる不具合 |
| [CREATURE_MOTION_REVIEW_PLAN.md](history/CREATURE_MOTION_REVIEW_PLAN.md) | 既存キャラクターの全動作見直し |
| [CROP_EXPANSION_PLAN.md](history/CROP_EXPANSION_PLAN.md) | 共同畑の作物と炉の食事 |
| [DOWNED_MOTION_PLAN.md](history/DOWNED_MOTION_PLAN.md) | 力尽きたときに膝から崩れる動作 |
| [EXHIBITION_LAN_PLAN.md](history/EXHIBITION_LAN_PLAN.md) | Exhibition / LAN mode |
| [FISHING_PLAN.md](history/FISHING_PLAN.md) | Fishing in Three Shores |
| [GIANT_APE_PLAN.md](history/GIANT_APE_PLAN.md) | 巨腕の大猿 制作・追加計画 |
| [HOUSEHOLD_JOURNEYS_PLAN.md](history/HOUSEHOLD_JOURNEYS_PLAN.md) | 世帯の旅と集い場での滞在 |
| [JUMP_PLAN.md](history/JUMP_PLAN.md) | キャラクターのジャンプ |
| [LOCAL_SAVE_PLAN.md](history/LOCAL_SAVE_PLAN.md) | 通常サーバーの自動保存と再開 |
| [MANUAL_MOVEMENT_PLAN.md](history/MANUAL_MOVEMENT_PLAN.md) | 自分で移動し、近くで操作する |
| [MAP_PINS.md](history/MAP_PINS.md) | 地図の共有ピン |
| [MAP_UI_PLAN.md](history/MAP_UI_PLAN.md) | 地図とワープの操作を整理する |
| [MOVEMENT_SMOOTHING_PLAN.md](history/MOVEMENT_SMOOTHING_PLAN.md) | 歩行・走行のかくつきとちらつきの修正 |
| [PLAYTEST_FEEDBACK_PLAN.md](history/PLAYTEST_FEEDBACK_PLAN.md) | 試遊フィードバック 8 項目のレビューと詳細設計 |
| [QUIET_ACTIONS_CARRY.md](history/QUIET_ACTIONS_CARRY.md) | 操作注意の抑制と移動中の肩乗り（2026-09-10） |
| [README-EXHIBITION-NOW.md](history/README-EXHIBITION-NOW.md) | 展示LAN：この2台の起動手順と確認記録 |
| [RESIDENT_FORAGING_PLAN.md](history/RESIDENT_FORAGING_PLAN.md) | 住人の採集を炉の夕食へつなげる |
| [RESIDENT_SUPPER_PLAN.md](history/RESIDENT_SUPPER_PLAN.md) | 住人が炉で分け合う夕食 |
| [RESIDENT_WATERING_PLAN.md](history/RESIDENT_WATERING_PLAN.md) | 住人へ畑の水やりを頼む |
| [SABERTOOTH_PLAN.md](history/SABERTOOTH_PLAN.md) | Sabre-toothed cat enemy |
| [SHARED_PANTRY_PLAN.md](history/SHARED_PANTRY_PLAN.md) | 共同の食料置き場 |
| [SHOULDER_CARRY_PLAN.md](history/SHOULDER_CARRY_PLAN.md) | 大猿の歩幅・速度と肩乗り |
| [SHOULDER_MAGIC.md](history/SHOULDER_MAGIC.md) | 大猿の肩から魔法攻撃 |
| [TERRITORIAL_MONSTER_PLAN.md](history/TERRITORIAL_MONSTER_PLAN.md) | Territorial purple monster |
| [TITLE_CREDITS_PLAN.md](history/TITLE_CREDITS_PLAN.md) | タイトルの画像とクレジット |
| [VILLAGE_LIFE_PLAN.md](history/VILLAGE_LIFE_PLAN.md) | 三つの国と集い場の住人 |
| [WARP_POINTS_PLAN.md](history/WARP_POINTS_PLAN.md) | 焚火のワープポイント |
| [WEATHER_CURRENT_PLAN.md](history/WEATHER_CURRENT_PLAN.md) | 湾の天候と海流 |
| [WORLD_EXPANSION_PLAN.md](history/WORLD_EXPANSION_PLAN.md) | Four-area expansion of Three Shores |
| [WORLD_LABELS.md](history/WORLD_LABELS.md) | 頭上の文字と戦闘HPバー（2026-09-10） |

## 日付付きの作業記録・手順（`docs/`）

| 文書 | 題名 |
| --- | --- |
| [524-bond-2026-10-02.md](524-bond-2026-10-02.md) | 524の仲間状態を期限なく保持する |
| [524-cave-frieze-2026-10-06.md](524-cave-frieze-2026-10-06.md) | 524を動物の壁画へなじませる（2026-10-06） |
| [524-dots-2026-10-02.md](524-dots-2026-10-02.md) | 524を撫で終えるとdotsの仲間へ追加 |
| [524-offline-home-2026-10-03.md](524-offline-home-2026-10-03.md) | 524がキャンプにいない問題の修正 |
| [actor-shadows-2026-09-21.md](actor-shadows-2026-09-21.md) | 生き物の箱状の影を形に沿う影へ修正 |
| [assisted-controls-2026-10-05.md](assisted-controls-2026-10-05.md) | 自動視点と手操作の試作（2026-10-05） |
| [astra-creature-3d-quality-2026-10-02.md](astra-creature-3d-quality-2026-10-02.md) | Codex Astraで人物・動物の3D品質を上げるための調査 |
| [beginner-ui-2026-10-05.md](beginner-ui-2026-10-05.md) | 初心者向けの完全自動視点と手操作UI（2026-10-05） |
| [boat-crafting-menu-2026-10-06.md](boat-crafting-menu-2026-10-06.md) | 丸木舟の製作をクラフト画面へ統一 |
| [boat-inventory-2026-10-06.md](boat-inventory-2026-10-06.md) | 航路案内の撤去と、持ち運べる丸木舟 |
| [bot-facing-2026-10-02.md](bot-facing-2026-10-02.md) | 呼び戻したdotsの集合後の向きを修正 |
| [bot-gestures-2026-10-02.md](bot-gestures-2026-10-02.md) | 2026-10-02 botを投げる・呼ぶ人物アニメーション |
| [bot-group-petting-2026-10-03.md](bot-group-petting-2026-10-03.md) | botたちをまとめて1回で撫でる |
| [bot-spin-2026-10-02.md](bot-spin-2026-10-02.md) | dotsと524の投擲中の1回転 |
| [bot-volley-2026-10-02.md](bot-volley-2026-10-02.md) | botを1ボタンで順番に投げ、呼ぶまで待機 |
| [cave-entrance-seam-2026-10-07.md](cave-entrance-seam-2026-10-07.md) | 洞窟入口と山の隙間を修正（2026-10-07） |
| [cave-foothill-2026-10-06.md](cave-foothill-2026-10-06.md) | アプデの洞窟を右奥の山へ一体化（2026-10-06） |
| [cave-hill-2026-10-05.md](cave-hill-2026-10-05.md) | アプデの洞窟を覆う丘（2026-10-05） |
| [cave-torch-2026-10-02.md](cave-torch-2026-10-02.md) | 暗い洞窟と手持ちの松明 |
| [cave-torch-hold-2026-10-03.md](cave-torch-hold-2026-10-03.md) | 松明を持つ腕・手首・握りと柄の太さ |
| [cave-torch-only-2026-10-06.md](cave-torch-only-2026-10-06.md) | 洞窟内の攻撃禁止と松明だけの手持ち（2026-10-06） |
| [cloudflare-public-release-2026-10-01.md](cloudflare-public-release-2026-10-01.md) | Cloudflare公開版・2026-10-01 |
| [companion-closeup-2026-10-03.md](companion-closeup-2026-10-03.md) | 仲間を近くで見る |
| [dot-friendship-2026-10-02.md](dot-friendship-2026-10-02.md) | dotsを撫でて仲間にする |
| [dots-layout-2026-10-03.md](dots-layout-2026-10-03.md) | dotsの初期配置を自然な集まりへ |
| [dots-rejoin-2026-10-03.md](dots-rejoin-2026-10-03.md) | 再参加後にdotsが見えなくなる問題 |
| [environments-2026-10-06.md](environments-2026-10-06.md) | ローカル検証・展示・MMOの分離 |
| [exhibition-fleet-2026-09-22.md](exhibition-fleet-2026-09-22.md) | 2026-09-22 展示4台への移行記録 |
| [exhibition-menu-2026-09-22.md](exhibition-menu-2026-09-22.md) | 展示メニューの整理（2026-09-22） |
| [exhibition-simple-2026-09-22.md](exhibition-simple-2026-09-22.md) | 展示の交易案内を非表示にして全変更を反映 |
| [exhibition-update-2026-09-23.md](exhibition-update-2026-09-23.md) | 2026-09-23 全変更の統合と展示更新 |
| [game-guide.md](game-guide.md) | CRO-MAGNON ゲームガイド |
| [hand-video-2026-10-05.md](hand-video-2026-10-05.md) | 左手の提供動画による移動検証（2026-10-05） |
| [howkey-delivery-2026-09-28.md](howkey-delivery-2026-09-28.md) | Howkeyのローカル実装と展示用ビルド |
| [howkey-visibility-2026-10-03.md](howkey-visibility-2026-10-03.md) | ローカル版のHowkeyさんを切替可能な非表示へ |
| [input-cues-2026-10-03.md](input-cues-2026-10-03.md) | 操作説明を読む画面から、プレイ中の入力図へ |
| [kohaku-2026-10-04.md](kohaku-2026-10-04.md) | こはくちゃん — りもねこと同じ大きさのマスコット |
| [local-visibility-2026-10-03.md](local-visibility-2026-10-03.md) | ローカル版のキャラクター表示設定 |
| [low-spec-public-2026-10-02.md](low-spec-public-2026-10-02.md) | 公開版の軽量化（2026-10-02） |
| [mae-2026-10-03.md](mae-2026-10-03.md) | mae — 丸い袋のペット |
| [mammoth-ground-2026-09-22.md](mammoth-ground-2026-09-22.md) | マンモスを崖へ登らせない（2026-09-22） |
| [git-integration-2026-10-08.md](git-integration-2026-10-08.md) | リモートmainとローカル変更の統合 |
| [loading-cave-2026-10-07.md](loading-cave-2026-10-07.md) | 開始後に歩けるローディング洞窟 |
| [maruimo-mascot-2026-10-07.md](maruimo-mascot-2026-10-07.md) | まるぃもを仲間と洞窟壁画へ追加 |
| [meshmell-upload.md](meshmell-upload.md) | Meshmell CLI アップロード手順 |
| [mmo-deploy-2026-10-06.md](mmo-deploy-2026-10-06.md) | MMO公開版を更新（2026-10-06） |
| [mobile-chat-journal-removal-2026-10-06.md](mobile-chat-journal-removal-2026-10-06.md) | スマホの会話と手帳の撤去（2026-10-06） |
| [mobile-start-screen-2026-10-07.md](mobile-start-screen-2026-10-07.md) | スマホの開始画面を縦持ちへ合わせる |
| [mountain-river-2026-10-01.md](mountain-river-2026-10-01.md) | 山から既存の川へつながる渓流と滝 |
| [nature-audio-only-2026-10-06.md](nature-audio-only-2026-10-06.md) | 自然音と場所別BGMだけを残す変更 |
| [nature-audio-quality-plan.md](nature-audio-quality-plan.md) | 自然音の品質改善 — 2026-10-06 |
| [nature-audio-soft-foley-plan.md](nature-audio-soft-foley-plan.md) | 風・川を控えめにし、効果音を素材から作り直す |
| [nature-immersion-plan.md](nature-immersion-plan.md) | 自然の没入感を高める実装計画 |
| [orb-bots-2026-10-01.md](orb-bots-2026-10-01.md) | 画像の5色bot：調査・制作・操作 |
| [pacific-island-removal-2026-09-22.md](pacific-island-removal-2026-09-22.md) | 太平洋の架空島の撤去（2026-09-22） |
| [performance-geometry-2026-09-21.md](performance-geometry-2026-09-21.md) | 敵・人物・野営地の距離LODと簡易影（2026-09-21） |
| [performance-investigation-2026-09-19.md](performance-investigation-2026-09-19.md) | 2026-09-19 カクつきの原因調査と改善 |
| [performance.md](performance.md) | 描画負荷の改善 |
| [optimization-audit-2026-10-09.md](optimization-audit-2026-10-09.md) | 軽量化とスマホ対応の初期監査と変更前測定 |
| [optimization-codex-2026-10-10.md](optimization-codex-2026-10-10.md) | Codexが引き継いだ読込・描画改善、実パッケージ検証、未達と実機の限界 |
| [optimization-startup-2026-10-10.md](optimization-startup-2026-10-10.md) | r08の初期読込修正、実タッチの開始→採集、5秒未達と残る素材量 |
| [optimization-assets-lowpoly-2026-10-10.md](optimization-assets-lowpoly-2026-10-10.md) | Opus 5.5 Highによる素材軽量化、候補の独立検査と不採用・修正記録 |
| [pet-on-start-2026-10-03.md](pet-on-start-2026-10-03.md) | 撫で始めた時点でなつく |
| [rimo-cave-mural-2026-10-02.md](rimo-cave-mural-2026-10-02.md) | りもねこの壁画を524の反対側へ復活（2026-10-02） |
| [rimo-neko-c2-adoption-2026-10-02.md](rimo-neko-c2-adoption-2026-10-02.md) | りもねこ：C2表面01をゲームへ採用 |
| [rimo-neko-delivery-2026-09-28.md](rimo-neko-delivery-2026-09-28.md) | りもねこのローカル実装と展示配布 |
| [rimo-neko-happy-delivery-2026-09-30.md](rimo-neko-happy-delivery-2026-09-30.md) | りもねこの撫で終わりの仕草とハート |
| [rimo-neko-straightening-2026-10-03.md](rimo-neko-straightening-2026-10-03.md) | りもねこの首と尻尾の向きを修正 |
| [shape-bots-2026-10-01.md](shape-bots-2026-10-01.md) | 追加画像の4種類のbot |
| [single-hand-controls-2026-10-05.md](single-hand-controls-2026-10-05.md) | 右手／左手だけで遊ぶ（2026-10-05） |
| [threejs_upper_body_motion_codex_prompt.md](threejs_upper_body_motion_codex_prompt.md) | Three.js製MMOに「上半身だけのカメラ操作」を追加する |
| [contributors-cave-visit-2026-10-09.md](contributors-cave-visit-2026-10-09.md) | 紹介ダイアログの壁画画像・注釈を撤去し、洞窟へ直接ワープ |
| [title-mural-2026-10-07.md](title-mural-2026-10-07.md) | ホーム画面を洞窟の壁画中心に（MMO）／展示はQRクレジットを維持 |
| [touch-portrait-2026-10-06.md](touch-portrait-2026-10-06.md) | スマホ縦持ちのタッチ操作（2026-10-06） |
| [trellis-update-2026-09-27.md](trellis-update-2026-09-27.md) | TRELLIS実行環境の更新 — 2026-09-27 |
| [trellis-update-2026-10-02.md](trellis-update-2026-10-02.md) | TRELLIS実行環境をこのPCでv0.8.1へ更新（2026-10-02） |
| [update-cave-2026-10-05.md](update-cave-2026-10-05.md) | アプデの洞窟（2026-10-05） |
| [warp-menu-all-modes-2026-10-02.md](warp-menu-all-modes-2026-10-02.md) | 全モードの「ワープする」メニュー |
| [whistle-rimo-2026-10-03.md](whistle-rimo-2026-10-03.md) | 0匹からの笛による集合と、りもねこの投擲 |
| [wording-corrections-2026-09-15.md](wording-corrections-2026-09-15.md) | 文言の修正一覧（2026-09-15） |

## サブフォルダー

- [asset-remake/](asset-remake/PROGRESS.md)：全3Dアセット再制作の経緯・一覧・計画
- [motion-controls/](motion-controls/)：カメラによる上半身操作の実装記録
- `assets/**/README.md`：モデル・機能ごとの制作記録（ルートの `assets/`）
