# Tilbudsradar morning counter
# Fetches the number of paying users and shows it full screen as a flip counter.
# Runs once per day (first logon/unlock after 05:00). Use -Force to show it again.
param([switch]$Force)

$ErrorActionPreference = 'Stop'
$dir      = Join-Path $env:LOCALAPPDATA 'TilbudsradarCounter'
$config   = Get-Content (Join-Path $dir 'config.json') -Raw | ConvertFrom-Json
$state    = Join-Path $dir 'state.json'
$page     = Join-Path $dir 'counter.html'
$now      = Get-Date
$today    = $now.ToString('yyyy-MM-dd')

$s = if (Test-Path $state) { Get-Content $state -Raw | ConvertFrom-Json } else { [pscustomobject]@{ lastShown = ''; lastCount = $null } }

if (-not $Force) {
  if ($now.Hour -lt 5) { exit 0 }            # night: wait for the morning
  if ($s.lastShown -eq $today) { exit 0 }    # already shown today
}

# Token is stored encrypted for this Windows user only (DPAPI).
$secure = Get-Content (Join-Path $dir 'token.dat') -Raw | ConvertTo-SecureString
$token  = [System.Net.NetworkCredential]::new('', $secure).Password

$count = $null; $failed = $false
for ($i = 0; $i -lt 6 -and $null -eq $count; $i++) {   # the network may need a moment after wake-up
  try {
    $res = Invoke-RestMethod -Uri "$($config.apiUrl.TrimEnd('/'))/api/stats/paying" -Headers @{ 'X-Stats-Token' = $token } -TimeoutSec 15
    $count = [int]$res.paying
  } catch { Start-Sleep -Seconds 10 }
}
if ($null -eq $count) {
  if ($null -eq $s.lastCount) { exit 1 }
  $count = [int]$s.lastCount; $failed = $true
}

$prev = if ($null -ne $s.lastCount) { [int]$s.lastCount } else { $count }
$url  = ([System.Uri]$page).AbsoluteUri + "?n=$count&prev=$prev" + $(if ($failed) { '&error=1' } else { '' })

[pscustomobject]@{ lastShown = $today; lastCount = $count } | ConvertTo-Json | Set-Content $state -Encoding UTF8

$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) {
  # Own profile folder so it opens as a separate full-screen window, not a tab in your normal Edge.
  Start-Process $edge -ArgumentList @("--app=$url", '--start-fullscreen', "--user-data-dir=`"$dir\edge`"", '--no-first-run')
} else {
  Start-Process $url
}
