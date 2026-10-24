# SNSシェアボタン（2026-10-24）

ユーザー指定：タイトル、アプデの洞窟（世界を読み込んでいる間）、ゲーム中に、X・Instagram・Facebook・リンクのコピーのシェアボタンを付ける。実際に遊んでいるときは邪魔にならないよう工夫する。

## 配置

- **タイトル**：メニュー（日本語／English）の下に、44pxの丸いマーク4つ（X・Instagram・Facebook・リンク）。タイトル画像の高さをその分だけ詰め、PC・スマホ縦・横のどれでもメニュー・全画面ボタン・左上の画像と重ならない。矢印キーでメニューから移動できる。
- **アプデの洞窟**：左上の「アプデの洞窟」の横に同じマーク。縦持ちのスマホでは名前の下、幅350px以下では見出しの下の行に移る。右上の「壁画の人々」「タイトルへ戻る」は1行のまま保ち、松明・移動パッド・開始ボタンとも重ならない。マークを押しても視点は回らない。
- **ゲーム中**：HUDには何も置かない。メニュー（持ち物・連れていく仲間・キャラクターを変える・設定）の最後に「シェア」タブを追加した。アイコンは3つの点をつないだ一般的な共有の形。PCは左の一覧、スマホは横送りの行の末尾。タブの中は文字付きの大きなボタン4つと、共有するアドレス。
- **出さない場合**：展示ビルドとLAN接続では表示しない。外部リンクを出さない既存の規則（タイトルの `titleLinks()`、ゲームの `onlineTitle`）と同じ判定。

## 動作

- 共有するアドレスは公開中の `https://cromagnonmmo.com/`（英語表示中は `/en/`）。ローカル・LAN・部屋のURLや、従来の workers.dev のURLは共有しない。
- **X**：`x.com/intent/tweet` に本文「CRO-MAGNON MMO — 原始の世界を自由に冒険。」（英語は「Explore a prehistoric world.」）とアドレスを渡し、新しいタブで投稿画面を開く。本文はページのOGP説明と同じ。
- **Facebook**：`facebook.com/sharer/sharer.php?u=アドレス`。Facebookは本文を受け取らず、ページのOGPを読む。
- **Instagram**：リンクを直接投稿する仕組みがない。スマホ（タッチ・共有シート対応）は端末の共有シートを開き、そこからInstagramを選ぶ。PCなどではリンクをコピーしてInstagramを新しいタブで開き、「リンクをコピーしました。Instagramに貼り付けてください。」と表示する。
- **リンクをコピー**：クリップボードへコピーし、「リンクをコピーしました」と約3秒表示。タイトル・洞窟ではマークの下に重ねて表示し、ほかの配置を動かさない。クリップボードAPIがない環境は選択コピーで代替し、それも失敗したらアドレスを表示する。
- タイトルで言語を切り替えると、共有アドレス・本文・ボタン名（Post on X など）が追従する。

実装は `src/share-links.ts`（アドレス・リンク・表示・クリック処理）にまとめ、`src/title-shell.ts`・`src/loading-cave.ts`・`src/main.ts` から使う。スタイルは `src/title.css` 末尾。

## ページの正規URL・OGP画像を cromagnonmmo.com へ

`public/index.html`・`public/en/index.html` の canonical・og:url・hreflang・og:image・twitter:image は、従来の workers.dev のままだった。2026-10-16 12:04に作られ、独自ドメインの接続（同日13:37）より前のもの。Facebookなどは og:url を正規URLとして扱うため、ボタンが cromagnonmmo.com をシェアしても、カードに workers.dev のドメインが出るおそれがあった。

ユーザーの承認（同日）を受けて、両ページの6か所ずつを `https://cromagnonmmo.com` に変更した。日本語は `/`、英語は `/en/`、画像は同じ `/title/cro-magnon-mmo-og-20261016-r02.jpg`。変更前に、公開中の cromagnonmmo.com でこの画像が200・image/jpeg・461,313バイトで配信され、SHA-256がローカルのファイルと一致すること（`2c3b8435…fe2c`）、`/` と `/en/` が200を返すことを確認した。workers.dev のURLは引き続き同じゲームを配信するが、ページが名乗る正規URLではなくなる。公開サイトへは、次の公開で反映される。

テスト：`tests/og-language.test.mjs` の公開アドレスを cromagnonmmo.com にし、og:image と twitter:image が同じ画像で、同じサイトにあり、配信するファイルとして存在することも確認するようにした（複数行に折れたタグも読めるよう、タグを読む正規表現を空白・改行に対応させた）。`tests/share-links.test.mjs` は、シェアするアドレスが各ページの canonical・og:url と一致することを確認する。

## 検証

### 自動

