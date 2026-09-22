# 現行の4台構成について

PC3の予備機とPC0の展示代行を含む現行手順は [README-EXHIBITION-4PC.md](README-EXHIBITION-4PC.md) を使ってください。
この文書の3台構成と初回の疎通・配布結果は過去の記録です。現在の接続・配布完了を示すものではありません。

# CRO-MAGNON 展示3台運用手順（PC0・PC1・PC2）

更新日: 2026-09-22。この文書を、3台構成の役割、SSH、修正、配布、切替、復旧に
関する現行の正本とします。ゲーム自体の起動とLAN診断は
[展示LANの基本手順](README-EXHIBITION.md)、来場者向けWindowsアカウントの方針は
[展示用の安全対策](README-EXHIBITION-SECURITY.md)も参照してください。

### 実機の接続確認（2026-09-22、SSH・Public読み書き確認済み）

- PC0のEthernetを `10.10.10.3/24`、DHCP無効、Private、Gateway/DNSなしに設定済み。
  有線リンクは1 Gbps。Wi-Fiの設定は維持している。
- PC0からPC1 `10.10.10.1` とPC2 `10.10.10.2` へのpingは両方成功（0〜1 ms）。
- 10:55〜11:00の確認で、PC1・PC2の両方に `CRO-MAGNON` 標準ユーザーとして
  鍵認証SSHログインが成功。両PCへのSCP転送も成功し、3ファイルのSHA-256一致を確認済み。
  ホスト鍵の実機画面照合はユーザーの明示指示で省略し、前回取得した鍵から変更がないことを
  確認して登録した。以後の厳密なホスト鍵検証は有効にしている。
  PC1の8081は初期確認でタイムアウトしており、ゲーム起動を確認した記録ではない。
- このPC0には旧展示用SSH秘密鍵がなかったため、パスフレーズ付きEd25519鍵を機体別に作成し、
  両方ともSSHエージェントへの登録を確認済み。秘密鍵はPC0の `.ssh` にだけ保持している。
  PC1/PC2の標準ユーザーへの公開鍵登録と、その鍵による認証成功を確認済み。
  SSH鍵のファイルがあること、ポートが開くこと、認証成功は別々に確認する。
- PC0のWindows `ssh-agent` を自動起動に設定し、稼働を確認済み。
- PC0のSSH接続名 `cro-pc1` / `cro-pc2` を作成済み。ユーザーは両方とも `CRO-MAGNON`、
  鍵は機体ごとに分離。専用 `known_hosts` へ上記の承認に基づき登録し、厳密なホスト鍵確認を使う。
- ユーザーから、PC1/PC2の `CRO-MAGNON` アカウントは作成済みとの確認あり。
  初回登録キットはGit対象外の `output/lan-setup-2026-09-22/display-setup-kit.zip` に作成。
  初回配信用の `http://10.10.10.3:4189/` はSSH/SCP成功後の11:02に停止。
  `CRO-MAGNON-Temporary-SSH-Setup-20260922` のFirewall規則も11:04の管理者処理で削除済み。
- 09:28の再確認では、配信が以前の1時間制限で停止し、PC0のEthernetもPublicに変わっていた。
  自動終了を撤去し、配信許可の設定時に対象Ethernetの機体情報と `10.10.10.3/24` を照合して
  Privateへ設定するよう変更した。Wi-Fiや他アダプターの分類は変更しない。
  09:29に配信を再開し、09:30:52にはPC2から設定ページへの実アクセスを確認。
  09:34にはPC1からのページ・ZIP取得も確認。Privateへ戻す管理者確認はキャンセルとして終了し、
  10:47時点のPC0 EthernetはPublicだったが、11:04の管理者処理でPrivateへ変更し、実状態も確認済み。
- 初回のSSHログイン後、両PCとも `C:\Users\Public` と `C:\Users\Public\CRO-MAGNON` へのアクセス拒否を確認。
  初回SSHスクリプトに不足していたPublic権限設定を
  `scripts/setup-exhibition-public-folders.ps1` として追加した。最初に使った展示ユーザーの
  個人フォルダーは別のログインユーザーでは開けないため、両PCの
  `C:\ProgramData\CRO-MAGNON-Setup-20260922\Public-Setup.cmd` へ補修用ファイルを配置し直した。
  3ファイルのSHA一致と、ローカルUsersの読み取り・実行権限を確認済み。この一時領域に秘密鍵や
  ゲーム本体は置かない。
