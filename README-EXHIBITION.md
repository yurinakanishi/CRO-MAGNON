# 展示会の有線LANモード

今回のPC1・PC2の実際の配置場所、起動順、画面表示の場所、部屋名の誤入力からの
復旧手順と確認結果は [この2台の手順書](README-EXHIBITION-NOW.md) を参照してください。
同じ手順書を両PCのプロジェクト直下に配置しています。

PC1はゲームサーバーと自分の画面、PC2は自分の画面を実行します。
ゲーム本体・3Dモデル・テクスチャ・Three.jsは各PCの `http://localhost:4173`
から読み込み、各PCのGPUで描画します。PC1のLANポートではWebSocketの
入力・位置・向き・歩行/走行・動作・戦闘・敵・住人・共有資源などの状態と
小さい診断情報だけを配信します。映像配信、アセットの代理取得はありません。

## 事前の配布準備（開発PCで一度）

Windows x64、Node.js 22以上、インストール済みのこのリポジトリで
`npm run build:exhibition` を実行します。準備段階で依存がなければ
インターネットのある場所で `npm ci` を先に実行してください。
完成する `output/exhibition` フォルダー全体をUSBなどで両PCへコピーします。
配布先にNode.js、npm、Cloudflare、開発ツールをインストールする必要はありません。
ChromeまたはEdgeとGPUドライバーは事前にインストールしてください。
今回の配布はNode.js v24.15.0を同梱します。別のNode版で再配布する場合は、
その版の公式LICENSEを `scripts/licenses/node-v<version>-LICENSE.txt` に用意します。

同じビルドをコピーし、`runtime`、`node_modules/ws`、`public`、`dist`、
`scripts` を省略しないでください。起動時にSHA-256を検証し、PC1と違う
ビルドは参加できません。設定ファイルだけは編集できます。
既存の出力を保護するため再ビルドは空の別フォルダーを指定します。
例: `node scripts/build-exhibition.mjs output/exhibition-r02`。

## 展示当日

1. PC1とPC2をEthernet LANケーブルで直接接続します。
2. PC1のEthernet IPv4を **10.10.10.1** に設定します。
3. PC2のEthernet IPv4を **10.10.10.2** に設定します。
4. 両PCのSubnet maskを **255.255.255.0**（プレフィックス長24）にします。
   Gateway / DNSは空欄です。Wi-FiアダプターのIPは変更しません。
5. PC1で配布フォルダー内の **start-exhibition-host.bat** をダブルクリックします。
6. PC2で **start-exhibition-client.bat** をダブルクリックします。
7. 両方でブラウザーが開きます。「はじめる」→キャラクターを選択→
   「この谷へ出発する」。初期名はPlayer 1 / Player 2、部屋はEXHIBITIONです。
   両方の画面で **LAN: Connected** を確認します。
8. Player 1 / Player 2が互いに見えることを確認し、交互に歩く・走る・
   向きを変える・攻撃する・採集する操作を行います。

起動ウィンドウは閉じないでください。PC1で `Ctrl+C` を押すと共有サーバーも
停止します。展示ワールドはメモリー上にあり、ホスト終了でリセットされます。
ブラウザーの再読み込み・短時間の再接続は既存の復帰機能（通常2分）で扱います。
ゲスト名だけで参加でき、ログイン・Telemetry・Analyticsは起動条件にありません。

## 固定IPとWindows Firewall

Windowsの「ネットワーク接続」（`ncpa.cpl`）→接続中のEthernet→
プロパティ→「インターネット プロトコル バージョン4 (TCP/IPv4)」→
「次のIPアドレスを使う」で上記を設定します。会場後に普段のDHCPへ戻す場合は
「IPアドレスを自動的に取得する」「DNSサーバーのアドレスを自動的に取得する」
へ戻してください。`169.254.*.*` はDHCPがない直結LANの自動割当です。

PC1の直結Ethernetだけを **Private（プライベート）** にします。
Windowsのネットワーク設定で選べない「識別されていないネットワーク」は、
管理者として **Windows PowerShell** を開き、まず対象のInterfaceIndexを確認します。

```powershell
Get-NetConnectionProfile
Get-NetAdapter
# 15 は例。実際の接続中Ethernetの InterfaceIndex に置き換える
Set-NetConnectionProfile -InterfaceIndex 15 -NetworkCategory Private
New-NetFirewallRule -DisplayName 'CRO-MAGNON Exhibition LAN' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8081 -LocalAddress 10.10.10.1 -RemoteAddress 10.10.10.0/24 -Profile Private
```

