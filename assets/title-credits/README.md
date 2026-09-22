# タイトル画像・クレジット

## 2026-09-22 制作を左中央・友情出演を右中央・監修を下段へ

ユーザーの追加指定により、中央のタイトルとメニューを挟んで左中央に制作yuri、
右中央に友情出演R-524を配置し、下段に監修4名を横一列で並べた。
yuriのアイコンを56→112px、名前を22→28px、制作見出しを13→22pxへ拡大。
監修・友情出演はアイコン56px／QR74pxを維持し、見出しを11→18px、名前を11→14pxへ拡大。
yuriのQR148px、元画像、名前・監修の順番、クリック不可は保持する。

横幅700px以下はタイトルの下に制作・友情出演を左右に並べる。
560px以下では監修を2列にして、スクロールで全員に到達できる。
`title-credits` の意味上のグループは維持し、CSSグリッドで画面の左右・下段へ配置。
実Chromeのアクセシビリティツリーでもクレジット・全見出し・名前・画像を確認した。

型／strictを含むビルド、373JS構文・依存境界、既存タイトル関連6テストが通過。
実Chrome8寸法で配置・画像サイズ・横はみ出しなし・小画面のスクロールを確認。
1280×800・1440×900・1920×1080・1536×776・1000×700・767×722は全員が一画面に収まる。
方向キー、開始と人物選択からの戻る、あそびかたと戻る、再読込を確認。
開発監視更新中の再読込で素材fetch失敗が一度出たが、最終ビルド後の再読込で背景が復帰し、
以後の新規エラーなし。物理コントローラー・実展示画面の目視は未検証。
記録 `side-layout-2026-09-22.json`、通常3000番の14配信SHAは `side-layout-delivery-2026-09-22.json`。

直前の更新依頼に続けて `exhibition-20260922-title-layout-r01` をPC0・PC1・PC2へ配置・選択。
ビルドID `3423bf204cb82760828c6f30074925099c4bbb82413bb06f51eb461d405397ce`、410ファイル・78GLB。
ZIP SHA `28d9417f6dca93757be2f34f4b6859cd4cf057dc020100bb7458d03b79933019`。
全3台の照合後、PC1ホスト・PC2クライアントを標準タスクで再起動。PC0は同版で待機。
配布記録 `output/exhibition-fleet/20260922-234232-deploy-0ac9ca50c9874a7085d0c9b084b034a6.json`。
更新後も3台の全410ファイル・同一ビルドIDを再照合。
記録 `output/exhibition-fleet/20260922-234506-verify-35979c29511e40cea5ba42eec1d4bbde.json`。
PC1/PC2の同梱Nodeから独立部屋 `FLEET-QA-234532` で双方の移動・攻撃同期を確認し、
各12配信ファイルをマニフェストのSHAと照合（PC1で31、PC2で19スナップショット）。
記録 `output/exhibition-title-layout/FLEET-QA-234532-PC1.json` と `FLEET-QA-234532-PC2.json`。
PC3は未配布の指定を継続。UAC表示・公開サイトへのデプロイなし。

## 2026-09-22 全6名に本人のXアイコンを追加

制作yuri、監修4名、友情出演R-524の各XプロフィールをChromeで開き、
表示名・ユーザーID・プロフィール写真へのリンクを照合した。
各ページの`pbs.twimg.com`にある200×200のJPEGを無加工で
`public/title/avatar-*.jpg`へ保存。取得先・対応・SHAは
`x-avatars-2026-09-22.json`に記録した。

各QRの上に56pxの丸いアイコンと細い金色の縁を配置。
QRは制作148px／ほか74px、名前は制作22px／ほか11pxを維持し、
タイトル画像の高さを調整して下段を収めた。クリックリンクなし。
ゲーム実行時はローカル画像だけを使い、展示／公開用の収集対象にJPEGも追加した。

ビルド・型／strict・373JS構文・依存境界、既存の関連21テストが通過。
実Chromeで1440×900、1280×800、767×722、約702×700、390×844、844×390を確認。
全6アイコンとQRが読み込まれ、横はみ出し0。縦長画面はスクロールして全員へ到達。
方向キー、あそびかたと戻る、人物選択と戻る、再読込を確認し、ブラウザー警告・エラー0。
通常3000番の画像12点とJS／CSSの計14ファイルをSHA照合した
（`avatar-delivery-2026-09-22.json`）。TS／CSS・展示ビルド・記録JSONの書式を確認。
公開ビルドスクリプトは変更した収集行以外に既存の書式警告があるため全体整形は行わない。
配布・切替待機のユーザー指定を継続。展示PC配布、公開デプロイ、手動サーバー再起動なし。