- ユーザーによる両PCの設定実行後、11:45にPC0から両方のSSHコマンド実行と、
  `C:\Users\Public\CRO-MAGNON\incoming`・`releases` での一時ファイルの作成・読み取り・
  追記・削除がすべて成功。展示ユーザーは両方とも標準ユーザーのまま。
  11:46に両PCの固定IPとPublicの3フォルダーの存在を確認し、`releases` 直下に版フォルダーは
  検出されなかった。ProgramDataの設定結果JSONは取得できていないが、実際の読み書きで確認した。
  記録は `output/lan-setup-2026-09-22/cro-pc1-file-access-latest.json` / `cro-pc2-file-access-latest.json`
  と、同じ場所の `cro-pc1-display-state-latest.json` / `cro-pc2-display-state-latest.json`。
- 次回の初回設定用に、SSHとPublic権限をまとめて設定するキット生成スクリプトを追加。
  `Setup-PC1.cmd` / `Setup-PC2.cmd` の1回の実行で両方を設定する。両処理が成功した場合だけ
  完了を表示する。現在の更新キットは `output/exhibition-setup-20260922-r04.zip`。
  r03ではPC1のゲーム同期用TCP8081を展示LANからだけ許可する設定も含む。
  Windows PowerShell 5.1で4スクリプトの構文、ZIPの9ファイルと8件のSHA、起動CMD2件、
  Publicヘルパー欠落時の停止、既存ZIPの上書き拒否を確認した。
  r04ではSSH経由の初期設定をエラーで止め、展示画面へ管理者確認を出さない。
  記録は `output/verify-exhibition-setup-r04-result.json`。統合版の展示PC上での一括実行はまだ行っていないが、
  PublicとPC1のゲーム通信許可は各補助スクリプトで実機設定・通信確認を完了した。
- PC0変更前の設定と実行結果は、Git対象外の `output/lan-setup-2026-09-22/` に保存。
  以下の配布記録より前の作業ではゲームの更新・起動・停止は実施していない。

### 展示ゲームの配布と起動（2026-09-22）

両PCの現在の版は `C:\Users\Public\CRO-MAGNON\releases\exhibition-20260922-1200`。
`buildId` は `f89f86b303cdb6c4aa314a61e75735bedd31ce4443d7b8bb4a9dfa2ed0cc5694`、
ZIPのSHA-256は `025371f4b85ff58e18cd76fb4930ce348a85a8958793b4efb3d0c2a26c765e23`。
全394ファイル・78GLBをPC0/PC1/PC2で照合し、Node.js v24.16.0と対応する公式LICENSEを同梱。
配布処理を最新LOD名と洞窟の外部画像3件に対応させ、全689テスト・型・375JS構文・依存境界を確認。
女性2体の `lod-face-r10.glb` を含む16個の性能LODも同梱されている。

PC1の新版ホストとPC2の新版クライアントは、各機の `CRO-MAGNON` 標準ユーザーの対話セッション2で起動。
両PCのPublic直下にあった旧版は保持し、PC2の旧クライアントPID25828だけを実行パス・旧buildIdで
照合して停止した。旧PC1/PC2は異なるbuildIdだったため、旧版は混在して使用しない。
PC1のホストは配布前に停止しており、新しい展示ワールドで起動した。

PC1でユーザーが管理者確認を承認し、Privateの `10.10.10.1:8081` を
`10.10.10.0/24` から許可する `CRO-MAGNON-Exhibition-LAN` 規則を設定済み。
PC2からホストへのHTTP健康診断・buildId一致が成功し、両PCそれぞれのlocalhost配信から
HTMLと最新素材の8ファイルのSHA一致を確認。専用 `LAN-QA-0922` 部屋へ両実機から同時に接続し、
PC1から見たPC2の移動4.67mと攻撃、PC2から見たPC1の移動4.38mと攻撃の同期を確認した。
この検査は通信プログラムによるもので、実画面の操作・描画の検査とは区別する。

通常起動は新しい版のBATを各PCで実行する。今回用意した手動実行タスクを使う場合は、
各PCで `CRO-MAGNON` にログインした状態で、PC0から次のコマンドでも起動できる。
タスクは管理者昇格なし・定期実行なしで、その展示ユーザーの画面にランチャーを開く。

```powershell
ssh cro-pc1 schtasks /Run /TN CRO-MAGNON-PC1-exhibition-20260922-1200
ssh cro-pc2 schtasks /Run /TN CRO-MAGNON-PC2-exhibition-20260922-1200
```

両PCの画面用URLは、それぞれのPCで `http://localhost:4173/?room=EXHIBITION`。
起動補助とログは各PCの `C:\Users\Public\CRO-MAGNON\operations\exhibition-20260922-1200`。
証拠はPC0の `output/lan-setup-2026-09-22/` の `deployment-*.json`、
`cro-pc*-installed-release.json`、`cro-pc*-http-assets.json`、`lan-peer-PC*.json` を参照。
パッケージはGit HEAD `aa9b8b6c3408f04e2689ce3ce252fc5690c2ea07` と、この作業の配布処理・手順書変更から作成。
この配布ではゲームソースの変更・通常3000番の再起動は行っていない。

