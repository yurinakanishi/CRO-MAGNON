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

SNSシェア: [2026-10-24 タイトル・アプデの洞窟・メニューのシェアボタン](share-links-2026-10-24.md)。X・Instagram・Facebook・リンクのコピー。プレイ中はHUDに置かずメニューの「シェア」タブ。日英ページの正規URL・OGP画像も cromagnonmmo.com に変更。ローカルで検証済み、公開反映は未実施。

検索・計測：[2026-10-23 GA4専用プロパティ・Search Console所有権確認と連携、robots/サイトマップ](analytics-search-2026-10-23.md)。同日09:08 JSTに公開。サイトマップSuccess・4ページ、GA4のHTTP 204とRealtime受信を確認済み。

最新の公開: [2026-10-23 10:49 JST 洞窟の人物・仲間の昼の光を公開](daylight-release-2026-10-23.md)。追加記録をamendし、`7771c74` をpush後、Free契約を実確認して検証済み成果物をそのまま公開。1,863テスト、公開789ファイルのSHA、PC／タッチ7項目が合格。[同日09:08の計測・検索設定と壁画r44の公開](seo-release-2026-10-23.md)。

黒曜石: [2026-10-22 西アジアの火山地帯に黒曜石の露頭を3つ](changelog/2026-10.md#2026-10-22-西アジアの火山地帯に黒曜石の露頭を3つ)。同日公開・検証済み。焚き火の南、石と木の山の隣で、その場で刃と槍を作れる。景観は不変。

採集と槍: [2026-10-22 大猿の採集と、大猿・魔法使いの槍づくり](changelog/2026-10.md#2026-10-22-大猿の採集と大猿魔法使いの槍づくり)。同日公開・検証済み。大猿が全59か所の木・石の山から採れるようにし、自分の攻撃を持つ人物の槍は持ち物に「持てません」として入る。実Chromeの9項目が合格。

以前の公開: [2026-10-19 タイトル画像・採集判定・焚き火納品廃止](title-gather-camp-deploy-2026-10-19.md)。12:12 JSTに公開。1,851テスト、公開770ファイルのSHA、PC／スマホ相当の木材・石の操作案内と焚き火納品案内の消失を確認。[実装と再現](title-gather-camp-2026-10-18.md)。

以前の公開: [2026-10-18 洞窟の照明・開始ボタン・PC操作UI](cave-ui-deploy-2026-10-18.md)。00:07 JSTに公開。1,851テスト、公開771ファイルのSHA、PC操作9項目・5種類の洞窟照明・ソロ7項目を確認。

洞窟の照明と開始ボタン: [2026-10-17 顔の暗さ・松明の白飛びを抑制](cave-face-lighting-2026-10-17.md)。柔らかな補助光と松明の近接光を調整し、開始ボタンを「ゲームを始める」へ変更。人物の光は2026-10-23に外の昼の光へ置き換え。2026-10-18に公開済み。

以前の公開: [2026-10-17 キャンプ付近の地形の継ぎ目を修正](camp-terrain-seams-2026-10-17.md)。14:14 JSTに公開。草原と山の模様・道の色・地面上端の光の当たり方を統一。1,849テスト、公開771ファイルのSHA、公開ChromeのPC／スマホ相当での地形表示と歩行を確認。

以前の公開: [2026-10-17 選択中の仲間カードを金色の背景へ変更](mascot-selection-colors-2026-10-17.md)。11:25 JSTに公開。開始前・仲間メニュー・横送り一覧の選択色、文字コントラスト、ホバー・キーボード操作をPC／スマホ相当で確認。1,847テスト、全配信SHA・通常ソロ7項目・仲間15項目・初回11匹描画も合格。[09:24の対象選択・読込修正](companion-picker-deploy-2026-10-17.md)、[08:01の公開](companions-deploy-2026-10-17.md)、[先行準備と当時の確認待ち](companions-release-2026-10-17.md)も履歴として保持。

仲間の対象選択と読み込み: [2026-10-17 一覧は選択だけ・外側タップで閉じる・洞窟中に全員を準備](companion-picker-loading-2026-10-17.md)。2026-10-17 09:24 JSTに公開し、公開URLでも操作と初回描画を検証済み。

PCの入力UI: [2026-10-17 マウス・キーボード向けの文字付き行動ボタン](changelog/2026-10.md#2026-10-17-pcのマウスキーボード操作を文字付きボタンへ変更)。2026-10-18に公開し、10月22日の公開でも検証済み。「撫でる」「近くで見る」・基本行動・メニュー入口をクリックできる表示へ整理。関連58テストとChromeの9項目が合格。

以前の公開準備: [2026-10-17 仲間の複数選択・カメラ・dot表記・肉球アイコン](companions-release-2026-10-17.md)。当時の一括検証と追加Chrome12項目は合格。内容は新しい10月22日候補で公開済み。

仲間を見るカメラ: [2026-10-16 地面際で真下を向く問題と仲間の足元を修正](companion-ground-camera-2026-10-16.md)。2026-10-17 08:01 JSTに公開し、10月22日の公開でも検証済み。

ソロの仲間: [2026-10-16 複数選択・全選択／全解除・横送りのターゲット・連続投げ](solo-mascots-2026-10-16.md)。2026-10-17 08:01 JSTに公開し、10月22日の公開でも検証済み。

洞窟の壁画: [2026-10-22 Jank0vicさんの顔の周りに、横がそろった「！」を64個並べる（素材r44）](../assets/camp-cave/jank0vic-exclaim-r44/README.md)・[参照と配信素材の一覧](../assets/camp-cave/jank0vic-exclaim-r44/qa/index.html)。未公開。[2026-10-22 Jank0vicさんを写真に似せた正面の顔だけに描き直し（素材r43）](../assets/camp-cave/jank0vic-face-r43/README.md)・[参照と配信素材の一覧](../assets/camp-cave/jank0vic-face-r43/qa/index.html)。未公開。[2026-10-22 Jank0vicさんを東壁の奥に追加（素材r42、全25体）](../assets/camp-cave/jank0vic-r42/README.md)・[参照と配信素材の一覧](../assets/camp-cave/jank0vic-r42/qa/index.html)。同日22:48 JSTに公開・検証済み。[2026-10-16 原画の特徴を7体で修復し、全24体を比較](../assets/camp-cave/identity-r41/README.md)・[原画と変更前後の一覧](../assets/camp-cave/identity-r41/qa/index.html)。[共通縮尺と上下の重なり](../assets/camp-cave/layered-r40/README.md)、[両壁の連続配置と新キャラの自動配置](cave-mural-continuity-2026-10-16.md)を継承。[10月16日の公開記録](mural-deploy-2026-10-16.md)。[今後の追加手順](../assets/camp-cave/continuous-r39/README.md)。

- [2026-09](changelog/2026-09.md)
- [2026-10](changelog/2026-10.md)

新しい作業はこれらの先頭へ日付付きで追記する。

以前の公開更新: [2026-10-16 壁画の原画修復・スマホ操作・仲間表示](mural-deploy-2026-10-16.md)、同日16:12の[Xアイコン・ソロUI](ui-deploy-2026-10-16.md)、[独自ドメイン接続](solo-deploy-2026-10-16.md)。現在は上記2026-10-17版を[cromagnonmmo.com](https://cromagnonmmo.com/)で公開・検証済み。以前のソロ公開は [2026-10-15](solo-deploy-2026-10-15.md)、オンライン公開は [2026-10-12](mmo-deploy-2026-10-12.md)。

公開前の共通検証: [2026-10-16 公開用ソロ版の本番準備と検証](production-readiness-2026-10-16.md)。

採取物の表示修正: [2026-10-16 近づくとベリーが消える問題の修正と検証](resource-visibility-2026-10-16.md)。

仲間の表示と閲覧: [2026-10-16 524のハート・実寸によるカメラ距離・スマホのピンチと左下の戻る](mascot-touch-view-2026-10-16.md)。ローカルで検証済み、公開反映は未実施。

スマホの操作と設定: [2026-10-16 ボタン内アイコンの拡大・設定への直接移動・終了ボタンの移動・丸い焚き火](touch-settings-2026-10-16.md)。ローカルで検証済み、公開反映は未実施。

選択画面と音の初期設定: [2026-10-16 ファビコンの角丸・人物と仲間の順序・スマホ4人表示・初期ミュート](selection-sound-2026-10-16.md)。16:12 JSTのソロ更新で公開反映済み。

初回タイトルのちらつき: [2026-10-16 タイトルをゲーム本体へ引き継ぐときの一瞬の消失を修正](title-flicker-2026-10-16.md)。PC・スマホ相当で再現・修正後の表示継続を検証。16:12 JSTに公開反映済み。

人物カードのXリンク: [2026-10-16 タイトルと洞窟のXアイコン](contributor-x-2026-10-16.md)。Xリンクのあるカードの右端に表示し、PC・スマホ相当のChromeで全カードを確認。

人物紹介と壁画の統合: [2026-10-16 共通の16組・重複除去・壁画からyuriを除外](contributor-cast-2026-10-16.md)。制作yuriはタイトルに保持。Ryuichiの壁画を追加し、公開用ビルドとPC・スマホ相当のChromeで検証。16:12 JSTに公開反映済み。

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
| [player-inactivity-2026-10-14.md](player-inactivity-2026-10-14.md) | 30秒の無操作による自動退出と、持ち物を保持した手動再開 |
| [kunoichi-retirement-2026-10-15.md](kunoichi-retirement-2026-10-15.md) | スマホの人物カードと実物の身長比、クノイチ・刀の配信除外とすぐに戻せる保管・復元手順 |
| [starting-mascot-2026-10-15.md](starting-mascot-2026-10-15.md) | 人物の次の別画面で仲間を1匹選び、Dots全9種類・りもねこ・524の実物写真を表示 |
| [solo-play-2026-10-15.md](solo-play-2026-10-15.md) | ソロのみの入口、ブラウザー内の進行とIndexedDB自動保存、公開時もDO・SQLを呼ばない境界 |
| [solo-deploy-2026-10-15.md](solo-deploy-2026-10-15.md) | ソロ専用版のCloudflare公開、保存・復帰・通信0件と公開画像の検証 |
| [menu-icons-map-sights-2026-10-13.md](menu-icons-map-sights-2026-10-13.md) | スマホのメニューボタンをリュックに、設定を歯車に。メニューのタブを1行でスライドさせ「その他」を最後のタブに。ワープを地図の「名所へワープ」の帯へ移した設計と検証 |
| [git-pull-2026-10-12.md](git-pull-2026-10-12.md) | 未コミット53ファイルを保持して最新mainを統合：戦闘と仲間の競合解消、実Chrome確認、リモートにもある40件のテスト失敗の照合 |
| [mascot-companions-2026-10-12.md](mascot-companions-2026-10-12.md) | マスコットを1人1匹・各自の分身へ統一：選択だけの保存・撫でる反応・別れ・投げて放置・確認範囲 |
| [mascot-tests-2026-10-12.md](mascot-tests-2026-10-12.md) | 旧マスコット仕様の既存テスト・Chrome QAの移行、接触姿勢の修正と検証 |
| [player-profile-2026-10-12.md](player-profile-2026-10-12.md) | 近くの旅人を「見る」と出る札（自己紹介・体力・装備・仲間・旅の証など）と自己紹介の書き方 |
| [clothing-dye-2026-10-12.md](clothing-dye-2026-10-12.md) | 服の色（8色と元の色）：選ぶ場所・保存・服だけを染めるシェーダーの規則・見本の描き方・検証 |
| [mobile-hud-2026-10-12.md](mobile-hud-2026-10-12.md) | スマホHUDの刷新：左右2列・浮く移動パッド・攻撃の弧と最大3つの行動・丸いミニマップ・会話の未読 |
| [cave-murals-2026-10-12.md](cave-murals-2026-10-12.md) | 壁画の縮尺統一・30配置への増量・22人の個別差し替え・Coming Soon撤去 |
| [collision-bounds-2026-10-12.md](collision-bounds-2026-10-12.md) | 当たり判定の外形を配信中のGLBから測り直し：旧SHAの出どころ、トウヒの幹を根張りと樹冠の間で測る、旧／新の障害物・着地点・経路の比較、実Chromeで幹に当たる確認、SHAのずれを検出するテスト |
| [player-knockback-2026-10-12.md](player-knockback-2026-10-12.md) | プレイヤー同士の攻撃は押し返すだけ（元気は減らない）：部屋の規則、当たる相手と当たらない人、武器ごとの距離、滑り・全身の傾き・打撃音、実Chromeの5人接続での確認 |
| [git-pull-2026-10-11.md](git-pull-2026-10-11.md) | 未コミット40ファイルを保持してpull・競合解消・英語UIを統合 |
| [neanderthal-retirement-2026-10-11.md](neanderthal-retirement-2026-10-11.md) | ネアンデルタール人男女と交易NPCを除外し、素材・保存済み外見を保持して再導入可能にする |
| [language-toggle-2026-10-11.md](language-toggle-2026-10-11.md) | タイトルの日本語／English切替・設定保存・英語UIと実Chrome検証 |
| [og-language-2026-10-16.md](og-language-2026-10-16.md) | OG文言の短縮・日英の共有URLと静的配信・言語設定の引継ぎ |
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
| [cave-spring-2026-10-10.md](cave-spring-2026-10-10.md) | 薄暗い洞窟と丸い奥室の泉を待機中とゲーム中で共通化 |
| [cave-loading-2026-10-15.md](cave-loading-2026-10-15.md) | 洞窟の顔へ控えめな環境光、ローディングを左から右へ流れる動物の壁画と回転アイコンに変更 |
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
| [git-integration-2026-10-11.md](git-integration-2026-10-11.md) | 最新mainへ音源・石斧・展示方針の全ローカル変更を統合 |
| [loading-cave-2026-10-07.md](loading-cave-2026-10-07.md) | 開始後に歩けるローディング洞窟 |
| [maruimo-mascot-2026-10-07.md](maruimo-mascot-2026-10-07.md) | まるぃもを仲間と洞窟壁画へ追加 |
| [meshmell-upload.md](meshmell-upload.md) | Meshmell CLI アップロード手順 |
| [mmo-deploy-2026-10-06.md](mmo-deploy-2026-10-06.md) | MMO公開版を更新（2026-10-06） |
| [mmo-deploy-2026-10-11.md](mmo-deploy-2026-10-11.md) | 軽量化・起動改善・音源更新を公開MMOへ反映（2026-10-11） |
| [mobile-chat-journal-removal-2026-10-06.md](mobile-chat-journal-removal-2026-10-06.md) | スマホの会話と手帳の撤去（2026-10-06） |
| [mobile-start-screen-2026-10-07.md](mobile-start-screen-2026-10-07.md) | スマホの開始画面を縦持ちへ合わせる |
| [mountain-river-2026-10-01.md](mountain-river-2026-10-01.md) | 山から既存の川へつながる渓流と滝 |
| [nature-audio-only-2026-10-06.md](nature-audio-only-2026-10-06.md) | 自然音と場所別BGMだけを残す変更 |
| [nature-audio-quality-plan.md](nature-audio-quality-plan.md) | 自然音の品質改善 — 2026-10-06 |
| [nature-audio-soft-foley-plan.md](nature-audio-soft-foley-plan.md) | 風・川を控えめにし、効果音を素材から作り直す |
| [nature-audio-remake-2026-10-11.md](nature-audio-remake-2026-10-11.md) | 全音源・BGMの作り直しと現実の音量への調整 |
| [nature-immersion-plan.md](nature-immersion-plan.md) | 自然の没入感を高める実装計画 |
| [orb-bots-2026-10-01.md](orb-bots-2026-10-01.md) | 画像の5色bot：調査・制作・操作 |
| [pacific-island-removal-2026-09-22.md](pacific-island-removal-2026-09-22.md) | 太平洋の架空島の撤去（2026-09-22） |
| [performance-geometry-2026-09-21.md](performance-geometry-2026-09-21.md) | 敵・人物・野営地の距離LODと簡易影（2026-09-21） |
| [performance-investigation-2026-09-19.md](performance-investigation-2026-09-19.md) | 2026-09-19 カクつきの原因調査と改善 |
| [performance.md](performance.md) | 描画負荷の改善 |
| [optimization-audit-2026-10-09.md](optimization-audit-2026-10-09.md) | 軽量化とスマホ対応の初期監査と変更前測定 |
| [optimization-codex-2026-10-10.md](optimization-codex-2026-10-10.md) | Codexが引き継いだ読込・描画改善、実パッケージ検証、未達と実機の限界 |
| [optimization-startup-2026-10-10.md](optimization-startup-2026-10-10.md) | r08の初期読込修正、実タッチの開始→採集、5秒未達と残る素材量 |
| [delivery-cooking-2026-10-11.md](delivery-cooking-2026-10-11.md) | 正本と配信物を分ける配信用変換、転送量半減・洞窟6.5秒、残る根本課題 |
| [chibi-cast-2026-10-13.md](chibi-cast-2026-10-13.md) | ちびキャラの仲間：デザイン候補10人（全員採用・3Dは1指示1体）、1人目「羽根飾りの女の子」の制作（目を消した参照・8,000三角形・肌の色合わせ）と追加、キャラクターをモデルキーで区別する改修（プロフィール・通信・セーブ・選択カード）、5接続確認 |
| [cro-magnon-woman-chibi-2026-10-13.md](cro-magnon-woman-chibi-2026-10-13.md) | クロマニョン人女性をちびキャラ（1.45 m・6,913三角形）に作り直し：画風の参考画像・目を塗りつぶした参照画像で滑らかな顔・参照画像の色への補正・顔の投影・肌の別材質・ちびの関節比率と手足の固定・周期を速めた歩行、カメラ・手の位置・撫でる距離・服の色の調整、採用と5接続確認 |
| [cro-magnon-woman-remake-2026-10-12.md](cro-magnon-woman-remake-2026-10-12.md) | クロマニョン人女性をかわいいローポリ（7,689三角形）に作り直し：参照画像・TRELLIS・目の穴埋め・顔の投影・頭体別アトラス・リグの実測比率と腕のウェイト、候補4（不採用）、採用と5接続確認 |
| [head-lowpoly-2026-10-11.md](head-lowpoly-2026-10-11.md) | 顔を作り直した人物3体の頭部の軽量化（r08採用）、UVの折り返し・使用率・再現性の修正、採用と確認 |
| [world-data-bake-2026-10-11.md](world-data-bake-2026-10-11.md) | 起動時のワールド計算（海岸・地表・景観）をビルド時へ移し、人物選択まで5.7→3.5秒 |
| [world-entry-2026-10-11.md](world-entry-2026-10-11.md) | 通常世界の入場条件の調査（変えない）、準備の二重シェーダー・到着時の同期コンパイル・カメラ格子の修正、入場可能まで約2秒短縮 |
| [camera-clearance-2026-10-12.md](camera-clearance-2026-10-12.md) | カメラが洞窟・木・岩・自分の人物に埋まる問題：球の掃引、山の判定、樹冠の実測形で木と茂みを省く、近いと人物を点描、実Chromeの変更前後 |
| [program-lookups-2026-10-12.md](program-lookups-2026-10-12.md) | 毎フレームのシェーダープログラムの選び直し：透明・両面の水の2回描きとインスタンスの材質共有、材質の複製と面ごとの組、選び直しの回数・プロファイル・実GPUの画素比較 |
| [loading-screen-2026-10-11.md](loading-screen-2026-10-11.md) | OpenAI Dotsのクレジット、アプデの洞窟で「関わってくれた人たち」（2026-10-13に「壁画の人」へ置き換え、2026-10-14に「壁画の人々」へ改名）、ワープ・入り直し・洞窟自体の読み込みのローディング画面とクロマニョン人の豆知識 |
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
| [contributors-cave-visit-2026-10-09.md](contributors-cave-visit-2026-10-09.md) | 紹介ダイアログの壁画画像・注釈を撤去し、洞窟へ直接ワープ（訪問ボタンは2026-10-13に撤去） |
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