これはPC1の指定ポートへの直結サブネットからの受信だけを許可します。
Public全体への許可やFirewall全体の無効化は不要です。ポートを変えた場合は
`LocalPort`も同じ値にします。展示後に規則を消す場合:

```powershell
Remove-NetFirewallRule -DisplayName 'CRO-MAGNON Exhibition LAN'
```

IP・Firewallの変更には管理者権限が必要です。通常のゲーム起動は一般ユーザーで
実行できます。起動スクリプトが他アダプターやFirewallを勝手に変更することはありません。

## 接続設定とOnlineとの切り替え

両PCの `exhibition.env` を同じ値にします（または同形式の
`exhibition.local.env`、環境変数で上書きできます）。IPはゲームコードに埋め込みません。

```ini
MULTIPLAYER_MODE=lan
MULTIPLAYER_SERVER_URL=ws://10.10.10.1:8081
CLIENT_PORT=4173
EXHIBITION_ROOM=EXHIBITION
OPEN_BROWSER=1
```

PC1自身もこのWebSocket URLを使用します。`OPEN_BROWSER=0` ならブラウザーを
自動で開きません。このPCではDockerが8080を使っているため、配布設定は8081です。
8080が空いている環境では両PCのURLとFirewallを8080へ変更できます。
既存プロセスを停止したり、別のポートへ黙って切り替えたりはしません。

**Production / Online** は従来の `npm start` または本番サイトを使います。
通常の `public/multiplayer-config.json` は `mode: online`, `serverUrl: ""` で、
既存の同じホストの `/ws`（HTTPSならwss）を使います。LAN用ランチャーが
そのファイルを上書きすることはありません。別のOnlineサーバーを使う場合は
同ファイルの `serverUrl` にwss URLを指定できます（サーバーのOrigin許可も必要）。
オンラインのCloudflare保存・上限・停止判定は従来どおりです。

## 接続できない場合

- `PC1 Ethernet does not have ...`: PC1の固定IPが設定と違います。`ipconfig` で確認。
- `Port already in use`: 二重起動またはDockerなどとの競合です。
  `netstat -ano | findstr :8081` で確認し、設定ポートを両PCでそろえます。
- `Server reachable at ...`: このランチャーからHTTPの健康診断が成功しました。
  PC1だけのこの表示はPC2からのFirewall通過の証明ではありません。
- PC2で `Test-NetConnection 10.10.10.1 -Port 8081` を実行し
  `TcpTestSucceeded: True` を確認します。pingだけではポート許可を確認できません。
- `LAN: Waiting` / `LAN: 再接続中…`: ケーブル、PC1の起動、IP、Private規則を確認。
  復旧後は自動再接続します。Cloudflareへ切り替える動作はありません。
- ビルド不一致: 両PCに同じ配布フォルダー全体をコピーし直します。
- Connectedなのに相手がいない: 部屋コードが両方EXHIBITIONか確認します。
  右上の地図直下のConnectedだけでなく、左上の部屋コードと **2/5** を確認します。
  両方1/5なら左上の名前→「別の部屋に参加する」→コードを **EXHIBITION** に
  コピー・貼り付け→「この谷へ出発する」。実機試験で `EXIHIBITION` という
  誤入力による別部屋への参加が発生し、修正後にユーザーが合流成功を確認しました。
  プレイヤーごとに違うキャラクターを選ぶと確認しやすくなります。
- localhostはこのPC専用です。PC2へPC1のゲームURLを送って起動する方式は使いません。

## インターネットなしの最終確認

両PCのWi-FiをOFFにし、EthernetがPC同士のケーブルだけになった状態で、
ブラウザーを新しく開き直して手順5〜8を確認します。新規起動で確かめれば
オンラインのブラウザーキャッシュへの依存も検出できます。Google Fonts、
CDN、外部JavaScript、外部APIは使用しません。LANクライアントのCSPは
アセットの外部取得を禁止し、同期接続先だけを許可します。ゲーム内の考古資料への
リンクは任意の参考リンクで、オフラインでは閲覧できません。

実PC2・物理ケーブル・Wi-Fi OFFでの確認は、同一PC上の2ブラウザー試験とは
別の確認です。検証結果と残る確認事項は `assets/exhibition-lan/qa-summary.json` を参照してください。

LANでは自キャラの歩行・走行・経路移動・舟・騎乗をローカルで予測し、
サーバーの位置へ補正します。衝突・速度・舟の海岸と海流は既存の規則を使用します。
250ms以上状態が届かない場合は予測を止め、切断・被弾・乗降・大きい位置変更で
入力をリセットします。他プレイヤーは既存の補間を維持します。
攻撃の命中、在庫、採集、敵と共有ワールドの結果はサーバーが確定します。