## 最初に自分の役割を判定する

PowerShellで次を実行します。

```powershell
hostname
Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -Like '10.10.10.*'
```

| 呼称 | Ethernet IPv4 | 役割 | 当日に起動するもの |
| --- | --- | --- | --- |
| **PC0** | `10.10.10.3/24` | 裏方。GitHub、修正、検査、展示ビルド、PC1/PC2へのSSH配布 | 通常はゲームを起動しない |
| **PC1** | `10.10.10.1/24` | 表の展示機1。共有ゲームサーバーとプレイヤー1の画面 | `start-exhibition-host.bat` |
| **PC2** | `10.10.10.2/24` | 表の展示機2。プレイヤー2の画面 | `start-exhibition-client.bat` |

IPと表が一致しない場合は、自分の判断で別の役割を起動せず、固定IPと機体ラベルを
先に確認してください。PC1とPC2を入れ替えると、サーバーIPとBATの役割も変わります。

## 構成と通信

```text
GitHub / Internet
       |
   Wi-Fi等（PC0だけ。必要なとき）
       |
PC0 10.10.10.3  ─┐
PC1 10.10.10.1  ─┼─ Ethernetハブ（10.10.10.0/24、Gateway/DNSなし）
PC2 10.10.10.2  ─┘

PC0 -- SSH/SCP TCP 22 --> PC1 / PC2
PC1 <-- ゲーム同期 TCP 8081 --> PC2
PC1 / PC2 -- localhost TCP 4173 --> 各PC自身のブラウザー
```

- Ethernetは3台とも `255.255.255.0`（プレフィックス長24）です。
- 展示EthernetのGatewayとDNSは空欄にします。
- PC0はGitHub接続用のWi-Fiを併用できます。EthernetとWi-Fiの「ブリッジ」や
  インターネット接続共有は有効にしません。
- PC1/PC2は最終試験と展示中にWi-FiをOFFにできます。ゲームはEthernetだけで動きます。
- PC0は同期サーバーではありません。PC0を切っても、すでに起動中のPC1/PC2の展示は
  継続します。

## 変更してはいけない基本方針

1. ソース、`.git`、GitHub認証、開発用環境変数はPC0だけに置きます。
2. PC1/PC2には、`scripts/build-exhibition.mjs` が作った完成フォルダーだけを置きます。
3. SSH秘密鍵はPC0から出しません。PC1用とPC2用に別々の鍵を作ります。
4. PC1/PC2のSSH接続先と展示ログインは、管理者ではない専用の標準ユーザーにします。
5. 起動中のリリースへファイルを上書きしません。新しい版は別フォルダーへ先に展開します。
6. PC1とPC2は常に同じ `buildId` を使います。片方だけ更新した状態で展示を再開しません。
7. PC1のホスト停止はメモリー上の展示ワールドをリセットします。切替は来場者対応が
   一段落した時刻に行います。
8. 直前の正常版をPC1/PC2の両方に残します。問題があれば両方を同じ旧版へ戻します。
9. SSHは修正成果物の搬入と診断に使います。ゲームの通常起動は各展示機の画面でBATを
   ダブルクリックします。SSHセッションからブラウザーを起動しても、来場者の
   デスクトップへ表示されるとは限りません。

## 1回だけ行うWindowsとフォルダーの準備

### 1. 固定IPとネットワーク

3台をEthernetハブへ接続し、上表の固定IPを設定します。ネットワークプロファイルは
`Private` にします。PC0から次を確認します。

```powershell
Test-NetConnection 10.10.10.1 -Port 8081
Test-NetConnection 10.10.10.1 -Port 22
Test-NetConnection 10.10.10.2 -Port 22
```

最初の設定前はポートが閉じていて構いません。準備完了後はすべて
`TcpTestSucceeded: True` になります。8081はPC1のホスト起動中だけ成功します。

### 2. PC1/PC2の標準ユーザーと配布領域

推奨する展示ユーザー名は両方とも `CRO-MAGNON` です。実際の名前が違う場合は、以下の
`CRO-MAGNON` を実在する標準ユーザー名へ置き換え、機体ごとの記録に残してください。
このユーザーを `Administrators` グループへ追加しません。

その標準ユーザーで一度ログインしてから、後述の「SSHとPublicをまとめて初回設定する」の
キットを使います。配布領域の作成と権限設定も含むため、個別にPublic設定を行う必要はありません。
既にSSH設定済みのPCでPublic権限だけを補修する場合は、次の補助スクリプトをコピーし、
対象PCの管理者PowerShellで実行します。`E:` は実際のコピー先へ置き換えてください。

