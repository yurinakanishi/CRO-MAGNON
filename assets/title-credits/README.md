# タイトル画像・クレジット

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
