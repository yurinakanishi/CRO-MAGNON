# 自然の没入感を高める実装計画

最新: 音質への追加指摘を受け、録音素材・実楽器サンプル・定位とミックスを再設計。[音質改善の調査・実装・検証](nature-audio-quality-plan.md) を参照。

作成: 2026-10-06。ユーザーのWeb調査依頼と、その提案への「ok. create ...plan.md and proceed to imp」に基づく。

更新: 同日の追加指定で、音は環境音・鳥・場所別BGMだけに変更。足音・行動SE・ME・通知音を削除し、見た目の演出は維持した。現在の仕様・試聴一覧・検証は [自然音だけを残す変更](nature-audio-only-2026-10-06.md) を参照。以下は初回実装の記録。

## 目指す体験

キャンプの焚き火から歩き出すと火の音が背後へ遠ざかり、川の方向から水音が近づく。草・土・石・浅瀬で足音が変わり、アプデの洞窟では外の音が薄れて水滴と足音が響く。風の強弱を音と草・煙の動きに共有し、自然音の間に静かな音楽が入る。

## 現状と設計

- 現在の環境音は3.2秒間隔の正弦波音と猫の威嚇音。霧・雨雪・松明・川の水面演出は既存。
- Three.js / Web Audioと既存の地域・洞窟・水面判定を利用。共有ドメインのゲーム結果、操作、モデル、保存形式は維持する。
- 自然の録音と短いSEは利用条件を確認した音源のみ採用。配信素材のURL・作者・ライセンス・加工内容・SHAを記録する。音楽を新規合成する場合は録音素材と区別して記録する。
- 音は環境音・BGM・SEに分ける。設定を端末に記憶し、最初のユーザー操作でAudioContextを開始する。ミュート、画面非表示、切断、再参加、破棄を扱う。
- 音源は必要数を上限管理し、近い音だけ定位処理する。地域境界では連続的に音量を変え、洞窟内では屋外音を減衰させる。
- 自分の足音は実際の描画移動と接地状態に追従。ワープ・再接続・騎乗・水上・停止中に余計な足音を出さない。通信イベントの再受信でSEを重複させない。
- 草は元のGLBを保った小さな描画変形、煙・水面・塵は既存方針に沿う実行時効果とする。新しい可視モデルを手続き生成しない。

## 実施項目

- [x] 1. 音源とライセンスを選定・保存し、配信サイズを記録する。
- [x] 2. 音声管理、音量設定、ユーザー操作での開始、停止・再開・解放を実装する。
- [x] 3. キャンプ・川・草原・洞窟の環境音、方向・距離・洞窟残響、地面別の足音を実装する。
- [x] 4. 探索・キャンプ・洞窟の控えめな音楽と主要操作のSEを実装する。
- [x] 5. 共通の風による草・煙の変化、足元の水面反応・洞窟の塵を実装する。
- [x] 6. 型・構文・依存境界・書式と、音声状態／移動／停止の回帰を検証する。
- [x] 7. 保存なしの実Chromeで参加・設定・歩行・川・洞窟・再参加、縦横画面、複数人同期を検証する。生成した音声出力とエラー・同時音数を記録する。
- [x] 8. 本書へ結果と未検証条件を追記する。

## 配布と検証の境界

共通ソースと通常ビルドを変更し、保存なしローカル環境で検証する。固定展示フォルダーを変更せず、公開デプロイ・展示配布・通常サーバーの手動再起動・ユーザー保存の編集・commit/pushは行わない。音声素材が各配布の収集対象になることは静的検証する。実スマホ・Safari・展示スピーカー・持続FPSは、実測できた範囲と未検証を区別する。

## 調査資料

