# PC0 operator entry point. Every remote action uses pinned SSH hosts and a standard account.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('Status','Deploy','Verify','Activate','Stop')][string]$Action,
  [string]$ZipFile,
  [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$')][string]$ReleaseName,
  [ValidateSet('PC0','PC1','PC3')][string]$HostPC = 'PC1',
  [ValidateSet('PC1','PC2','PC3')][string]$ClientPC = 'PC2',
  [ValidateSet('PC0','PC1','PC2','PC3')][string[]]$Machines = @('PC0','PC1','PC2','PC3')
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repository = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'exhibition-fleet-plan.ps1')
$fleet = Get-Content -LiteralPath (Join-Path $repository 'exhibition-fleet.json') -Raw | ConvertFrom-Json
$pc0 = $fleet.machines | Where-Object id -eq 'PC0'
if ($env:COMPUTERNAME -ne $pc0.computerName) { throw 'Run fleet operations on PC0.' }
if (-not (Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -eq $pc0.address)) { throw 'PC0 exhibition Ethernet is not configured.' }
$stationScript = Join-Path $PSScriptRoot 'exhibition-station.ps1'
$operationId = [guid]::NewGuid().ToString('N')
$remoteScript = "C:/Users/Public/CRO-MAGNON/incoming/station-$operationId.ps1"
$prepared = @{}
$snapshots = @{}
$results = [Collections.Generic.List[object]]::new()
$out = Join-Path $repository 'output\exhibition-fleet'
New-Item -ItemType Directory -Path $out -Force | Out-Null
$reportPath = Join-Path $out ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $Action.ToLowerInvariant() + '-' + $operationId + '.json')

function Get-Machine([string]$Id) {
  $machine = @($fleet.machines | Where-Object id -eq $Id)
  if ($machine.Count -ne 1 -or -not $machine[0].computerName) { throw "Set the verified computerName for $Id in exhibition-fleet.json first." }
  return $machine[0]
}
function Prepare-Remote($Machine) {
  if ($Machine.id -eq 'PC0' -or $prepared[$Machine.id]) { return }
  if ($Machine.ssh -notmatch '^cro-pc[123]$') { throw 'Unexpected SSH alias.' }
  $name = & ssh.exe -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=5 $Machine.ssh hostname
  if ($LASTEXITCODE -ne 0 -or ($name -join '').Trim() -ne $Machine.computerName) { throw "SSH identity check failed for $($Machine.id). Check Ethernet, sshd, Private firewall and the pinned host key. No elevation was requested." }
  & scp.exe -q -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=5 $stationScript ($Machine.ssh + ':' + $remoteScript)
  if ($LASTEXITCODE -ne 0) { throw "Cannot copy the operation helper to $($Machine.id) Public incoming folder. Complete local setup first." }
  $prepared[$Machine.id] = $true
}
function Invoke-Station([string]$Id, [hashtable]$Parameters) {
  $machine = Get-Machine $Id
  $Parameters.Machine = $Id
  $Parameters.ExpectedComputerName = $machine.computerName
  if ($Id -eq 'PC0') {
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stationScript @Parameters
  } else {
    Prepare-Remote $machine
    $json64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($Parameters | ConvertTo-Json -Compress)))
    $template = @'
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$values=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__PARAMETERS__')) | ConvertFrom-Json
$parameters=@{}
$values.psobject.Properties | ForEach-Object { $parameters[$_.Name]=$_.Value }
& '__SCRIPT__' @parameters
'@
    $command = $template.Replace('__PARAMETERS__',$json64).Replace('__SCRIPT__',$remoteScript)
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $output = & ssh.exe -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=5 $machine.ssh powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded
  }
  if ($LASTEXITCODE -ne 0) { throw "$Id station operation failed: $($Parameters.Action)" }
  return (($output -join "`n") | ConvertFrom-Json)
}
function Save-Report {
  [pscustomobject]@{action=$Action;time=(Get-Date).ToString('o');release=$ReleaseName;requestedMachines=$Machines;results=@($results.ToArray())} | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $reportPath -Encoding UTF8
}
function Record([string]$Id,[string]$Step,$Value) {
  $results.Add([pscustomobject]@{machine=$Id;step=$Step;ok=$true;result=$Value})
  Save-Report
  Write-Host "$Id $Step OK"
}

