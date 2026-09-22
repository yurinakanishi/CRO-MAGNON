# Local setup maintenance: replace the launcher only after its own game has stopped.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('PC0','PC1','PC2','PC3')][string]$Machine,
  [string]$DisplayUser = 'CRO-MAGNON',
  [string]$OperatorUser,
  [string]$StationScript = (Join-Path $PSScriptRoot 'exhibition-station.ps1')
)
$ErrorActionPreference = 'Stop'
function Invoke-SetupStation([hashtable]$Values) {
  $Values.Machine = $Machine
  $Values.DisplayUser = $DisplayUser
  $result = & $StationScript @Values | ConvertFrom-Json
  if (-not $result) { throw "No result from exhibition launcher: $($Values.Action)" }
  return $result
}
$before = Invoke-SetupStation @{Action='Status'}
$wasRunning = $null -ne $before.running
if ($wasRunning) {
  # Verify the selected old release before interruption so it can be restarted.
  $verified = Invoke-SetupStation @{Action='Verify';ReleaseName=$before.station.release;BuildId=$before.station.buildId}
  if ($verified.buildId -ne $before.station.buildId) { throw 'The running exhibition release could not be verified before setup.' }
  Write-Host 'Stopping the current exhibition through its standard launcher before registration...'
  $stopped = Invoke-SetupStation @{Action='Stop'}
  if (-not $stopped.stopped) { throw 'The current exhibition did not stop; launcher registration was not attempted.' }
  $afterStop = Invoke-SetupStation @{Action='Status'}
  if ($afterStop.running) { throw 'The current exhibition is still running; launcher registration was not attempted.' }
}
$task = Invoke-SetupStation @{Action='Register';OperatorUser=$OperatorUser}
if (-not $task.registered) { throw 'The standard exhibition task was not registered.' }
if ($wasRunning) {
  Write-Host 'Restarting the previously running exhibition with the registered standard task...'
  $started = Invoke-SetupStation @{Action='Start'}
  if (-not $started.started) { throw 'Launcher registration succeeded but the previous exhibition did not restart.' }
}
$task | Add-Member -NotePropertyName stoppedPreviousExhibition -NotePropertyValue $wasRunning
$task | Add-Member -NotePropertyName restartedPreviousExhibition -NotePropertyValue $wasRunning
$task | ConvertTo-Json -Depth 6
