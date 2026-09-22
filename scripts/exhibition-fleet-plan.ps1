# Pure planner, shared by the operator command and failover regression checks.
function Get-ExhibitionActivationPlan {
  param(
    [Parameter(Mandatory=$true)][hashtable]$Snapshots,
    [Parameter(Mandatory=$true)][hashtable]$Verified,
    [ValidateSet('PC0','PC1','PC3')][string]$HostPC,
    [ValidateSet('PC1','PC2','PC3')][string]$ClientPC,
    [string]$ReleaseName
  )
  if ($HostPC -eq $ClientPC) { throw 'Host and client must be different machines.' }
  foreach ($id in @($HostPC,$ClientPC)) {
    if (-not $Snapshots[$id] -or -not $Snapshots[$id].station.release -or -not $Verified[$id].buildId) { throw "Selected $id is not prepared and verified." }
    if ($Snapshots[$id].clientHealth -and -not $Snapshots[$id].running) { throw "$id has an unmanaged launcher." }
  }
  if ($Verified[$HostPC].buildId -ne $Verified[$ClientPC].buildId) { throw 'The selected host and client builds differ.' }
  $plan = @(foreach ($id in @('PC0','PC1','PC2','PC3')) {
    $current = $Snapshots[$id]
    if (-not $current) { continue }
    if (-not $current.station.release -and $id -notin @($HostPC,$ClientPC)) { continue }
    $role = if ($id -eq $HostPC) { 'host' } elseif ($id -eq $ClientPC) { 'client' } else { 'standby' }
    $release = if ($ReleaseName) { $ReleaseName } else { $current.station.release }
    $keep = $role -ne 'standby' -and $current.running -and $current.station.role -eq $role -and $current.station.hostPC -eq $HostPC -and $current.station.release -eq $release -and $current.running.buildId -eq $Verified[$id].buildId
    [pscustomobject]@{machine=$id;role=$role;hostPC=$HostPC;release=$release;keepRunning=[bool]$keep;stop=[bool]($current.running -and -not $keep);start=[bool]($role -ne 'standby' -and -not $keep)}
  })
  return $plan
}