try {
  if (($Action -eq 'Activate') -and ($HostPC -eq $ClientPC -or $Machines.Count -ne 4)) { throw 'Activate requires distinct host/client machines and the complete four-PC inventory.' }
  foreach ($id in $Machines) {
    try {
      $status = Invoke-Station $id @{Action='Status'}
      $machine = Get-Machine $id
      if ($status.addresses -notcontains $machine.address) { throw "Unexpected Ethernet address on $id." }
      $snapshots[$id] = $status
      Record $id 'status' $status
    } catch {
      $results.Add([pscustomobject]@{machine=$id;step='status';ok=$false;error=$_.Exception.Message})
      Save-Report
      Write-Warning $_.Exception.Message
    }
  }
  if ($Action -eq 'Status') {
    if ($snapshots.Count -ne $Machines.Count) { throw "Some PCs are unreachable. See $reportPath" }
    return
  }

  if ($Action -eq 'Deploy') {
    if (-not $ReleaseName) { $ReleaseName = 'exhibition-' + (Get-Date -Format 'yyyyMMdd-HHmmss') }
    if (-not $ZipFile) {
      $buildDirectory = Join-Path $repository ('output\' + $ReleaseName)
      & node.exe (Join-Path $PSScriptRoot 'build-exhibition.mjs') $buildDirectory
      if ($LASTEXITCODE -ne 0) { throw 'Offline exhibition build failed.' }
      $ZipFile = $buildDirectory + '.zip'
      if (Test-Path -LiteralPath $ZipFile) { throw 'The ZIP already exists. Choose a new release name.' }
      Compress-Archive -LiteralPath @(Get-ChildItem -LiteralPath $buildDirectory | ForEach-Object FullName) -DestinationPath $ZipFile
    }
    $ZipFile = (Resolve-Path -LiteralPath $ZipFile).Path
    $zipHash = (Get-FileHash -LiteralPath $ZipFile -Algorithm SHA256).Hash
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($ZipFile)
    try {
      $entry = $archive.GetEntry('exhibition-build.json')
      if (-not $entry) { throw 'ZIP must contain exhibition-build.json at its root.' }
      $reader = [IO.StreamReader]::new($entry.Open())
      try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    } finally { $archive.Dispose() }
    $installed = @{}
    foreach ($id in $Machines) {
      if (-not $snapshots[$id]) { continue }
      try {
        $machine = Get-Machine $id
        $destination = 'C:/Users/Public/CRO-MAGNON/incoming/' + $ReleaseName + '.zip'
        if ($id -eq 'PC0') { Copy-Item -LiteralPath $ZipFile -Destination $destination }
        else {
          & scp.exe -q -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=5 $ZipFile ($machine.ssh + ':' + $destination)
          if ($LASTEXITCODE -ne 0) { throw 'SCP ZIP transfer failed.' }
        }
        $installed[$id] = Invoke-Station $id @{Action='Install';ReleaseName=$ReleaseName;ZipFile=$destination;ZipSha256=$zipHash;BuildId=$manifest.buildId}
        Record $id 'install' $installed[$id]
      } catch {
        $results.Add([pscustomobject]@{machine=$id;step='install';ok=$false;error=$_.Exception.Message})
        Save-Report
        Write-Warning "$id install failed: $($_.Exception.Message)"
      }
    }
    if ($installed.Count -ne $Machines.Count) { throw "Deployment is incomplete. Reachable PCs have a staged copy; running versions were preserved. Reconnect missing PCs and rerun with -ZipFile '$ZipFile' -ReleaseName '$ReleaseName'." }
    # All copies are verified before interrupting any existing game session.
    foreach ($id in $Machines) {
      if ($snapshots[$id].clientHealth -and -not $snapshots[$id].running) { throw "$id has an older/unmanaged exhibition launcher. Close that launcher at a visitor break, then retry this ZIP." }
    }
    foreach ($id in $Machines) {
      if ($snapshots[$id].running) { Record $id 'stop' (Invoke-Station $id @{Action='Stop'}) }
    }
    foreach ($id in $Machines) {
      $role = if ($snapshots[$id].station.role) { $snapshots[$id].station.role } else { 'standby' }
      $selectedHost = if ($snapshots[$id].station.hostPC) { $snapshots[$id].station.hostPC } else { 'PC1' }
      Record $id 'configure' (Invoke-Station $id @{Action='Configure';ReleaseName=$ReleaseName;BuildId=$manifest.buildId;GameRole=$role;HostPC=$selectedHost})
    }
    # Restore hosts first, followed by clients. Standbys remain stopped.
    foreach ($role in @('host','client')) {
      foreach ($id in $Machines) {
        if ($snapshots[$id].running -and $snapshots[$id].station.role -eq $role) { Record $id 'start' (Invoke-Station $id @{Action='Start'}) }
      }
    }
  } elseif ($Action -eq 'Verify') {
    foreach ($id in $Machines) {
      if ($snapshots[$id]) {
        $arguments = @{Action='Verify'}
        if ($ReleaseName) { $arguments.ReleaseName=$ReleaseName }
        Record $id 'verify' (Invoke-Station $id $arguments)
      }
    }
    if ($snapshots.Count -ne $Machines.Count) { throw 'Some PCs could not be verified.' }
    $ids = @($results | Where-Object step -eq 'verify' | ForEach-Object { $_.result.buildId } | Select-Object -Unique)
    if ($ids.Count -ne 1) { throw 'The PCs do not have the same exhibition build.' }
  } elseif ($Action -eq 'Activate') {
    # A failed PC can be unreachable during failover, but both selected PCs must pass verification.
    $verification = @{}
    foreach ($id in @($HostPC,$ClientPC)) {
      if (-not $snapshots[$id]) { throw "Selected $id is unreachable." }
      if ($snapshots[$id].clientHealth -and -not $snapshots[$id].running) { throw "$id has an unmanaged launcher; close it before switching." }
      $arguments = @{Action='Verify'}
      if ($ReleaseName) { $arguments.ReleaseName=$ReleaseName }
      $verification[$id] = Invoke-Station $id $arguments
      Record $id 'verify' $verification[$id]
    }
    $plan = @(Get-ExhibitionActivationPlan -Snapshots $snapshots -Verified $verification -HostPC $HostPC -ClientPC $ClientPC -ReleaseName $ReleaseName)
    foreach ($step in $plan) {
      if ($step.stop) { Record $step.machine 'stop' (Invoke-Station $step.machine @{Action='Stop'}) }
    }
    foreach ($step in $plan) {
      $id = $step.machine
      if ($step.keepRunning) { Record $id 'preserve-running' $snapshots[$id].running; continue }
      Record $id 'configure' (Invoke-Station $id @{Action='Configure';ReleaseName=$step.release;GameRole=$step.role;HostPC=$HostPC})
    }
    foreach ($role in @('host','client')) {
      foreach ($step in $plan) {
        if ($step.role -eq $role -and $step.start) { Record $step.machine 'start' (Invoke-Station $step.machine @{Action='Start'}) }
      }
    }
  } elseif ($Action -eq 'Stop') {
    foreach ($id in $Machines) {
      if ($snapshots[$id]) { Record $id 'stop' (Invoke-Station $id @{Action='Stop'}) }
    }
    if ($snapshots.Count -ne $Machines.Count) { throw 'Some PCs are unreachable and their stop state is unverified.' }
  }
  Write-Host "Completed $Action. Report: $reportPath"
} finally {
  Save-Report
  Write-Host "Report: $reportPath"
}
