$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'exhibition-fleet-plan.ps1')
function Assert([bool]$Condition,[string]$Message) { if(-not $Condition){throw $Message} }
function Must-Reject([scriptblock]$Operation,[string]$Message) {
  $rejected=$false
  try { & $Operation | Out-Null } catch { $rejected=$true }
  Assert $rejected $Message
}
function Fixture {
  $snapshots=@{}
  foreach($id in @('PC0','PC1','PC2','PC3')) {
    $role=if($id -eq 'PC1'){'host'}elseif($id -eq 'PC2'){'client'}else{'standby'}
    $run=if($role -ne 'standby'){@{buildId='same-build';pid=123}}else{$null}
    $snapshots[$id]=@{station=@{release='exhibition-test';buildId='same-build';role=$role;hostPC='PC1'};running=$run;clientHealth=$null}
  }
  return $snapshots
}
$verified=@{PC0=@{buildId='same-build'};PC1=@{buildId='same-build'};PC2=@{buildId='same-build'};PC3=@{buildId='same-build'}}
$snapshots=Fixture
$normal=@(Get-ExhibitionActivationPlan -Snapshots $snapshots -Verified $verified -HostPC PC1 -ClientPC PC2)
Assert (@($normal | Where-Object stop).Count -eq 0) 'Normal activation must not reset a running world.'
Assert (@($normal | Where-Object start).Count -eq 0) 'Normal activation must not start duplicate launchers.'

$snapshots=Fixture
$snapshots.Remove('PC2')
$clientFailure=@(Get-ExhibitionActivationPlan -Snapshots $snapshots -Verified $verified -HostPC PC1 -ClientPC PC3)
Assert ([bool]($clientFailure | Where-Object machine -eq PC1).keepRunning) 'Replacing PC2 must preserve the PC1 world.'
Assert ([bool]($clientFailure | Where-Object machine -eq PC3).start) 'PC3 must start as replacement client.'
Assert (($clientFailure | Where-Object machine -eq PC3).role -eq 'client') 'PC3 needs the client controller profile.'

$snapshots=Fixture
$snapshots.Remove('PC1')
$hostFailure=@(Get-ExhibitionActivationPlan -Snapshots $snapshots -Verified $verified -HostPC PC3 -ClientPC PC2)
Assert ([bool]($hostFailure | Where-Object machine -eq PC2).stop) 'PC2 must change its old host connection.'
Assert ([bool]($hostFailure | Where-Object machine -eq PC2).start) 'PC2 must reconnect to the new host.'
Assert (($hostFailure | Where-Object machine -eq PC3).role -eq 'host') 'PC3 must become the selected host.'
$pc0Failure=@(Get-ExhibitionActivationPlan -Snapshots $snapshots -Verified $verified -HostPC PC0 -ClientPC PC2)
Assert ([bool]($pc0Failure | Where-Object machine -eq PC0).start) 'PC0 must support the host role.'

Must-Reject { Get-ExhibitionActivationPlan -Snapshots $snapshots -Verified $verified -HostPC PC1 -ClientPC PC2 } 'An unreachable selected host must be rejected.'
Must-Reject { Get-ExhibitionActivationPlan -Snapshots $snapshots -Verified $verified -HostPC PC3 -ClientPC PC3 } 'One PC cannot fill both roles.'
$verified.PC3.buildId='different-build'
Must-Reject { Get-ExhibitionActivationPlan -Snapshots $snapshots -Verified $verified -HostPC PC3 -ClientPC PC2 } 'Mismatched builds must be rejected before stopping anything.'
$verified.PC3.buildId='same-build'
$snapshots.PC3.clientHealth=@{buildId='unmanaged'}
Must-Reject { Get-ExhibitionActivationPlan -Snapshots $snapshots -Verified $verified -HostPC PC3 -ClientPC PC2 } 'An unmanaged launcher must not be overwritten.'
$snapshots.PC3.clientHealth=$null
$snapshots.PC3.station.release=$null
Must-Reject { Get-ExhibitionActivationPlan -Snapshots $snapshots -Verified $verified -HostPC PC3 -ClientPC PC2 } 'An unprepared standby must be rejected.'

$snapshots=Fixture
$upgrade=@(Get-ExhibitionActivationPlan -Snapshots $snapshots -Verified $verified -HostPC PC1 -ClientPC PC2 -ReleaseName exhibition-new)
Assert (@($upgrade | Where-Object stop).Count -eq 2) 'Changing releases must restart the two active stations.'
Assert (@($upgrade | Where-Object start).Count -eq 2) 'Changing releases must leave standbys stopped.'
Assert (@($upgrade | Where-Object { $_.release -ne 'exhibition-new' }).Count -eq 0) 'Every reachable station must receive the selected release.'

$errors=@()
Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*exhibition*.ps1' | ForEach-Object {
  $tokens=$null; $parseErrors=$null
  [Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$tokens,[ref]$parseErrors) | Out-Null
  $errors += $parseErrors
}
Assert ($errors.Count -eq 0) ($errors -join "`n")
@{success=$true;scenarios=10;powerShell=$PSVersionTable.PSVersion.ToString()} | ConvertTo-Json -Compress
