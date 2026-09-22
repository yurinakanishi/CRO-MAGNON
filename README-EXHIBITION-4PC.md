# CRO-MAGNON 展示運用：PC0・PC1・PC2・予備PC3

この文書が4台構成の現行手順です。`README-EXHIBITION-3PC.md` の3台構成と
2026年9月22日午前の実施記録は過去の構成として残します。

## 固定の機体番号と、切り替え可能な展示の役割

| 機体 | 有線LAN IPv4 / 24 | 通常 | 故障時 | Windowsユーザー |
| --- | --- | --- | --- | --- |
| PC0 | `10.10.10.3` | 制作・検査・4台への配布 | PC1の代わりにホスト兼プレイヤー1 | 制作はyurin、展示はCRO-MAGNON |
| PC1 | `10.10.10.1` | ホスト兼プレイヤー1 | 通常の展示機 | CRO-MAGNON |
| PC2 | `10.10.10.2` | プレイヤー2 | 通常の展示機 | CRO-MAGNON |
| PC3 | `10.10.10.4` | 最新版を保持して待機 | PC1のホスト、またはPC2のプレイヤー2を代行 | CRO-MAGNON |

機体番号・固定IP・PC名は交換しません。PC3がPC1を代行してもIPは `.4` のままです。
ゲーム内のプレイヤー1／2は、そのときに選んだホスト／クライアントで決まります。
通常はPC1・PC2だけでゲームを起動し、PC0・PC3では予備のゲームを起動しません。

有線は同じハブへ接続し、Privateネットワーク、Gateway/DNSなし。Wi-Fiや開発用の
通常3000番サーバーは、展示の配布・切り替えで変更しません。
機体一覧は `exhibition-fleet.json`。初めて追加するPC名は実機で確認して記入します。

## 開場前だけ行う初期設定

1. 各PCの展示に標準ユーザー `CRO-MAGNON` を使う。既存のアカウントは保持する。
   なければキットが、そのPC上で新しいWindows用パスワードを尋ねて標準ユーザーを作る。
   管理者グループへ追加しない。パスワードをチャットやログへ送らない。
2. 有線LANを表の固定IP `/24` に設定する。`169.254.*` はこの固定IP設定が未完了。
   PC3に接続中の物理Ethernetが1つだけで、IPv4が169.254のみならキットが `.4` を設定する。
   複数の候補や別の設定済みサブネットがある場合は自動で変更しない。
   DHCPを使わない。別のPCと同じIPを割り当てない。
3. PC0でPC1／PC2／PC3それぞれのEd25519鍵をパスフレーズ付きで用意し、
   Windows `ssh-agent` に登録する。既存のPC1／PC2の鍵は再生成しない。
   新規鍵は `scripts/prepare-exhibition-ssh-key.ps1` を対話実行できる。
