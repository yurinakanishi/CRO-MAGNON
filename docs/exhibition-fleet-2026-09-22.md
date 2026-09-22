# 2026-09-22 展示4台への移行記録

4台への配置・設定と、通常／予備の4構成の実通信検証が完了。手順と実装は `README-EXHIBITION-4PC.md` を参照。

| 機体 | 確認した状態 | 最終運用状態 |
| --- | --- | --- |
| PC0 / YURI / 10.10.10.3 | Public読み書き、CRO-MAGNONのRunLevel 0起動タスク、LAN8081の初期設定が成功。最新版r04を選択・400ファイル照合済み。展示ユーザーによるホスト起動とPC2との実通信も成功 | 通常時は待機 |
| PC1 / YURIALIENWARE / 10.10.10.1 | CRO-MAGNONでSSH・Public読み書き、新タスクによるホスト起動を確認。最新版r04へ移行、400ファイル一致、PC2との移動・攻撃同期成功 | ホストとして稼働 |
| PC2 / LAPTOP-HS5HI3E4 / 10.10.10.2 | CRO-MAGNONでSSH・Public読み書き、新タスクのクライアント起動を確認。最新版r04、400ファイル一致、PC1との移動・攻撃同期成功 | PC1のクライアントとして稼働 |
| PC3 / YURI_TP_X1_12 / 10.10.10.4 | r04キット完了後にSSHログイン成功。標準CRO-MAGNON、Public読み書き、RunLevel 0・LogonType 3のタスクを確認。最新版ゲームr04配置・400ファイル一致。ホスト／クライアント両役割の実通信成功 | 最新版で待機 |

PC0の初期設定は2026-09-22 17:31 JST成功。SSH鍵生成結果は17:32 JST成功。
PC0にSSHサーバーは追加していない。PC0の展示タスクは手動起動・対話ログオン・標準権限。
18:36 JSTの再検査でPC1・PC2のSSH復旧を確認。展示ユーザーのまま新タスクとPublicを読み取れた。
上記18:36時点では未完了だったが、19:38にPC3の標準ユーザーでSSH・Public書き込みを確認。
19:46に修正版r04の全4台配置・選択が完了した。コミット・プッシュは最終検証後に行う。

19:58にPC1ホスト・PC2クライアントへ復帰し、PC0／PC3のランチャーと4173番が停止中であることを確認。
4台とも同じr04を選択し、標準タスクのRunLevelは0。最終状態と4構成の検査結果は
`docs/exhibition-fleet-2026-09-22.json`、生記録は
`output/exhibition-fleet/20260922-195829-status-9296d12fa52d45c583003b5f9a9cc8ba.json`。

## 4台へ配置した統一版

- 版名：`exhibition-20260922-fleet-r04`
- ビルドID：`57ca374df2bb864d6d7bdf1eb664484caa33983cc18a6883cf7abe545181d111`
- ZIP：`output/exhibition-20260922-fleet-r04.zip`
- ZIP SHA256：`CD5A235053F6627F1A67B467AF3E2CA5A2F60D588B27EB86587E9E483AD75A3A`
- 対象400ファイル、78 GLB。同じZIPをPC0・PC1・PC2・PC3へ配置し、展開後の全対象SHAが一致。
- 配布記録：`output/exhibition-fleet/20260922-194518-deploy-5ce60b71e0bb4c4892371f24ed71c50b.json`
- r29の洞窟壁画配置、マンモスの崖への進入防止、更新した4台運用手順も含む。

PC3を含む全台のr03配置確認後、PC1の午前版の実行パス・PID・開始時刻・タスク定義を再照合し、
その旧ランチャーだけを終了した。記録 `output/exhibition-fleet-setup/pc1-old-launcher-stopped.json`。
新タスクの実機検証で下記の非表示タスク判定を修正し、ゲームr04へ更新した。
r03とのマニフェスト差分は `scripts/exhibition-station.ps1` のみ。ゲームコード・素材は同一。

## PC3の初回SSHと標準タスクの実機修正