- [Firewatch Audio Tour, p.98](https://www.firewatchgame.com/media/Firewatch%20Audio%20Tour%201.0.pdf): 場所に応じた環境音の重ね合わせと自然の録音。
- [Ghost of TsushimaのVFX](https://blog.playstation.com/2021/01/12/how-stunning-visual-effects-bring-ghost-of-tsushima-to-life/): 共通の風、植生・煙・粒子の一貫した動き。
- [Ghost of Tsushimaの音楽](https://blog.playstation.com/2020/07/02/score-of-tsushima-the-soundtrack-of-ghost-of-tsushima/): プレイ状況に応じた音楽の層。
- [Three.js PositionalAudio](https://threejs.org/docs/pages/PositionalAudio.html)
- [Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)
- [Web Audio spatialization](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Web_audio_spatialization_basics)
- [ConvolverNode](https://developer.mozilla.org/en-US/docs/Web/API/ConvolverNode)

## 実装・検証結果

### 実装内容

- `src/nature-audio.ts` が風・川／岸辺・焚き火・松明・雨の6ループ、間欠的な鳥と水滴、洞窟残響を管理する。耳の位置は自分の人物、向きはカメラに合わせ、ズームで音量を変えない。位置と洞窟への出入りに応じて音量を滑らかに変える。
- `src/nature-synthesis.ts` に息を含む笛と木の打音による3種類の短い旋律を用意。探索・キャンプ・洞窟で切り替え、フレーズ間は22〜36秒休む。既存曲・外部音楽生成サービスは使用していない。ジャンプ・攻撃・被弾・採集・呼ぶ／投げる・撫でる・発見・猫の威嚇も状態に応じて鳴る。
- 足音は描画中の歩行／走行アニメーションと実移動距離で発火。草は砂音を柔らかく加工、石は石音、雪は低音寄り、浅瀬は水音に切り替える。停止、ワープ、空中、騎乗・舟・運搬中を除外し、参加時の古い行動を鳴らさない。
- 設定に環境音70%・BGM30%・効果音70%の独立スライダーとサウンド全体のオン／オフを追加。端末の `cro-nature-audio-v1` に記憶する。最初の操作で音声を開始し、非表示・切断・タイトル復帰では停止、再参加では既存の音声管理へ復帰する。パッドの左右にもスライダー操作を追加。
- 元の草GLB・両LOD・遠景板の描画時にだけ、根元を固定して最大約12cmの風の変形を加える。風音・草・煙には同じ緩やかな風の式を用いる。
- 焚き火の薄い煙は1か所12粒、軽量時6粒。松明／炉の近くの洞窟の塵は40粒、軽量時16粒。足元の波紋は最大8枚を再利用。消音中も見た目の演出は動く。
- 短音の同時再生上限14、環境ループ上限6、残響は共通1系統。音源の読込は順番に行い、破棄時に通信を中断してAudioContextを閉じる。
- NodeのWAV MIMEと展示／MMOの音源収集対象を追加。固定配布物の再ビルド・配布は行っていない。

### 音素材

配信はモノラルPCM16 / 22,050Hz、12ファイル、計 **3,775,588 bytes（約3.60MiB）**。元の録音から短く切り出し、DC除去・音量調整・ループの重なり／端のフェードを適用。原本は `assets/nature-audio/source`、対応とSHA・加工区間は `public/audio/nature/manifest.json`、表記は同じ場所の `CREDITS.txt` に保存。

| 用途                     | 出典・作者                                                                                                      | 利用条件 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- | -------- |
| 鳥の録音                 | [Ambient Bird Sounds / isaiah658](https://opengameart.org/content/ambient-bird-sounds)                          | CC0      |
| 焚き火                   | [Fireplace Sound Loop / PagDev](https://opengameart.org/content/fireplace-sound-loop)                           | CC0      |
| 川の録音                 | [Sea and river wave sounds / RandomMind](https://opengameart.org/content/sea-and-river-wave-sounds)             | CC0      |
| 風（PureDataによる合成） | [Wind1 / Luke.RUSTLTD](https://opengameart.org/content/wind1)                                                   | CC0      |
| 足音                     | [Fantozzi's footsteps / Fantozzi・qubodup](https://opengameart.org/content/fantozzis-footsteps-grasssand-stone) | CC0      |

再加工スクリプト: `scripts/prepare-nature-audio.mjs`。Kenneyの候補アーカイブも調査時に取得したが本実装では未使用・非配信。

### 検証結果

- TypeScript（通常・Cloudflare・既存strict対象）、501 JavaScript構文、依存境界、変更ファイルのPrettier、差分空白に成功。
- 新規6テストは、足音の移動／停止／ワープ／接地、SE重複・未来の投擲時刻、洞窟と屋根、川と橋、風・設定値、音源SHA・ライセンス対応・収集対象を確認。関連検査は38件と、描画／操作を含めた別の39件が成功（重複を含む）。
- 全体988件中979成功・9失敗。失敗は既存記録と同じ舟7件・マンモス2件で、本変更はドメイン・そのテストを変更していない。全体結果は `output/nature-immersion-tests.log`、最後の関連結果は `output/nature-immersion-related.log`。
- 保存なし・ループバックの実Chromeで、人物選択からの入場、W/S/D移動・Spaceジャンプ、L松明、3音量とキー操作、消音中の波紋、軽量時の塵16粒、非表示シグナルでの停止／復帰、2画面の通信、実WebSocket切断／自動再接続、再読込後の実UI入場と設定保持を確認。
- 画面1280×800、390×844、320×568、844×390を確認。スライダーはスクロールで到達でき、横へのはみ出しなし。波紋・キャンプ・洞窟・設定の画像を保存して目視確認。
- ページ／コンソール／音源読込エラー0。同時短音の観測最大5・ループ6。12音源の実HTTP応答のSHAとWAV MIMEが一致。
- 実Web Audioの出力を `game-audio.webm` に録音。1検査区間のRMS 0.003905・ピーク0.013028を測定し非ゼロ出力を確認。これは全編の聴感評価や全区間の音量保証ではない。
- 最終証拠: `output/playwright/nature-immersion-20261006/final-r03/summary.json` と同フォルダーの録音・画像。r01は橋上を水中と期待した検査側の不備で停止、浅瀬へ変更後のr02/r03は成功。足音アーカイブの対応表も検査中に明示化した。途中の記録を保持。

### 未検証・維持した範囲

実スマホ、Safari、物理パッド、実展示スピーカー／ヘッドホンでの聞こえ方、全地域を通した試聴、長時間のFPS・メモリ安定性は未検証。音量の好みは設定で調整できる。非表示はChrome上のvisibilityシグナルで検証し、OSでの実バックグラウンド移行とは区別した。

元GLB・UV・地形・所属・プレイヤー保存・非表示設定を保持。既存サーバーの手動再起動、固定展示／MMO確認版の変更、公開、配布、commit/pushなし。