4. 公開鍵 `.pub` だけを集めて初期設定キットを作る。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare-exhibition-ssh-key.ps1 -Machine PC3 -PublicKeyDirectory .\output\exhibition-keys
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-exhibition-setup-kit.ps1 -PublicKeyDirectory .\output\exhibition-keys
```

公開鍵フォルダーには対象PCの `cro-magnon-pc1.pub`、`cro-magnon-pc2.pub`、
`cro-magnon-pc3.pub` が必要。対象を限定する場合はPowerShellから `-Roles PC0,PC3`
などを渡す。秘密鍵・パスフレーズはコピーせず、Gitにも追加しない。

PC0でキットを作る際に、Microsoft公式のOpenSSHインストーラーを取得して同梱する。
`scripts/exhibition-openssh.json` が版・公式URL・SHA256を固定し、
`scripts/prepare-exhibition-openssh.ps1` がSHAとMicrosoftの署名を照合する。
初回の取得にはPC0のインターネット接続が必要だが、展示PC上の導入は同梱ファイルだけで行う。
既存の `sshd` があればその実行ファイルを使い、セットアップの再実行で自動更新しない。

2026-09-22のPC3では `Add-WindowsCapability` が `0x800f0950` で失敗した。
これはPublic権限処理の後に行うOpenSSH追加の失敗だったため、キットはWindows Update経由の
機能追加を、[Microsoft公式配布版のMSI導入](https://github.com/PowerShell/Win32-OpenSSH/wiki/Install-Win32-OpenSSH-Using-MSI)
へ変更した。`ADDLOCAL=Server` を指定し、MSIが含む共有SSHエージェントも導入される。
導入中はTCP22を一時的に拒否し、広い受信ルールを無効にしてPC0限定のルール・公開鍵・
標準タスクの設定が完了した後だけ拒否を解除する。失敗時は拒否を残し、完全なキットで再実行する。
エラーは `setup-PC*-result.json`、MSIの詳細は `openssh-install-*.log` に記録する。

同梱版は `10.0.0.0p2-Preview`。GitHub配布版はWindowsの追加機能とは更新経路が異なるため、
[Microsoftの案内](https://learn.microsoft.com/en-us/troubleshoot/windows-server/system-management-components/cant-install-openssh-features)
に従い、後の更新は保守時に公式版と署名・SHAを確認して行う。

5. ZIPを対象PCへコピーして全体を展開し、機体と一致する `Setup-PC0.cmd` ～
   `Setup-PC3.cmd` を、そのPC上で実行する。この初回だけWindowsの管理者確認を承認する。
   PC0は普段の制作ユーザーから起動する。PC3をSSH未設定のままPC0から初期設定することはできない。
   ダウンロードできないPCへはUSBなどでキットを渡し、機体に合うCMDを実行する。
6. キットの `setup-PC*-result.json` が成功していることを確認し、PC0からSSHログインと
   Public内の読み書きを実際に検査する。Windowsの画面が閉じたことだけで成功としない。
   未作成のプロファイルはWindowsの[CreateProfile API](https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-createprofile)
   で準備する。ゲームを起動する前にはCRO-MAGNONへサインインする。

初期設定の内容：

- 全PCに `C:\Users\Public\CRO-MAGNON\incoming`、`releases`、`operations` を用意。
  展示ユーザーに変更権限、Public自体には通過・読み取り権限のみ。
  PC0では起動した制作ユーザーにもゲームフォルダーの変更権限を与える。
- PC1／PC2／PC3のSSHはPC0の `10.10.10.3` からだけ受信する。PC0にはSSHサーバーを追加しない。
- PC0／PC1／PC3のゲーム同期TCP8081を、各PCの展示用IP宛て・Private・`10.10.10.0/24`
  からだけ許可する。予備機の通信許可も開場前に済ませる。
- 各PCのタスク `CRO-MAGNON-Exhibition` を、CRO-MAGNON・RunLevel 0・
  対話ログオン・手動起動専用として登録。自動ログオンや管理者起動は設定しない。
- 元のPublic ACLはキット内の `public-permissions-before-*.json` に退避する。

初回SSHでは、PC上に表示されたホスト鍵の指紋とPC0で取得した指紋を照合してから登録する。
`StrictHostKeyChecking=yes` を維持し、指紋が変わったときに自動で信頼し直さない。
PC0のSSH設定は次の形式で、PC1／PC2／PC3それぞれに別の鍵を割り当てる。

```text
Host cro-pc3
    HostName 10.10.10.4
    User CRO-MAGNON
    IdentityFile ~/.ssh/cro-magnon-pc3
    IdentitiesOnly yes
    PreferredAuthentications publickey
    StrictHostKeyChecking yes
    UserKnownHostsFile ~/.ssh/cro-magnon-known-hosts
    ConnectTimeout 5
```

## 毎回のゲーム変更は4台へ同じ版を配布する

ユーザー指定の継続方針：今後このプロジェクトでゲームを変更した場合は、PC1／PC2だけでなく
PC0／PC3の予備用Public配置も更新する。予備機だけ古い版を残さない。
公開サイトへのデプロイとは別の処理であり、この方針だけで公開サイトを更新しない。

変更に必要なビルド・テスト・素材検証を済ませ、体験の区切りでPC0の制作ユーザーから実行する。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\exhibition-fleet.ps1 -Action Status
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\exhibition-fleet.ps1 -Action Deploy
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\exhibition-fleet.ps1 -Action Verify
```

`Deploy` は一度だけWindows用オフラインビルドとZIPを作り、4台へ同じものをコピーする。
ZIPのSHA256と展開後の全マニフェスト対象ファイルを各PCで検査する。新しい版は
`releases\exhibition-日時` に配置し、既存の版を上書き・削除しない。
展開は別の一時フォルダーで行い、検証後に完成した版名へ移す。展開中に中断しても、
再試行は別の一時フォルダーを使う。途中のフォルダーは診断用に保持し、選択中の版にはしない。

全台の展開と検査が成功してから、稼働している展示を停止し、版の参照を切り替え、
ホスト→クライアントの順で復帰させる。待機中の予備機は版の参照だけを更新する。
ホスト更新ではメモリ内の展示世界がリセットされるため、来場者のプレイ中に実行しない。