PC3のMACは `9C-69-D3-93-0A-D7`、機体名はSSHで `YURI_TP_X1_12` と確認。
ユーザーがホスト指紋の手動照合を省略して続行するよう明示したため、初回だけ `accept-new` で
取得したED25519鍵を保存した。指紋は `SHA256:o8Jf8tlxeVPu/JJew+yrcK/guQQ0RQIiXkFhChbFGCU`。
手動照合済みとは扱わず、その後は専用known_hostsと `StrictHostKeyChecking=yes` で接続する。
PC0付属のssh-keyscan 9.5はOpenSSH 10との鍵交換で失敗したが、ssh接続自体は成功した。

PC1の非表示タスクは稼働中の8回の観測すべてで `GetInstances(0).Count=0` となった。
同時に `GetRunningTasks(1)` では同じ標準ユーザー・正しいタスクパス・同一インスタンスを取得できた。
このため取得を後者へ変更し、完全なタスクパスとインスタンスGUIDで照合する。
RunLevel 0・展示ユーザー・実行ファイルと開始時刻の照合を維持し、管理者権限は追加していない。
記録 `output/exhibition-fleet-setup/pc1-hidden-task-diagnosis.json`。
修正後に実タスクから起動成功し、r04配布で停止・更新・再起動も成功した。

## 今回の検証

- 通常ユーザーの環境で全700テスト合格。最初のサンドボックス内実行は既存Three.jsの
  依存関係を解決できず失敗したため、同じテストを通常ユーザーで実行して確認した。
  記録：`output/exhibition-fleet-setup/final-tests-r03.log`。
- r04の同梱Nodeで4項目合格：未設定ホストIPの拒否、ホストの起動とWebSocket応答、
  ポート重複時に先行ホストを保持、クライアントのローカル配信とホスト到達。
  記録：`output/exhibition-fleet-setup/package-launch-qa-r04.json`。
- 最終のPowerShell修正後、切替10シナリオ・Windows PowerShell 5.1の構文が合格。
- 実PC1・PC2の同梱Nodeで独立した検査部屋 `FLEET-QA-194852` に接続。
  双方向の移動と攻撃シーケンス、両PCのローカル524素材19,046,100 bytesを確認。
  ホストps4／クライアントswitch-pro、最新ビルドIDと接続先が一致。
  検査は通信上の実操作で、物理コントローラー入力・実機画面の目視とは区別する。
- PC1ホスト＋PC3クライアント：`FLEET-QA-194941`、両者の移動・攻撃同期、
  素材配信、ps4／switch-pro設定を確認。交代前後のPC1は同じPID 7796・
  launchId `7b3fc12e25484b29ba10bb37c5b853a0`・タスクインスタンスを維持。
  記録 `20260922-194857-activate-af86546c560d4bb7826d287f71c56376.json`。
- PC3ホスト＋PC2クライアント：`FLEET-QA-195245`、両者の移動・攻撃同期、
  素材配信、同じ設定とビルドを確認。PC3ホストはCRO-MAGNONのSession 2で稼働。
  記録 `20260922-195127-activate-6320eb1effe84111aa38d2f998b71ded.json`。
- 4台の選択中r04について、400ファイルと同一ビルドIDを再検証。
  記録 `output/exhibition-fleet/20260922-195442-verify-6152ae88d26746fd9dabfc1982929a55.json`。
- PC0ホスト＋PC2クライアント：`FLEET-QA-195646`、両者の移動・攻撃同期、
  素材配信、同じ設定とビルドを確認。PC0はCRO-MAGNONの対話ログオンと
  RunLevel 0・LogonType 3で起動し、制作ユーザーyurinから開始・状態確認が成功。
  記録 `20260922-195527-activate-7afccc458f524f97b5f8883ffa02b2e5.json`。
- 診断用PowerShellの最初の通信テスト集計では、`Start-Process` の終了コードがnullになり
  失敗と表示したが、両PCのJSONは成功だった。検査器を `Diagnostics.Process` で
  標準出力・標準エラー・終了コードを取得する方式に直し、同条件の実通信を再検証して合格。
  ゲームの同期失敗とは区別する。

起動タスクはゲーム配信プロセスを管理し、既に開いていたブラウザーのタブは終了しない。
切り替え後は新しく開いた展示タブを使い、旧タブが残っている場合は閉じる。
物理コントローラー入力、各展示画面の目視とフルスクリーン調整は現場の最終確認として残る。