```powershell
& E:\setup-exhibition-public-folders.ps1 -DisplayUser CRO-MAGNON
```

- `C:\Users\Public\CRO-MAGNON\incoming`: PC0から受け取るZIPの一時置き場です。
- `C:\Users\Public\CRO-MAGNON\releases`: 展開済みの版を、版ごとの別フォルダーで保持します。
- `current` のような実体フォルダーを上書きする運用はしません。

SSHはNETWORKログオンなので、PublicのINTERACTIVEログオン向け権限だけではアクセスできない
環境があります。`scripts/setup-exhibition-public-folders.ps1` は、管理者として対象PC上で実行すると、
元のACLを保存し、Public自体には展示ユーザーの読み取り・通過権限を「このフォルダーのみ」で追加します。
`CRO-MAGNON`・`incoming`・`releases` はSYSTEM/Administratorsにフルコントロール、
展示ユーザーに変更権限を設定します。元の権限はスクリプトと同じフォルダーの
`public-permissions-before-*.json` に毎回別名で保存します。
Public内の他フォルダーへ権限を継承させず、ゲームファイルのコピー・更新・起動・停止は行いません。
既存の明示的なACLは保持し、リンクやジャンクションを配置先として処理しません。

## Windows OpenSSHの初期設定

通常は、下の「SSHとPublicをまとめて初回設定する」を使います。
PC0側の鍵の準備は必要ですが、PC1/PC2側のOpenSSH導入・鍵登録・Public設定の手作業は不要です。
各項の個別コマンドは、設定内容の確認や補修用です。

MicrosoftのWindows OpenSSHでは、標準ユーザーの公開鍵は
`C:\Users\<ユーザー>\.ssh\authorized_keys` に置きます。既定設定でAdministrators
グループに所属するユーザーだけが
`C:\ProgramData\ssh\administrators_authorized_keys` を使います。本構成は標準ユーザーを
使うので、`ProgramData`側へ展示用の鍵を入れません。

