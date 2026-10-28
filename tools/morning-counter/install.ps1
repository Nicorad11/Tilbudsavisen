# Installs the Tilbudsradar morning counter for the current Windows user.
# Run from this folder:  powershell -ExecutionPolicy Bypass -File .\install.ps1
param(
  [string]$ApiUrl = 'https://tilbudsradaren.dk'
)

$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$dir = Join-Path $env:LOCALAPPDATA 'TilbudsradarCounter'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

Copy-Item (Join-Path $src 'counter.html') $dir -Force
Copy-Item (Join-Path $src 'morning-counter.ps1') $dir -Force
@{ apiUrl = $ApiUrl } | ConvertTo-Json | Set-Content (Join-Path $dir 'config.json') -Encoding UTF8

Write-Host ''
Write-Host 'Paste the STATS_TOKEN you set on the server (input is hidden):'
$secure = Read-Host -AsSecureString
if ($secure.Length -lt 32) { throw 'The token must be at least 32 characters - the same value as STATS_TOKEN on the server.' }
$secure | ConvertFrom-SecureString | Set-Content (Join-Path $dir 'token.dat')

$script = Join-Path $dir 'morning-counter.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""

$user = "$env:USERDOMAIN\$env:USERNAME"
$logon = New-ScheduledTaskTrigger -AtLogOn -User $user
$morning = New-ScheduledTaskTrigger -Daily -At '07:00'      # also covers waking from sleep without a lock screen
$unlockClass = Get-CimClass -Namespace 'Root/Microsoft/Windows/TaskScheduler' -ClassName 'MSFT_TaskSessionStateChangeTrigger'
$unlock = New-CimInstance -CimClass $unlockClass -ClientOnly -Property @{ StateChange = 8; UserId = $user }  # 8 = unlock

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'Tilbudsradar morning counter' -Action $action -Trigger @($logon, $unlock, $morning) `
  -Settings $settings -Principal $principal -Force | Out-Null

Write-Host ''
Write-Host 'Installed. Showing the counter now as a test...'
& $script -Force
