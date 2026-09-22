# Runs locally or through the standard display user's SSH session. No automatic elevation.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('Status','Install','Verify','Configure','Register','Start','Stop','Launch')]
  [string]$Action,
  [ValidateSet('PC0','PC1','PC2','PC3')][string]$Machine,
  [string]$ExpectedComputerName,
  [string]$DisplayUser = 'CRO-MAGNON',
  [string]$OperatorUser,
  [string]$ZipFile,
  [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$')][string]$ReleaseName,
  [ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ZipSha256,
  [ValidatePattern('^[a-fA-F0-9]{64}$')][string]$BuildId,
  [ValidateSet('host','client','standby')][string]$GameRole,
  [ValidateSet('PC0','PC1','PC3')][string]$HostPC = 'PC1'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = 'C:\Users\Public\CRO-MAGNON'
$operations = Join-Path $root 'operations'
$statePath = Join-Path $operations 'station.json'
$runPath = Join-Path $operations 'running.json'
$taskName = 'CRO-MAGNON-Exhibition'
$addresses = @{PC0='10.10.10.3'; PC1='10.10.10.1'; PC2='10.10.10.2'; PC3='10.10.10.4'}

function Read-Json([string]$File) {
  if (Test-Path -LiteralPath $File -PathType Leaf) {
    return ([IO.File]::ReadAllText($File) | ConvertFrom-Json)
  }
  return $null
}
function Write-Json([string]$File, $Value) {
  $temp = $File + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
  [IO.File]::WriteAllText($temp, ($Value | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temp -Destination $File -Force
}
function Assert-OrdinaryPath([string]$Path) {
  $target = [IO.Path]::GetFullPath($Path)
  if ($target -ne $root -and -not $target.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Path is outside the Public game folder: $target"
  }
  $cursor = $target
  while ($cursor -and $cursor.Length -ge 'C:\Users\Public'.Length) {
    if (Test-Path -LiteralPath $cursor) {
      if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Links and junctions are not permitted in the deployment path: $cursor"
      }
    }
    $cursor = Split-Path -Parent $cursor
  }
}
function Get-Task {
  $service = New-Object -ComObject 'Schedule.Service'
  $service.Connect()
  try { return $service.GetFolder('\').GetTask($taskName) }
  catch {
    if ($_.Exception.HResult -eq -2147024894) { return $null }
    throw
  }
}
function Get-TaskInstances {
  $service = New-Object -ComObject 'Schedule.Service'
  $service.Connect()
  # GetInstances(0) omits our Hidden task on the exhibition PCs even while it
  # is running. Explicitly include hidden tasks and match the complete path.
  $service.GetRunningTasks(1) | Where-Object { $_.Path -eq ('\' + $taskName) }
}
function Get-Run {
  $run = Read-Json $runPath
  if (-not $run -or $run.status -ne 'running') { return $null }
  $task = Get-Task
  if (-not $task -or $task.State -ne 4) { return $null }
  $instances = @(Get-TaskInstances)
  if ($instances.Count -ne 1 -or $instances[0].InstanceGuid -ne $run.taskInstance) { return $null }
  $process = Get-Process -Id $run.pid -ErrorAction SilentlyContinue
  if (-not $process) { return $null }
  # PC0's operator may not query another Windows user's executable/start time.
  # The scheduler instance above identifies that display session without elevation.
  $observedPath = $null
  $observedStart = $null
  try { $observedPath = $process.Path; $observedStart = $process.StartTime } catch { }
  if (($observedPath -and $observedPath -ne $run.nodePath) -or ($observedStart -and $observedStart.ToUniversalTime().ToString('o') -ne $run.startedAt)) {
    throw 'The recorded exhibition PID does not match its start time and executable.'
  }
  return $run
}
function Verify-Release([string]$Release, [string]$ExpectedBuild) {
  Assert-OrdinaryPath $Release
  $node = Join-Path $Release 'runtime\node.exe'
  if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw "Bundled Node runtime is missing: $Release" }
  $code = "import('./scripts/exhibition-integrity.mjs').then(async m=>{const r=await m.verifyExhibition(process.cwd());console.log(JSON.stringify({buildId:r.buildId,files:r.files.length,glbs:r.glbs,node:r.node}))})"
  Push-Location -LiteralPath $Release
  try {
    $verified = & $node --input-type=module -e $code
    if ($LASTEXITCODE -ne 0) { throw 'Exhibition integrity verification failed.' }
    $report = $verified | ConvertFrom-Json
    if ($ExpectedBuild -and $report.buildId -ne $ExpectedBuild) { throw 'Unexpected exhibition build ID.' }
    return $report
  } finally { Pop-Location }
}

try {
  if ($ExpectedComputerName -and $ExpectedComputerName -ne $env:COMPUTERNAME) {
    throw "Wrong computer: expected $ExpectedComputerName, reached $env:COMPUTERNAME."
  }
  Assert-OrdinaryPath $root
  Assert-OrdinaryPath $operations
  $state = Read-Json $statePath
  if ($state -and $Machine -and $state.machine -ne $Machine) { throw 'Stored station identity does not match the requested PC.' }
  if ($state -and -not $Machine) { $Machine = $state.machine }

  switch ($Action) {
    'Status' {
      $task = Get-Task
      $run = Get-Run
      $ip = @([Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | ForEach-Object {
        $_.GetIPProperties().UnicastAddresses | Where-Object { $_.Address.AddressFamily -eq 'InterNetwork' } | ForEach-Object { $_.Address.ToString() }
      })
      $writeProbe = $false
      if (Test-Path -LiteralPath $operations -PathType Container) {
        $probe = Join-Path $operations ('write-probe-' + [guid]::NewGuid().ToString('N') + '.tmp')
        [IO.File]::WriteAllText($probe, 'probe')
        Remove-Item -LiteralPath $probe
        $writeProbe = $true
      }
      $health = $null
      try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4173/api/status' -TimeoutSec 3 } catch { }
      [pscustomobject]@{computerName=$env:COMPUTERNAME; identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name; addresses=$ip; publicWrite=$writeProbe; station=$state; running=$run; clientHealth=$health; task=$(if($task){@{name=$task.Name;user=$task.Definition.Principal.UserId;runLevel=$task.Definition.Principal.RunLevel;state=$task.State;lastResult=$task.LastTaskResult}}else{$null})} | ConvertTo-Json -Depth 12
    }
    'Install' {
      if (-not $Machine -or -not $ReleaseName -or -not $ZipFile -or -not $ZipSha256 -or -not $BuildId) { throw 'Install requires Machine, ReleaseName, ZipFile, ZipSha256 and BuildId.' }
      if (-not (Test-Path -LiteralPath $operations -PathType Container)) { throw 'Run the local initial setup first; Public operations folder is missing.' }
      Assert-OrdinaryPath $ZipFile
      if ((Get-FileHash -LiteralPath $ZipFile -Algorithm SHA256).Hash -ne $ZipSha256) { throw 'ZIP SHA256 mismatch. No release was installed.' }
      $release = Join-Path $root ('releases\' + $ReleaseName)
      Assert-OrdinaryPath $release
      if (-not (Test-Path -LiteralPath $release)) {
        # Reject traversal, absolute paths and duplicate entries before extraction.
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archive = [IO.Compression.ZipFile]::OpenRead($ZipFile)
        try {
          $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
          foreach ($entry in $archive.Entries) {
            $name = $entry.FullName.Replace('/', '\')
            if ([IO.Path]::IsPathRooted($name) -or $name.Contains(':')) { throw 'Invalid ZIP path.' }
            $target = [IO.Path]::GetFullPath((Join-Path $release $name))
            if (-not $target.StartsWith($release + '\', [StringComparison]::OrdinalIgnoreCase) -or -not $seen.Add($target)) { throw 'Unsafe or duplicate ZIP path.' }
          }
        } finally { $archive.Dispose() }
        # A failed/interrupted extraction never occupies the final release name.
        # Keep partial staging folders for diagnosis; a retry uses a new staging directory.
        $staging = Join-Path $root ('releases\staging-' + $ReleaseName + '-' + [guid]::NewGuid().ToString('N'))
        Assert-OrdinaryPath $staging
        New-Item -ItemType Directory -Path $staging | Out-Null
        [IO.Compression.ZipFile]::ExtractToDirectory($ZipFile, $staging)
        Verify-Release $staging $BuildId | Out-Null
        Assert-OrdinaryPath $staging
        Assert-OrdinaryPath $release
        [IO.Directory]::Move($staging, $release)
      }
      $verified = Verify-Release $release $BuildId
      # Installing never changes the running release. It only records a verified candidate.
      Write-Json (Join-Path $operations 'pending-release.json') @{release=$ReleaseName;buildId=$verified.buildId;installedAt=(Get-Date).ToString('o')}
      [pscustomobject]@{computerName=$env:COMPUTERNAME;release=$release;verified=$verified;runningUnchanged=$true} | ConvertTo-Json -Depth 5
    }
    'Verify' {
      if (-not $ReleaseName) { $ReleaseName = $state.release }
      if (-not $ReleaseName) { throw 'No release selected.' }
      Verify-Release (Join-Path $root ('releases\' + $ReleaseName)) $BuildId | ConvertTo-Json
    }
    'Register' {
      if (-not $Machine) { throw 'Register requires Machine.' }
      $user = Get-LocalUser -Name $DisplayUser
      if (-not $user.Enabled) { throw 'The display user is disabled.' }
      if (Get-LocalGroupMember -SID 'S-1-5-32-544' | Where-Object { $_.SID.Value -eq $user.SID.Value }) { throw 'The display account must be a standard user.' }
      $principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
      if ($principal.Identity.User.Value -ne $user.SID.Value -and -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Register once locally as administrator, or as the display user. No elevation will be requested.' }
      if (Get-Run) { throw 'Stop the exhibition at a visitor break before registering its launcher.' }
      New-Item -ItemType Directory -Path $operations -Force | Out-Null
      $installedScript = Join-Path $operations 'exhibition-station.ps1'
      if ($PSCommandPath -ne $installedScript) { Copy-Item -LiteralPath $PSCommandPath -Destination $installedScript -Force }
      if (-not $state) {
        $state = [pscustomobject]@{machine=$Machine;displayUser=$DisplayUser;release=$null;buildId=$null;role='standby';hostPC='PC1'}
        Write-Json $statePath $state
      }
      $service = New-Object -ComObject 'Schedule.Service'
      $service.Connect()
      $task = $service.NewTask(0)
      $task.RegistrationInfo.Description = 'Run the selected CRO-MAGNON Public release as the standard display account on demand. No triggers or elevation.'
      $task.Principal.UserId = $user.SID.Value
      $task.Principal.LogonType = 3
      $task.Principal.RunLevel = 0
      $task.Settings.Enabled = $true
      $task.Settings.Hidden = $true
      $task.Settings.AllowDemandStart = $true
      $task.Settings.MultipleInstances = 2
      $task.Settings.ExecutionTimeLimit = 'PT0S'
      $task.Settings.DisallowStartIfOnBatteries = $false
      $task.Settings.StopIfGoingOnBatteries = $false
      $exec = $task.Actions.Create(0)
      $exec.Path = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
      $exec.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $installedScript + '" -Action Launch'
      $exec.WorkingDirectory = $operations
      $sddl = 'D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGX;;;' + $user.SID.Value + ')'
      if ($OperatorUser) {
        $operatorAccount = Get-LocalUser -Name $OperatorUser
        $sddl += '(A;;GRGX;;;' + $operatorAccount.SID.Value + ')'
      }
      $registered = $service.GetFolder('\').RegisterTaskDefinition($taskName,$task,6,$user.SID.Value,$null,3,$sddl)
      [pscustomobject]@{registered=$true;machine=$Machine;task=$registered.Name;user=$registered.Definition.Principal.UserId;runLevel=$registered.Definition.Principal.RunLevel;logonType=$registered.Definition.Principal.LogonType} | ConvertTo-Json
    }
    'Configure' {
      if (-not $state -or -not $GameRole -or -not $ReleaseName) { throw 'Configure requires initial setup, GameRole and ReleaseName.' }
      if (Get-Run) { throw 'Stop the exhibition at a visitor break before changing its release or role.' }
      if (($GameRole -eq 'host' -and $Machine -ne $HostPC) -or ($GameRole -eq 'client' -and $Machine -eq $HostPC)) { throw 'The selected host and client must be different machines.' }
      $release = Join-Path $root ('releases\' + $ReleaseName)
      $verified = Verify-Release $release $BuildId
      $localSettings = Join-Path $release 'exhibition.local.env'
      if ($state.release -and $state.release -ne $ReleaseName -and -not (Test-Path -LiteralPath $localSettings)) {
        $previousSettings = Join-Path $root ('releases\' + $state.release + '\exhibition.local.env')
        Assert-OrdinaryPath $previousSettings
        if (Test-Path -LiteralPath $previousSettings -PathType Leaf) { Copy-Item -LiteralPath $previousSettings -Destination $localSettings }
      }
      $state.release = $ReleaseName
      $state.buildId = $verified.buildId
      $state.role = $GameRole
      $state.hostPC = $HostPC
      Write-Json $statePath $state
      $source = Join-Path $release 'scripts\exhibition-station.ps1'
      if (Test-Path -LiteralPath $source -PathType Leaf) { Copy-Item -LiteralPath $source -Destination (Join-Path $operations 'exhibition-station.ps1') -Force }
      $state | ConvertTo-Json
    }
    'Start' {
      if (-not $state -or $state.role -eq 'standby') { throw 'Select a host/client role and release first.' }
      if (Get-Run) { throw 'The exhibition is already running.' }
      $task = Get-Task
      if (-not $task -or $task.Definition.Principal.RunLevel -ne 0 -or $task.Definition.Principal.LogonType -ne 3) { throw 'The standard display task is missing or misconfigured. Run initial setup locally.' }
      $expectedSid = (Get-LocalUser -Name $state.displayUser).SID.Value
      $actualUser = $task.Definition.Principal.UserId
      $actualSid = if ($actualUser.StartsWith('S-1-')) { $actualUser } else { ([Security.Principal.NTAccount]$actualUser).Translate([Security.Principal.SecurityIdentifier]).Value }
      if ($actualSid -ne $expectedSid) { throw 'The task is not assigned to the display account.' }
      $task.Run($null) | Out-Null
      $ready = $false
      for ($attempt=0; $attempt -lt 45; $attempt++) {
        Start-Sleep -Seconds 1
        $run = Get-Run
        if ($run) {
          try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4173/api/status' -TimeoutSec 1
            $config = Invoke-RestMethod -Uri 'http://127.0.0.1:4173/multiplayer-config.json' -TimeoutSec 1
            if ($health.buildId -eq $state.buildId -and $config.serverUrl -eq ('ws://' + $addresses[$state.hostPC] + ':8081/')) { $ready=$true; break }
          } catch { }
        }
        if ($task.State -ne 4 -and $attempt -gt 3) { break }
      }
      if (-not $ready) { throw 'Exhibition did not become ready. Sign in as CRO-MAGNON and inspect operations\launch-error.json and launch logs. No administrator prompt was requested.' }
      [pscustomobject]@{started=$true;station=$state;running=$run;config=$config} | ConvertTo-Json -Depth 6
    }
    'Stop' {
      $run = Get-Run
      if ($run) {
        # The display-account launcher stops its own Node process; PC0 needs no process privilege.
        Write-Json (Join-Path $operations 'stop-request.json') @{launchId=$run.launchId}
        for ($attempt=0; $attempt -lt 20; $attempt++) {
          Start-Sleep -Milliseconds 500
          if (-not (Get-Run)) { break }
        }
        if (Get-Run) { throw 'The standard launcher did not stop. No unrelated process was terminated or elevation requested.' }
      }
      [pscustomobject]@{stopped=$true;hadRunningLauncher=($null -ne $run)} | ConvertTo-Json
    }
    'Launch' {
      if (-not $state -or $state.role -eq 'standby' -or -not $state.release) { throw 'This station is on standby; choose its failover role first.' }
      $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
      $user = Get-LocalUser -Name $state.displayUser
      if ($identity.User.Value -ne $user.SID.Value) { throw 'Exhibition must launch in the CRO-MAGNON display account.' }
      $principal = [Security.Principal.WindowsPrincipal]$identity
      if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Exhibition must run without administrator privileges.' }
      $lock = [IO.File]::Open((Join-Path $operations 'launcher.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
      try {
        $instances = @(Get-TaskInstances)
        if ($instances.Count -ne 1) { throw 'Launch only through the registered display task.' }
        $taskInstance = $instances[0].InstanceGuid
        $release = Join-Path $root ('releases\' + $state.release)
        $verified = Verify-Release $release $state.buildId
        $node = Join-Path $release 'runtime\node.exe'
        $env:MULTIPLAYER_MODE = 'lan'
        $env:MULTIPLAYER_SERVER_URL = 'ws://' + $addresses[$state.hostPC] + ':8081/'
        $env:CLIENT_PORT = '4173'
        $env:EXHIBITION_ROOM = 'EXHIBITION'
        $env:OPEN_BROWSER = '1'
        $launchId = [guid]::NewGuid().ToString('N')
        $log = Join-Path $operations ('launch-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $launchId)
        $process = Start-Process -FilePath $node -ArgumentList @('"scripts\start-exhibition.mjs"',$state.role) -WorkingDirectory $release -WindowStyle Hidden -RedirectStandardOutput ($log+'.out.log') -RedirectStandardError ($log+'.err.log') -PassThru
        $run = [pscustomobject]@{status='running';launchId=$launchId;taskInstance=$taskInstance;pid=$process.Id;startedAt=$process.StartTime.ToUniversalTime().ToString('o');nodePath=$node;role=$state.role;buildId=$state.buildId;user=$identity.Name;sessionId=$process.SessionId;stdout=($log+'.out.log');stderr=($log+'.err.log')}
        Write-Json $runPath $run
        while (-not $process.WaitForExit(500)) {
          $request = Read-Json (Join-Path $operations 'stop-request.json')
          if ($request -and $request.launchId -eq $launchId) {
            # Terminate the process object this launcher started, never a reused PID.
            $process.Kill()
            $process.WaitForExit()
          }
        }
        $run.status = 'stopped'
        Write-Json $runPath $run
      } finally { $lock.Dispose() }
    }
  }
} catch {
  if ($Action -eq 'Launch' -and (Test-Path -LiteralPath $operations -PathType Container)) {
    Write-Json (Join-Path $operations 'launch-error.json') @{time=(Get-Date).ToString('o');error=$_.Exception.Message}
  }
  Write-Error $_.Exception.Message
  exit 1
}