- `npm run check` 合格（型、strict（`src/share-links.ts` を追加）、JS構文、依存境界）。変更ファイルは Prettier 整形済み。
- 全テスト 1,861件中 1,857件合格、失敗0、任意の4件はスキップ。新規 `tests/share-links.test.mjs` の6件で、共有アドレスがREADMEの公開アドレスと一致すること、本文が各言語ページのOGP説明と一致すること、X／Facebookのリンク、属性内の `&` のエスケープ、並び順、英語訳、タイトルでの位置、展示での非表示、HUDに置かないこと、LANでの除去を確認する。
- 既存の `tests/loading-screen.test.mjs` は洞窟の設定項目に `share: onlineTitle` を加えた。メニューのタブ一覧を固定している `scripts/qa-controller-menus.mjs`・`qa-mobile-hud.mjs`・`qa-pause-focus.mjs` の期待値に `share` を加えた（これら3本は今回は実行していない）。

### 実Chrome

`scripts/qa-share-links.mjs`。Chrome 155.0.8059.86、ポート0の独立したソロ用サーバー、新しいブラウザープロファイル。X・Facebook・Instagram への通信はローカルの代替ページで受け、外部へは何も送らない。OSのクリップボードを上書きしないよう、ページ内のクリップボードと共有シートは引数を記録するだけにした（準備用の置き換え）。

1. タイトル：PC 1440×900／1280×720、スマホ相当 390×844／320×568／844×390 で、4つのマークがすべて44px以上・画面内・メニューの下にあり、ほかの要素と重ならない。
2. タイトル（PC）：X・Facebookが期待どおりのアドレスで新しいタブを開く。コピーとInstagramが公開アドレスをコピーし、Instagramが新しいタブで開く。表示は約3秒で消える。
3. タイトル（PC）：英語に切り替えると `/en/`・英語の本文・英語のボタン名になり、日本語に戻すと元に戻る。
4. タイトル（PC）：「日本語／English」から下矢印でマークへ移り、右矢印で隣へ移る。
5. タイトル（スマホ相当）：Instagramが共有シートをタイトル・本文・アドレス付きで開き、コピーしない。コピー・Xもタップで動く。
6. 洞窟（PC）：名前の横に配置。周りのボタンと重ならず、コピーしても視点が変わらない。Facebookが新しいタブを開く。
7. プレイ（PC）：HUDにシェア要素0。メニューの最後のタブが「シェア」で、文字付きボタン4つとアドレスを表示し、コピー・Xが動く。閉じた後も0。
8. 洞窟（スマホ相当）：390×844・320×568・844×390で重なりなし、右上のボタンは1行のまま。
9. プレイ（スマホ相当）：7と同じ。
10. LANのタイトル：シェア要素0。
11. ページエラー0、外部への通信は代替ページで受けたシェア先だけ。

証拠：[結果](../output/playwright/share-links-r04/result.json)、[PCのタイトル](../output/playwright/share-links-r04/pc-title.png)、[スマホのタイトル](../output/playwright/share-links-r04/phone-title.png)、[PCの洞窟](../output/playwright/share-links-r04/pc-cave.png)、[スマホの洞窟](../output/playwright/share-links-r04/phone-cave.png)、[320pxの洞窟](../output/playwright/share-links-r04/phone-small-cave.png)、[PCのシェアタブ](../output/playwright/share-links-r04/pc-menu-share.png)、[スマホのシェアタブ](../output/playwright/share-links-r04/phone-menu-share.png)、[プレイ中](../output/playwright/share-links-r04/phone-play.png)。

初回の実行では、閉じたメニューの中身が残る（非表示になるだけ）ことをQA側が想定しておらず失敗したため、待ち方を修正した。2回目までの画面確認で、スマホの洞窟で「タイトルへ戻る」が2行に折れる問題を見つけ、右上のボタンの幅を保つ指定と350px以下の配置を加えた。

### 実際のシェア先

アプリ内ブラウザーで実際のページを開いた（ログインしていない状態、投稿はしていない）。Xの投稿画面のアドレスは、本文とアドレスを保ったままログイン画面へ送られた（`redirect_after_login=/intent/tweet?text=…&url=…`）。Facebookの共有画面は「Not Logged In」を表示し、アドレス自体は受け付けた。

### 未検証

- 実スマホ（iOS Safari・Android Chrome）の共有シートにInstagramが出るか、Instagramアプリへの移動。
- ログインした状態での投稿画面の内容と、実際の投稿（投稿は行わない）。
- 物理パッド：外部へのリンクはパッドの決定ボタンがユーザー操作として扱われず、ブラウザーに新しいタブを止められる可能性がある。人物紹介のXリンクと同じ制約。

## 配信と保存

通常の3000番は稼働していなかったため、起動・再起動していない。検証は独立した一時サーバーで行った。`.cro-magnon-save/` の2ファイルは2026-10-16のまま（world.json `d3dd9831…ba56`、world.backup.json `0a998b45…a000`）。公開サイトへの反映、展示ビルド、保存の編集、commit／pushは行っていない。