参考:
[Win32-OpenSSHの公開鍵認証](https://github.com/PowerShell/Win32-OpenSSH/wiki/Setup-public-key-based-authentication-for-windows)、
[鍵ファイルの権限](https://github.com/PowerShell/Win32-OpenSSH/wiki/Security-protection-of-various-files-in-Win32-OpenSSH)

### 1. PC0にOpenSSH Clientを用意する

PC0の管理者PowerShellで状態を確認し、未導入のときだけ追加します。

```powershell
Get-WindowsCapability -Online | Where-Object Name -Like 'OpenSSH.Client*'
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
```

### 2. PC1/PC2にOpenSSH Serverを用意する

PC1とPC2の管理者PowerShellで実行します。

```powershell
Get-WindowsCapability -Online | Where-Object Name -Like 'OpenSSH.Server*'
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service sshd -StartupType Automatic
```

OpenSSHの既定の広い受信規則があれば、PC0だけを許可する規則を先に作ってから無効にします。
PC1では `LocalAddress` を `.1`、PC2では `.2` にします。

```powershell
# PC1
New-NetFirewallRule -DisplayName 'CRO-MAGNON SSH from PC0' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 22 -LocalAddress 10.10.10.1 -RemoteAddress 10.10.10.3 -Profile Private

# PC2では上のLocalAddressだけ10.10.10.2に変更

Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue | Disable-NetFirewallRule
```

PC1のゲーム同期用8081は、既存の展示LAN規則で `10.10.10.0/24` からだけ許可します。
Firewall全体を無効化したり、SSHをPublicネットワーク全体へ公開したりしません。

### 3. PC0でPC1用・PC2用の鍵を別々に作る

PC0の普段のユーザーで実行します。秘密鍵にはパスフレーズを設定します。

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.ssh" | Out-Null
ssh-keygen -t ed25519 -a 64 -f "$env:USERPROFILE\.ssh\cro-magnon-pc1" -C 'CRO-MAGNON PC0 to PC1'
ssh-keygen -t ed25519 -a 64 -f "$env:USERPROFILE\.ssh\cro-magnon-pc2" -C 'CRO-MAGNON PC0 to PC2'
```

生成物は次のように扱います。

| ファイル | 置く場所 |
| --- | --- |
| `cro-magnon-pc1` | PC0だけ。PC1へコピーしない |
| `cro-magnon-pc1.pub` | PC1の展示標準ユーザーへ登録 |
| `cro-magnon-pc2` | PC0だけ。PC2へコピーしない |
| `cro-magnon-pc2.pub` | PC2の展示標準ユーザーへ登録 |

GitHub用SSH鍵と展示配布用SSH鍵は兼用しません。秘密鍵、パスフレーズ、
`authorized_keys`、実機のホスト秘密鍵をGitへ追加しません。

### 4. 各公開鍵を標準ユーザーへ登録する

最初の1回は、PC0からUSBなどで **`.pub`だけ** を対象PCへ運びます。PC1ではPC1用、
PC2ではPC2用だけを登録します。対象PCへ展示標準ユーザーでログインしてPowerShellを開き、
USBのドライブ文字を実際のものへ置き換えて実行します。

```powershell
$keyDir = "$env:USERPROFILE\.ssh"
$authorized = "$keyDir\authorized_keys"
$account = "$env:USERDOMAIN\$env:USERNAME"
New-Item -ItemType Directory -Force $keyDir | Out-Null
$publicKey = (Get-Content 'E:\cro-magnon-pc1.pub' -Raw).Trim()
$existing = @(Get-Content $authorized -ErrorAction SilentlyContinue)
if ($existing -notcontains $publicKey) { Add-Content -LiteralPath $authorized -Value $publicKey -Encoding ascii }
icacls $keyDir /inheritance:r
icacls $keyDir /grant:r "${account}:(OI)(CI)F" "SYSTEM:(OI)(CI)F"
icacls $authorized /inheritance:r
icacls $authorized /grant:r "${account}:F" "SYSTEM:F"
```

PC2ではコピー元を `cro-magnon-pc2.pub` にします。複数鍵を登録する場合は、公開鍵を
1行ずつ追記します。秘密鍵は絶対にUSBでPC1/PC2へ運びません。

#### SSHとPublicをまとめて初回設定する

PC0で機体別の公開鍵を作成した後、リポジトリのルートからキットを生成します。

```powershell
.\scripts\build-exhibition-setup-kit.ps1 -PublicKeyDirectory "$env:USERPROFILE\.ssh"
```

このコマンドは `cro-magnon-pc1.pub` と `cro-magnon-pc2.pub` だけを読み、3本の設定スクリプト、
機体別の起動CMD、説明とSHA-256一覧を含むZIPを `output/exhibition-setup-日時.zip` に作成します。
秘密鍵は読み取らず、既存のキットも上書きしません。

1. PC1/PC2に固定IPと標準ユーザーを用意し、そのユーザーで一度ログインします。
2. キットのZIPをUSBなどで運び、**今操作しているユーザーが開けるフォルダーへ全体を展開**します。
   別ユーザーの個人フォルダーに置いたり、ZIP内から直接実行したりしません。
3. PC1では `Setup-PC1.cmd`、PC2では `Setup-PC2.cmd` を実行し、各PCで管理者確認を承認します。
4. Public配布領域と権限、OpenSSH Serverの導入・起動、公開鍵、Private LAN上のPC0だけを
   許可するFirewall規則を順に設定します。PC1ではゲーム同期用TCP8081を展示LANから許可する
   規則も設定します。別途 `Public-Setup.cmd` や8081許可の管理者作業を行う必要はありません。
5. 両方の処理が成功した場合だけ完了を表示し、キットのフォルダーへ `setup-PC1-result.json`
   または `setup-PC2-result.json` を保存します。失敗時は画面に出たエラーを確認します。
6. 次項でホスト鍵を照合し、PC0からSSH接続とPublicへの読み書きを確認します。

Public用スクリプトが欠けている場合は設定開始前に止まり、Publicの設定に失敗した場合は
SSH設定へ進みません。途中で失敗した場合、それまでの変更は残るため、原因を直して再実行します。
ユーザー作成、固定IP変更、ゲームのコピー・更新・起動は行いません。
実行ポリシーの変更は設定用PowerShellプロセスだけに適用します。

手動で実行する場合も、`setup-exhibition-ssh-display.ps1` と
`setup-exhibition-public-folders.ps1` を**同じフォルダーへ**コピーしてください。
対象PC自身の管理者PowerShellで実行します。例の `E:` は実際のコピー先へ置き換えます。

```powershell
# PC1で実行
& E:\setup-exhibition-ssh-display.ps1 -Role PC1 -DisplayUser CRO-MAGNON -PublicKeyFile E:\cro-magnon-pc1.pub
# PC2で実行
& E:\setup-exhibition-ssh-display.ps1 -Role PC2 -DisplayUser CRO-MAGNON -PublicKeyFile E:\cro-magnon-pc2.pub
```

スクリプトは鍵フォルダーと `authorized_keys` の所有者を対象ユーザーにし、
アクセス権をそのユーザー・SYSTEM・Administratorsに限定します。既存の鍵は保持し、
新しい鍵には接続元 `10.10.10.3` の制限を付けます。既定の広いOpenSSH受信規則は無効にしますが、
別途作られた独自のFirewall規則や `sshd_config` は変更しません。既存設定でログインが拒否される場合は
その内容を確認してから調整します。最後に表示されるホスト鍵の指紋を、次項でPC0側と照合してください。
従来版では両PCのSSH/SCP成功を確認済みです。Publicを含む統合版は別途、
構文・配布ZIPの同梱内容・欠落時の停止を確認し、実機での一括実行は未実施です。

### 5. ホスト鍵を照合して接続を試す

PC1/PC2の管理者PowerShellで、それぞれのSSHホスト公開鍵の指紋を表示します。

```powershell
ssh-keygen -lf C:\ProgramData\ssh\ssh_host_ed25519_key.pub
```

PC0の初回接続で表示される指紋が、対象PCの画面に出した値と同じことを目で確認してから
`yes` を入力します。

```powershell
ssh -i "$env:USERPROFILE\.ssh\cro-magnon-pc1" CRO-MAGNON@10.10.10.1 hostname
ssh -i "$env:USERPROFILE\.ssh\cro-magnon-pc2" CRO-MAGNON@10.10.10.2 hostname
```

鍵ログインが両方で成功した後、必要ならPC1/PC2の管理者が
`C:\ProgramData\ssh\sshd_config` を次の方針にし、`sshd.exe -t` で検査してから
サービスを再起動します。

```text
PubkeyAuthentication yes
PasswordAuthentication no
AllowUsers cro-magnon
```

```powershell
& "$env:WINDIR\System32\OpenSSH\sshd.exe" -t
Restart-Service sshd
```

既存の別SSHユーザーがいるPCで `AllowUsers` や `PasswordAuthentication` を変更すると、
その接続を止める可能性があります。必ずローカル画面から復旧できる状態で行います。

## 毎日の展示起動

### PC0

1. PC0・PC1・PC2がハブにつながり、上表のIPであることを確認します。
2. PC1が起動した後、必要なら `Test-NetConnection 10.10.10.1 -Port 8081` を確認します。
3. 不具合対応がなければ、ゲームや展示BATを起動しません。
4. GitHub認証とSSH秘密鍵が見えないよう、PC0は来場者から操作できない場所に置きます。

### PC1

1. 展示標準ユーザーでログインします。
2. 使用するリリースフォルダーの `start-exhibition-host.bat` をダブルクリックします。
3. 起動ウィンドウを閉じません。
4. ブラウザーで部屋 `EXHIBITION`、`LAN: Connected` を確認します。

### PC2

1. 展示標準ユーザーでログインします。
2. PC1のホスト起動後、同じリリースの `start-exhibition-client.bat` を実行します。
3. 部屋 `EXHIBITION`、`LAN: Connected`、人数 `2/5` を確認します。

通常終了はPC2を先、PC1を最後に `Ctrl+C` で止めます。PC1停止時に展示ワールドが
リセットされます。

### PC1 / PC2のコントローラー表記

新しい配布版では `exhibition.env` に `PC1_CONTROLLER_LAYOUT=ps4` と
`PC2_CONTROLLER_LAYOUT=switch-pro` を指定する。PS4の○／×／□／△に対応する表示は、
Switch ProではA／B／Y／Xになる。操作説明・地図・近接案内まで同じ設定を使う。
後で機種を変えるときは、そのPCの稼働中の配布フォルダーの該当行を変更し、
体験の区切りでそのブラウザーだけを再読み込みする。
`exhibition.local.env` に同じキーを書くとそちらを優先する。
表記変更のためのホスト再起動・再ビルド・管理者権限は不要。
詳細は [コントローラー表記の変更手順](README-EXHIBITION.md#pcごとのコントローラー表記) を参照。

## 展示中に不具合を直して配布する

### 展示中に権限確認を出さない

PC0からの操作で、来場者のPC1/PC2に管理者確認や権限確認を出しません。
Publicの権限、SSH、PC1のゲーム用TCP8081の許可は、開場前の初期セットアップで済ませます。
現行の8081許可は実行ファイルのリリースパスに依存しないため、新しい版の別フォルダーを作るたびに
管理者設定をやり直す必要はありません。

展示中に行うZIP転送・展開・SHA照合・状態確認・通常起動は、標準ユーザーのSSHで行います。
通常起動タスクもRunLevel 0で、管理者昇格は使いません。権限が足りなければPC0側へエラーを返し、
その操作を止めます。`Setup-PC*.cmd`、`Public-Setup.cmd`、`Start-Process -Verb RunAs`、
管理者確認を表示する対話タスクを、展示中の復旧方法として使いません。
新たな管理者作業は、ユーザーが展示外の保守として明示的に指示したときに行います。

2026-09-22に使った一時タスク `CRO-MAGNON-PC1-LAN-permission-20260922` と、
`operations/exhibition-20260922-1200/request-exhibition-lan-permission.ps1` は、設定成功後に撤去しました。
撤去時にPC1のゲームPID・開始時刻・buildIdが変わっていないことを確認済みです。
記録は `output/lan-setup-2026-09-22/cro-pc1-admin-prompt-removed.json`。
WindowsのUAC設定と展示ユーザーの標準権限は維持します。

権限確認が不要でも、新版への切替・ゲーム再起動はプレイを中断します。
転送と検証を先に済ませ、切替は来場者対応の区切りで行ってください。

### 1. 現行展示はそのまま動かす

- PC1/PC2の起動中フォルダーを編集しません。
- PC0で、現象、発生操作、現在の `buildId`、PC1/PC2のどちらで見えたかを記録します。
- PC1ホストを止める必要がある調査は、来場者対応の区切りまで待ちます。

### 2. PC0で修正する

PC0のソースリポジトリで作業します。

```powershell
git status --short
git fetch origin
git switch -c codex/exhibition-hotfix-<短い名前> origin/main
```

未保存の作業がある場合は、その状態へ `pull` や強制リセットを重ねません。修正後は、変更に
応じた実ゲーム確認に加えて、最低限次を通します。

```powershell
npm test
npm run check
git diff --check
```

配布する修正は原則としてコミットし、GitHubへpushしたコミットSHAを記録します。緊急時に
ネットが切れている場合も、少なくともローカルコミットを作ってSHAを記録し、接続回復後に
必ずpushします。PC1/PC2からGitHubへアクセスさせません。

### 3. PC0で新しい展示版を作る

出力先は毎回新しい空フォルダーにします。

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$release = "exhibition-$stamp"
node scripts/build-exhibition.mjs "output/$release"
$package = Join-Path (Resolve-Path output) $release
$zip = "$package.zip"
Compress-Archive -Path "$package\*" -DestinationPath $zip
$zipHash = (Get-FileHash -Algorithm SHA256 $zip).Hash
$buildId = (Get-Content "$package\exhibition-build.json" | ConvertFrom-Json).buildId
[pscustomobject]@{ Release = $release; BuildId = $buildId; ZipSHA256 = $zipHash; GitCommit = (git rev-parse HEAD) }
```

表示された `Release`、`BuildId`、`ZipSHA256`、`GitCommit` を作業記録へ残します。

### 4. PC0からPC1/PC2へSSHで先行配置する

展示は旧版のまま継続できます。まず受取フォルダーを作ります。

```powershell
$key1 = "$env:USERPROFILE\.ssh\cro-magnon-pc1"
$key2 = "$env:USERPROFILE\.ssh\cro-magnon-pc2"
ssh -i $key1 CRO-MAGNON@10.10.10.1 'powershell -NoProfile -Command "New-Item -ItemType Directory -Force C:\Users\Public\CRO-MAGNON\incoming | Out-Null"'
ssh -i $key2 CRO-MAGNON@10.10.10.2 'powershell -NoProfile -Command "New-Item -ItemType Directory -Force C:\Users\Public\CRO-MAGNON\incoming | Out-Null"'
scp -i $key1 $zip 'CRO-MAGNON@10.10.10.1:C:/Users/Public/CRO-MAGNON/incoming/'
scp -i $key2 $zip 'CRO-MAGNON@10.10.10.2:C:/Users/Public/CRO-MAGNON/incoming/'
```

各PCへSSHログインし、PowerShellでZIPのSHA-256をPC0の値と照合してから、同じ名前の
リリースフォルダーへ展開します。次はPC1の例です。PC2でも同じ操作をします。

```powershell
ssh -i "$env:USERPROFILE\.ssh\cro-magnon-pc1" CRO-MAGNON@10.10.10.1
powershell -NoProfile
$release = 'exhibition-YYYYMMDD-HHMMSS'
$zip = "C:\Users\Public\CRO-MAGNON\incoming\$release.zip"
$target = "C:\Users\Public\CRO-MAGNON\releases\$release"
Get-FileHash -Algorithm SHA256 $zip
New-Item -ItemType Directory -Force $target | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $target
Push-Location $target
& '.\runtime\node.exe' --input-type=module -e "import('./scripts/exhibition-integrity.mjs').then(async ({verifyExhibition}) => console.log((await verifyExhibition(process.cwd())).buildId))"
Pop-Location
exit
exit
```

PC0、PC1、PC2でZIPのSHA-256が一致し、PC1/PC2で表示された完全な `buildId` が一致する
までは切り替えません。

### 5. 短い停止時間で両方を切り替える

1. 来場者へ一時停止を案内します。
2. PC2の旧クライアントを `Ctrl+C` で止めます。
3. PC1の旧ホストを `Ctrl+C` で止めます。この時点で旧展示ワールドは終了します。
4. PC1の新リリースで `start-exhibition-host.bat` を実行します。
5. PC1の検証完了と8081待受を確認します。
6. PC2の同じ新リリースで `start-exhibition-client.bat` を実行します。
7. 両方の `buildId`、部屋 `EXHIBITION`、`LAN: Connected`、人数 `2/5` を確認します。
8. 移動、向き、攻撃、採集を片方ずつ行い、相手側へ反映されることを確認します。

ビルド不一致時はサーバーが参加を拒否します。片方だけ旧版のまま続行しません。

## ロールバック

新版で重大な問題が出た場合:

1. PC2新版を止めます。
2. PC1新版を止めます。
3. PC1で直前の正常リリースのホストBATを起動します。
4. PC2で同じ旧リリースのクライアントBATを起動します。
5. `buildId`、`LAN: Connected`、`2/5`、相互操作を確認します。
6. 問題の新版フォルダーは削除せず、名前に `-FAILED` を付けるか記録で使用禁止にします。

ロールバックでもPC1を止めるため、展示ワールドはリセットされます。PC1/PC2で異なる旧版へ
戻さないでください。

## 障害の切り分け

### PC0からSSHできない

```powershell
Test-NetConnection 10.10.10.1 -Port 22
Test-NetConnection 10.10.10.2 -Port 22
ssh -vvv -i "$env:USERPROFILE\.ssh\cro-magnon-pc1" CRO-MAGNON@10.10.10.1 hostname
```

- TCP 22が閉じている: ケーブル、IP、Privateプロファイル、`sshd`、Firewallを確認。
- `Permission denied`: 対象の `.pub`、標準ユーザーの `authorized_keys`、NTFS権限を確認。
- `administrators_authorized_keys` を要求される: 展示ユーザーがAdministratorsに入っていないか確認。
- ホスト鍵が変わった: すぐ `known_hosts` を消さず、対象PCのローカル画面で新しい指紋を確認。
  正当な再インストールだと確認できた後だけ `ssh-keygen -R 10.10.10.1` などで旧記録を除去。
- SSHが直らなくても、すでに起動中の旧展示は止めません。緊急時はUSBで同じZIPを両方へ運べます。

### 配布できたが起動しない

- ZIP SHA-256と `buildId` を3台で比較します。
- ZIPの中身ではなく、展開後フォルダー直下のBATを起動します。
- `runtime`、`dist`、`public`、`scripts` を部分的にコピーし直しません。ZIP全体を再配置します。
- 4173/8081の旧プロセスが残っていないか確認します。
- PC1の固定IPが `10.10.10.1` でなければホストBATは意図的に停止します。

### Connectedだが互いに見えない

両方の部屋名が正確に `EXHIBITION` で、人数が `2/5` か確認します。`LAN: Connected` は
サーバー到達だけを示し、同じ部屋にいる保証ではありません。

## GitHubへ含めるもの・含めないもの

含めるもの:

- この手順書と一般化したIP・役割・コマンド
- 展示ビルドスクリプト、BAT、非秘密の `exhibition.env`
- 個人情報を含まない検証結果と既知の制約

含めないもの:

- PC0のSSH秘密鍵とパスフレーズ
- PC1/PC2のSSHホスト秘密鍵
- GitHubトークン、ブラウザー認証、個人の`.env`
- `authorized_keys` の実ファイル
- 個人名、PIN、パスワード、会場の不要なネットワーク情報

## 役割別の最終チェック

### PC0

- [ ] IPは `10.10.10.3`
- [ ] ソースとGitHub認証はPC0だけ
- [ ] PC1用・PC2用の秘密鍵は別で、PC0だけに存在
- [ ] 配布版のGit SHA、buildId、ZIP SHA-256を記録
- [ ] 同一ZIPをPC1/PC2へ送り、両方で検証
- [ ] 切替後の `2/5` と相互操作を確認

### PC1

- [ ] IPは `10.10.10.1`
- [ ] 標準ユーザーでログイン
- [ ] PC0からだけSSHを許可
- [ ] PC0から標準ユーザーでPublicのincoming/releasesに読み書きできる
- [ ] PC2と同じbuildId
- [ ] ホストBATを実行し、ウィンドウを開いたままにする
- [ ] 停止すると展示ワールドがリセットされることを理解

### PC2

- [ ] IPは `10.10.10.2`
- [ ] 標準ユーザーでログイン
- [ ] PC0からだけSSHを許可
- [ ] PC0から標準ユーザーでPublicのincoming/releasesに読み書きできる
- [ ] PC1と同じbuildId
- [ ] クライアントBATを実行
- [ ] `EXHIBITION`、`LAN: Connected`、`2/5` を確認