1台でもオフライン、SSH不可、書き込み不可、SHA不一致なら**全台配布完了とはしない**。
到達したPCへの検証済みコピーは保持し、ゲームの版の切り替えは行わない。
復旧後は同じZIPと版名で再実行できる。版名とZIPパスは実行結果に表示される。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\exhibition-fleet.ps1 -Action Deploy -ZipFile .\output\exhibition-YYYYMMDD-HHMMSS.zip -ReleaseName exhibition-YYYYMMDD-HHMMSS
```

`Verify` は4台の全対象ファイルと同一ビルドIDを確認する。機体別の成功・失敗・ビルドID・
稼働状態は `output\exhibition-fleet\*.json` に記録される。失敗した台を黙って除外しない。
`-Machines` による対象限定は診断・保守用で、全台更新の代わりにはしない。

初回、古い方式のランチャーが4173番で稼働している場合は自動で終了しない。
実行ファイル・版・所有ユーザーを照合して、その展示ランチャーを体験の区切りで終了してから移行する。
通常開発サーバーや別のNodeプロセスをまとめて終了しない。

## 通常起動・故障時の切り替え

起動する2台では `CRO-MAGNON` にサインインしておく。PC0を展示に使うときも、
制作ユーザーのままでゲームを起動せず、Windowsの「ユーザーの切り替え」で展示ユーザーへ移る。
PC0の制作セッションをサインアウトしなければ、制作側の作業は保持できる。

PC0からの操作：

```powershell
# 通常：PC1がホスト、PC2がプレイヤー2
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\exhibition-fleet.ps1 -Action Activate -HostPC PC1 -ClientPC PC2

# PC1故障：PC3がホストを代行、PC2は接続先をPC3へ変更
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\exhibition-fleet.ps1 -Action Activate -HostPC PC3 -ClientPC PC2

# PC2故障：PC1のホストは維持し、PC3がプレイヤー2を代行
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\exhibition-fleet.ps1 -Action Activate -HostPC PC1 -ClientPC PC3

# PC1故障：PC0の展示ユーザーでホストを代行
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\exhibition-fleet.ps1 -Action Activate -HostPC PC0 -ClientPC PC2
```

選んだ2台の同一ビルドを確認し、接続先を `.1`／`.3`／`.4` へ切り替える。
固定IPの交換、Windows管理者確認、SSHのポート変更、インターネット接続は不要。
変更不要の稼働中ホストは停止しないため、PC2だけをPC3に交代させるときはホストの世界を保持する。
ホストそのものが故障した場合は、そのメモリ内の世界は復元されず、新しい展示世界から始まる。
予備機へ画面・コントローラーをつなぐ物理作業は必要。

故障PCへ到達できないことは切り替えを妨げないが、選んだ2台へ到達できない場合は停止する。
故障機が復帰したら勝手に旧ゲームを再開させず、通常起動のコマンドで全台の役割を整える。
自動フェイルオーバーは行わない。

各PCは自分の `http://localhost:4173/?room=EXHIBITION` から画像・モデルを読み込む。
共有ホストの8081番は同期専用。ブラウザーが開いた後、2画面とも「LAN: Connected」と
互いのプレイヤーが見えることを確認する。

## コントローラー表記

プレイヤー1（ホスト）は `PC1_CONTROLLER_LAYOUT=ps4`、プレイヤー2（クライアント）は
`PC2_CONTROLLER_LAYOUT=switch-pro` が既定。PC3が代行するときも、代行した役割の表記を使う。
機体番号から実際のコントローラーを推測しない。

変更するときは、そのPCの選択中リリースに `exhibition.local.env` を置く。

```dotenv
PC1_CONTROLLER_LAYOUT=ps4
PC2_CONTROLLER_LAYOUT=switch-pro
```

機器に合わせて `ps4` または `switch-pro` を指定して、そのPCのブラウザーを再読み込みする。
サーバー再起動・管理者権限は不要。次の版へ更新するときも、このローカル設定を引き継ぐ。
標準Gamepad入力は別途、実物のコントローラーで確認する。

## 展示中に管理者確認を出さない

通常処理はCRO-MAGNONの標準権限、PC0のローカル配置は制作ユーザーのゲームフォルダー権限を使う。
権限不足はPC0側のエラーにし、自動昇格しない。UAC、Firewall、ウイルス対策を無効化しない。
展示アカウントを管理者へ変更しない。セットアップキットはSSHセッションからの実行を拒否する。

SSHが応答しない場合は、電源・有線IP・ネットワークがPrivateか・`sshd` がRunningかを
対象PCで確認する。SSHが使えない段階の復旧は、PC0からSSH経由では実行できない。
必要なローカル管理者作業は開場前の保守として行い、その後PC0から再検証する。
Public設定、ファイアウォール、鍵が準備済みなら、ゲーム配布・起動・役割変更だけでは
Windowsの管理者確認は出ない。

## 実施記録

2026-09-22の4台準備・実機検査の結果は `docs/exhibition-fleet-2026-09-22.md` に記録する。
手順書に対応機能があることと、実機の初期設定・配布・起動が検証済みであることを区別する。