## 2026-09-22 制作yuriを拡大し、友情出演R-524を追加

ユーザーの追加指定により、下段を「制作」「監修」「友情出演」の3列へ変更。
制作yuriは名前22px・QR148px、監修4名と友情出演は名前11px・QR74px。
画面の高さに合わせてタイトル画像を調整し、通常サイズでも制作名まで収める。
幅700px以下は制作・友情出演を上段、監修4名を2列で下段へ配置する。

yuriのXフォロワー一覧で **R-524（@R5ni4）** を発見し、プロフィールで表示名・
ID・Follows youを確認。友情出演として `https://x.com/R5ni4` のQRを追加した。
確認記録は `guest-profile-r524.json`。既存5名のQR画像は不変で、名前・QRを
クリックリンクにしない従来の指定を継続する。

6つのQRを296pxと実表示サイズでZXing復号し、URL一致を確認。
型・strictを含むビルド、関連16テスト、実Chromeの767×722・1280×800・
1440×900・390×844・844×390を確認。横はみ出しなし、小画面は縦スクロールで
全員へ到達。制作名・監修4名・友情出演、全QR読込、静的クレジット、方向キー、
あそびかたと戻る、人物選択と戻る、再読込を確認し、ブラウザーエラー・警告0。
画面と計測の記録は `guest-layout-2026-09-22.json`。画像は会話内で目視確認。
通常3000番へ反映し、配信SHAは `guest-delivery-2026-09-22.json`。
展示PCへの配布・公開デプロイ・手動サーバー再起動・Xへの投稿やフォロー変更なし。

## 2026-09-09 当初の実装記録

2026-09-09。通常 http://localhost:3000/ のタイトルへ反映。

制作は **yuri**。**監修**は次の X 表示名を順番通り使用する。

1. Ryuichi-typeR
2. オータニ@AI駆動開発
3. 浦田 勇樹 | 生成AI×新規プロダクト開発@ブレインパッド
4. ぬこぬこ / NUKO 🇯🇵

識別用の @ユーザーID は画面に出さない。表示名そのものに含まれる @ は保持。
プロフィールURLは `src/title-credits.ts` と `qr-verification.json` に記録。
最終指示により名前とQRは静的なfigure/figcaptionで表示し、クリックリンク・
クリックイベント・tabindexを設けない。プロフィールへはQRの読み取りだけで
案内する。外部画像の取得はない。

追加指定で紙色の全面背景と左右レイアウトを廃止。元の3D世界を背景にし、
画像と「はじめる」「あそびかた」を中央、クレジットを下へ配置した。
英語／日本語の紹介、操作ヒント、QRの説明文を削除。全画面表示は右上の
アイコンにした。メニューは2項目を維持し、保存があると「はじめる」から
従来のセッション復帰へ進み、保存のない初回は旅支度へ進む。

## 画像

- 採用: `public/title/cro-magnon-xi-transparent.png`（RGBA、1536×1024、2,678,784 bytes）。
- 無加工コピー: `public/title/cro-magnon-xi.png`（1536×1024、2,910,451 bytes）。
- 原本: `C:/Users/yurin/Downloads/ChatGPT Image Sep 9, 2026, 02_35_20 PM.png`。
- 原本と無加工コピーの SHA-256 はともに
  `11e35b792b481eb2e922b1a0c220317f99f189898fbb6c5c6befae3cfc4b18c0`。
- 画像内の「CRO-MAGNON XI」と人物・動物を保持。原本は無加工。
- ユーザーの「元画像をプログラムで切り抜く」の指定に従い、
  `scripts/extract-title-art.py` で原本の紙色を抽出し、絵の内部を保護してRGBAを保存。
  完全透明772,095画素・部分透明6,942画素・不透明793,827画素、四隅のアルファ0を確認。
  色が紙と近い微細な絵具も一部透明になるため、原本を残し再調整できるようにした。
  再現手順・SHA・透明度の記録は `transparency.json`。
- built-in imagegen で背景抽出を試したが、結果は透明アルファを持たない RGB の
  市松模様だったため不採用。生成物はゲームへ組み込んでいない。
- 最終生成プロンプト（built-in mode、CLI/API不使用）:

