# CRO-MAGNON 展示3台運用手順（PC0・PC1・PC2）

更新日: 2026-09-22。この文書を、3台構成の役割、SSH、修正、配布、切替、復旧に
関する現行の正本とします。ゲーム自体の起動とLAN診断は
[展示LANの基本手順](README-EXHIBITION.md)、来場者向けWindowsアカウントの方針は
[展示用の安全対策](README-EXHIBITION-SECURITY.md)も参照してください。

### 実機の接続確認（2026-09-22、設定作業中）

- PC0のEthernetを `10.10.10.3/24`、DHCP無効、Private、Gateway/DNSなしに設定済み。
  有線リンクは1 Gbps。Wi-Fiの設定は維持している。
- PC0からPC1 `10.10.10.1` とPC2 `10.10.10.2` へのpingは両方成功（0〜1 ms）。
- PC2のTCP 22は応答し、Windows OpenSSHの待ち受けを確認済み。
  PC1のTCP 22と8081はタイムアウト。SSHログイン成功やゲーム起動を確認した記録ではない。
- このPC0には旧展示用SSH秘密鍵がなかったため、パスフレーズ付きEd25519鍵を機体別に作成し、
  両方ともSSHエージェントへの登録を確認済み。秘密鍵はPC0の `.ssh` にだけ保持している。
  PC1/PC2の標準ユーザーへの公開鍵登録は未完了。
  SSH鍵のファイルがあること、ポートが開くこと、認証成功は別々に確認する。
- PC0のWindows `ssh-agent` を自動起動に設定し、稼働を確認済み。
- PC0のSSH接続名 `cro-pc1` / `cro-pc2` を作成済み。ユーザーは両方とも `CRO-MAGNON`、
  鍵は機体ごとに分離。専用 `known_hosts` はホスト鍵の照合後に登録し、厳密なホスト鍵確認を使う。
- ユーザーから、PC1/PC2の `CRO-MAGNON` アカウントは作成済みとの確認あり。
  初回登録キットはGit対象外の `output/lan-setup-2026-09-22/display-setup-kit.zip` に作成。
  一時配信は `http://10.10.10.3:4189/`（PC1・PC2だけ許可、起動から1時間で終了）。
  登録完了後に一時配信と `CRO-MAGNON-Temporary-SSH-Setup-20260922` のFirewall規則を片付ける。
- PC0変更前の設定と実行結果は、Git対象外の `output/lan-setup-2026-09-22/` に保存。
  ゲームの更新・起動・停止は実施していない。

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

PC1/PC2で一度だけ、管理者PowerShellから配布領域を作り、その標準ユーザーだけに
変更権限を与えます。

```powershell
$displayUser = 'CRO-MAGNON'
$account = "$env:COMPUTERNAME\$displayUser"
$root = 'C:\Users\Public\CRO-MAGNON'
New-Item -ItemType Directory -Force "$root\incoming", "$root\releases" | Out-Null
icacls $root /inheritance:r
icacls $root /grant:r "SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" "${account}:(OI)(CI)M"
```

- `incoming`: PC0から受け取るZIPの一時置き場です。
- `releases`: 展開済みの版を、版ごとの別フォルダーで保持します。
- `current` のような実体フォルダーを上書きする運用はしません。

## Windows OpenSSHの初期設定

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

既存の標準ユーザーがあり、そのユーザーで一度ログイン済みなら、
`scripts/setup-exhibition-ssh-display.ps1` でOpenSSH Serverの導入・起動、公開鍵の登録、
Private LAN上のPC0だけを許可するFirewall規則を設定できます。このスクリプトと
対象PC用の `.pub` をUSBなどで運び、**対象PC自身の管理者PowerShell**で実行します。
ユーザー作成、IP変更、ゲーム起動は行いません。例の `E:` は実際のコピー先へ置き換えます。

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
2026-09-22時点では、この補助スクリプトは構文確認までで、展示PC上での実行は未完了です。

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

## 展示中に不具合を直して配布する

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
- [ ] PC2と同じbuildId
- [ ] ホストBATを実行し、ウィンドウを開いたままにする
- [ ] 停止すると展示ワールドがリセットされることを理解

### PC2

- [ ] IPは `10.10.10.2`
- [ ] 標準ユーザーでログイン
- [ ] PC0からだけSSHを許可
- [ ] PC1と同じbuildId
- [ ] クライアントBATを実行
- [ ] `EXHIBITION`、`LAN: Connected`、`2/5` を確認
