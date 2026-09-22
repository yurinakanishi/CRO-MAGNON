$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$testDirectory = Join-Path $repository ('output\setup-launcher-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDirectory | Out-Null
$station = Join-Path $testDirectory 'station.ps1'
@'
param($Action,$Machine,$DisplayUser,$OperatorUser,$ReleaseName,$BuildId)
$global:setupTestCalls += $Action
if ($Machine -ne 'PC2' -or $DisplayUser -ne 'CRO-MAGNON') { throw 'Wrong station or account.' }
if ($global:setupTestFailure -eq $Action) { throw "Fixture failure: $Action" }
switch ($Action) {
  'Status' {
    @{station=@{release='old-release';buildId='old-build'};running=$(if($global:setupTestRunning){@{pid=123}}else{$null})} | ConvertTo-Json -Depth 3
  }
  'Verify' {
    if ($ReleaseName -ne 'old-release' -or $BuildId -ne 'old-build') { throw 'Wrong release verified.' }
    @{buildId='old-build'} | ConvertTo-Json
  }
  'Stop' {
    if (-not $global:setupTestStuck) { $global:setupTestRunning=$false }
    @{stopped=$true} | ConvertTo-Json
  }
  'Register' {
    if ($global:setupTestRunning) { throw 'Cannot register while running.' }
    if ($OperatorUser -ne 'operator') { throw 'Operator permission was not preserved.' }
    @{registered=$true;machine=$Machine;task='CRO-MAGNON-Exhibition';user=$DisplayUser;runLevel=0} | ConvertTo-Json
  }
  'Start' { $global:setupTestRunning=$true; @{started=$true} | ConvertTo-Json }
  default { throw "Unexpected action: $Action" }
}
'@ | Set-Content -LiteralPath $station -Encoding UTF8
function Run-Case([bool]$Running,[string]$Failure='', [bool]$Stuck=$false) {
  $global:setupTestRunning=$Running
  $global:setupTestFailure=$Failure
  $global:setupTestStuck=$Stuck
  $global:setupTestCalls=@()
  & (Join-Path $PSScriptRoot 'register-exhibition-setup-launcher.ps1') -Machine PC2 -DisplayUser CRO-MAGNON -OperatorUser operator -StationScript $station 6>$null | ConvertFrom-Json
}
function Assert([bool]$Condition,[string]$Text) { if(-not $Condition){throw $Text} }
$result = Run-Case $true
Assert (($global:setupTestCalls -join ',') -eq 'Status,Verify,Stop,Status,Register,Start') 'Running setup must verify, stop, confirm stopped, register and restore in order.'
Assert ($result.registered -and $result.stoppedPreviousExhibition -and $result.restartedPreviousExhibition -and $global:setupTestRunning) 'The active station must finish running under its standard task.'
$result = Run-Case $false
Assert (($global:setupTestCalls -join ',') -eq 'Status,Register') 'An idle station must not stop or start any process.'
Assert (-not $result.stoppedPreviousExhibition -and -not $result.restartedPreviousExhibition -and -not $global:setupTestRunning) 'Idle remains idle.'
foreach ($failure in @('Verify','Stop','Register','Start')) {
  $rejected=$false
  try { Run-Case $true $failure | Out-Null } catch { $rejected=$true }
  Assert $rejected "A $failure failure must be reported."
  if ($failure -in @('Verify','Stop')) { Assert ($global:setupTestCalls -notcontains 'Register') 'An unverified or unstopped game must never be registered over.' }
  if ($failure -eq 'Register') { Assert ($global:setupTestCalls -notcontains 'Start') 'Registration failure must not be reported as a successful restart.' }
}
$rejected=$false
try { Run-Case $true '' $true | Out-Null } catch { $rejected=$true }
Assert ($rejected -and $global:setupTestCalls -notcontains 'Register') 'Stop success without actual shutdown must abort registration.'
[pscustomobject]@{success=$true;checks=7} | ConvertTo-Json -Compress