> Use case: background-extraction. Asset type: title-screen hero artwork for the existing CRO-MAGNON game. Edit the provided image only by removing the cream paper background, yielding a true transparent RGBA PNG. Preserve the entire original composition: all four prehistoric people, spears, sabretooth cat, mammoth, birds, mountains, red-orange sun, rocks and distressed paint texture. Preserve the exact original typography 'CRO-MAGNON XI' and the horizontal ochre underline. Retain the light painted highlights inside people, animals and mountains; remove only the paper/background around and between the artwork and lettering. Keep original colors, shapes and layout unchanged, with clean nuanced edges, no dark halo, no replacement backdrop, no new text, no additional objects. Full artwork including text and underline must fit uncropped. Save an actual transparent PNG.

## QR の再生成

`scripts/generate-title-qr.py`。qrcode 8.2・zxing-cpp 2.3.0 は作業用の
`output/title-credits/tools` のみに導入。ゲームの依存パッケージ追加なし。
制作5人のURLをQR version 3 / M / border 4で生成し、296pxと実表示111pxで
独立したZXing復号器へ渡してURLの一致を確認。SHAと結果は `qr-verification.json`。
[生成方法の参照](https://github.com/lincolnloop/python-qrcode/wiki/Home) はContext7で確認。

## 検証と反映範囲

- strictを含むビルド・型検査、202 JS構文、依存境界、変更TS/CSSの書式が通過。
- タイトル・スクリーン・方向移動・Gamepadの既存23テストが通過。
- 実Chromeの通常サイズ、1440×900、390×844、844×390を確認。
  大画面は全員が一画面、小画面は縦スクロールで全員へ到達、横はみ出しなし。
- 5人の表示名・順番・QRの復号先、6画像の読み込み、制作名訂正後の再読込を確認。
- 「はじめる」→旅支度→「戻る」、方向キーによるタイトルメニューを確認。
  当初のプロフィールリンクは最終指示で撤去。最終版は下記追記の検査を参照。
  ブラウザーの記録されたエラー・警告0。
- QRはソフトウェアで復号。物理スマートフォンのカメラ・物理Gamepadは未検証。
- 通常3000番 PID30044、開始時刻2026-09-09 13:35:49を保持。
  サーバー再起動・保存復元・X投稿・フォロー変更は0。
- 今後の展示／公開ビルドでタイトルPNGを収集するようビルドスクリプトを更新。
  既存の展示パッケージ・PC2・公開環境は更新していない。

### クリックリンク撤去後の最終確認

通常3000番を再読込し、タイトル内の `a[href]` 0件、クレジット内の
`a / button / tabindex / onclick` 0件をDOMで確認。Ryuichi-typeRのQRと
浦田さんの名前をクリックしてもURLは `http://localhost:3000/` のままで、
新しいタブは開かない。5人の表示名、5QRの読込と順番を再確認した。
最終の配信10ファイルのSHAを `delivery.json` でディスクと照合。

### 中央メニュー・3D背景へ戻した版の確認

紹介文・操作ヒント・QR説明を削除し、制作yuri・監修4人へ修正。
strict含むビルド・型検査、関連10テストを再確認。実Chromeの通常サイズと
1440×900では背景の3D世界が見え、メニューの中心Xは画面中心と一致する。
1440×900ではメニュー中心が(720, 456.7)、全5人が一画面に収まる。
390×844と844×390で横はみ出しなし、縦スクロールで下段を確認。
タイトル内のリンク0、メニュー2項目、不要な文言の要素0を確認。
「あそびかた」と戻る、「はじめる」から旅支度と戻る、全画面アイコンの
開始／終了による状態変更を確認。保存ありの開始は従来の復帰関数へ接続するが、
この版で既存の実セッションを再接続する操作は行っていない。

### 実透過・前面表示・下端クレジットの最終版

ユーザー許可後に原本からプログラムで透過素材を抽出し、中央で大きく表示。
制作・監修を最下部へ寄せ、囲み背景を外した。準備完了とMULTIPLAYERは削除し、
右下はバージョンのみ。通常の描画エラー通知は既存のonErrorに保持している。
strictを含むビルド・型検査、既存の関連10テスト、変更TS/CSSの書式、diffチェックを通過。
実Chrome1440×900で全体が900px内に収まり、390×844は1015px、844×390は620pxの
縦スクロールで全員とバージョンへ到達。いずれも横はみ出しなし。
実画像6枚の読み込み、タイトルのリンク0件、クレジット内の操作可能要素0件を確認。
配信11ファイルのSHAを照合し、通常3000番PID30044・開始時刻13:35:49を保持。

### 画質修正 revision 2

明るい毛並み・衣服・雪まで抜ける旧処理を修正。絵の内部の白い部分を保護し、
輪郭外の紙を透過する。元画像1536×1024のRGBを全画素で完全一致に保ち、
旧版の縁の色変換とCSSの白い発光を撤去した。PNGは非可逆圧縮・拡大処理なし。
暗色・明色背景と通常Chromeで目視確認し、RGBA・四隅の透明・RGB一致をスクリプトで検査。
配信11ファイルのSHA一致、CSS書式とdiffを確認。配置とゲーム処理の変更なし。

### 画像の背後を白から透明へ

追加指定に従い、画像の背後だけに半透明の白いぼかしを追加。
「もっと画像と同じ範囲で」に従い、楕円から画像自体のアルファ輪郭に変更。
同じ画像を白色化した背面の疑似要素を8〜18pxぼかし、外へ透明になるようにする。
CSSの疑似要素で描画し、画像のRGB・アルファ・解像度はrevision 2のまま保持。
通常Chromeで目視確認し、CSS書式・diff・11配信ファイルの一致を確認。

### 白い粒の修正 revision 3

原本との拡大比較で、白い粒には元の画風の点と透過輪郭で目立つ孤立した断片があることを確認。
ユーザー指定で小さな明色成分2,478か所を周囲の色で局所補修し、輪郭外の554断片を除去。
顔の保護領域・文字のRGBは保持し、全RGB画素の97.44%は原本と完全一致。
大きい雪・衣服・牙の明部は残し、画像全体のぼかし・縮小は行わない。
再現はscripts/title_art_cleanup.pyとscripts/extract-title-art.py。revision 2のRGB全一致から
今回のみ指定された粒の補修へ変更した。RGBA・寸法・四隅透明・顔と文字・変更量の検査、
通常Chromeで表示と11配信SHAを確認。白い輪郭ぼかし背景と配置は保持。

### 画像内全体の白い斑点を除去 revision 4（現採用）

ユーザー訂正は外の孤立点ではなく、マンモスの上や画像内全体に散らばる白い斑点。
revision 3の小成分だけの補修は不十分だったため、built-in image_genで原本の内側にある
白い飛沫・かすれを毛並み・衣服・岩・太陽の自然な色と質感へ補修した。
生成編集済みの非透過原本はcro-magnon-xi-clean-source.png、編集指示全文はsurface-cleanup.json。
元の支給画像は無加工のまま保持。構図・人物・動物・ロゴを目視比較したが、生成編集のため
細部の画素同一は保証しない。現抽出はこの編集済み原本を使い、旧小成分補修は呼び出さない。
透過時には編集済み原本のRGBを全画素で保持し、RGBA・寸法・四隅透明を検査。
暗い背景・通常Chromeで画像内部の斑点除去と白い輪郭ぼかしを確認し、11配信SHAを照合。

### MMOの追加バージョン

「XIではなくMMOのバージョンも」の指定で、built-in image_genによる文字変更版を別名保存。
`cro-magnon-mmo-clean-source.png`が編集元、`public/title/cro-magnon-mmo-transparent.png`が
実透過PNG（1536×1024）。指示全文は`mmo-variant.json`。透過は
`python scripts/extract-title-art.py --variant mmo`で再現し、RGBA・四隅透明・編集元RGB一致を検査。
明暗背景で全文「CRO-MAGNON MMO」と絵を確認。生成編集なので細部の画素同一は保証しない。
XI版と現在のタイトル画面は保持し、MMO版は追加素材として配信する。

### DUOの展示向け追加バージョン

2台LANの展示向け名称としてユーザーがCRO-MAGNON DUO版の追加作成を指定。
MMO版からbuilt-in image_genでDUOへ文字を変更し、1536×1024の実透過PNGを
`public/title/cro-magnon-duo-transparent.png`へ保存。元素材と指示はduo-variant.json。
`python scripts/extract-title-art.py --variant duo`で透過を再現できる。
文字・明暗背景・RGBA・四隅透明・編集済みRGB一致・配信SHAを確認。
XI・MMOと現在のゲーム表示は保持。展示パッケージの更新はしていない。