## 初期設定キットの受け渡し

PC0の `http://10.10.10.3:8081/` で一時的にHTTP配布。ページとZIPの200応答を確認した。
PC3の初期設定後、予備ホストとの競合を避けるため19:46に当該サーバーだけを終了済み。
これはゲーム配信とは別の初期設定用サーバーであり、PC0の予備ホストを試す前に終了する。
有線10.10.10.3だけへバインドし、ページとZIPのGET/HEADのみを許可する。
現在のキットは `output/exhibition-fleet-setup/kit-20260922-r04.zip`（11,650,840 bytes）、公開鍵とMicrosoft署名済みSSHインストーラーを含み、秘密鍵を含まない。
SHA256は `C7AA5E2F10B91349F82206ACA92881382B6314ACD88DA48728940E97135DD41D`。

PC3が169.254のままではこのURLへ到達できないため、対象を1つの接続中の物理Ethernetに
絞って10.10.10.4/24を設定するコマンドを案内した。別の設定済みIPv4があれば変更を拒否する。
最初の貼り付けでは先頭の`$`と改行が欠け、設定に失敗。明示的なセミコロンを使う1行版を再案内した。
再試行は非管理者のためAccess deniedとなったが、案内コマンドの無条件の完了表示が出てしまった。
この表示は成功の根拠にせず、管理者PowerShellを開く手順を案内した。再設定後にPC0から
10.10.10.4のARP応答を確認。pingとSSH鍵の応答はまだないため、SSH初期設定完了とは扱わない。

キットr03ではネットワーク変更に明示的な `-ErrorAction Stop` を指定し、アドレスが
10.10.10.4/24・Preferredで、Privateになったことを読み直してから成功を返す。
重複アドレス、別のIPv4、異なるプレフィックスは拒否する。Windows PowerShell 5.1の
構文・既存の切替10項目、および非管理者の初期設定が変更前に停止することを確認した。
その後、ZIPを全展開して `Setup-PC3.cmd` をPC3上で実行する。今回のローカル初期設定と
展示中の通常操作を区別し、通常のSSH配布から管理者確認を出さない。

続いてユーザーがPC3上の「Preparing Public game folders and display-user permissions...」後の
「Setup is incomplete」を報告。具体的なエラーは `Add-WindowsCapability failed: 0x800f0950`。
コード上の失敗箇所はPublic処理の後のOpenSSH Server機能追加であり、Publicの処理そのものの
エラーとは区別する。ネット接続・Windows Updateポリシーなど、機能追加が失敗した詳細原因までは未確認。
PC3のTCP22はまだタイムアウトし、初期設定や全台移行の完了とは扱わない。

r04はWindows Updateによる機能追加を使わず、公式 `10.0.0.0p2-Preview` のMSIを同梱した。
x64／ARM64とも公式GitHub APIのSHA256とMicrosoft Authenticode署名のValidを確認。
MSIの内容を読み、Server機能がsshd・共有ssh-agentを起動してPrivateの受信例外を作ることを確認した。
新規導入中は専用のTCP22拒否ルールを置き、既存サービスは自動更新しない。
導入後の実行ファイルから鍵検査・設定検査を行い、SCP/SFTP用のPATH、PC0限定の受信ルール、
公開鍵と標準起動タスクを準備した後で拒否を解除する。失敗時は拒否を残す。
PC0へSSHサーバーを追加したり、Windows Updateポリシーを変更したりする処理は実行していない。

r04は非管理者での導入拒否、不正なキャッシュMSIの拒否、Windows PowerShell 5.1構文と
既存の切替10項目、JSON書式を確認。HTTPから実際にダウンロードし、ZIP全体のSHAと
マニフェスト対象17ファイルすべてのSHA一致を確認した（アーカイブはマニフェスト自身を含め18ファイル）。
PC3でr04の実行完了後、実際のSSHログインと標準権限での配布まで成功した。
その後の起動判定修正はゲームの配布で全台へ反映し、初期設定の再実行は不要。
今後用の初期設定キットr05も作成済み。SHA256
`50D2178508DF567409C032D327BED47248088DC3901CBBAC85F57753C7AA2E36`、18ファイル。
