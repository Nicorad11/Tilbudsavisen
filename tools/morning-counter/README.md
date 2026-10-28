# Morning counter

A full-screen flip counter on your Windows PC that shows the number of paying users the first time you log in or unlock in the morning.

## 1. Server

Set a long random `STATS_TOKEN` (at least 32 characters) in the server's environment and redeploy. One way to make one in PowerShell:

```powershell
-join ((48..57) + (97..122) | Get-Random -Count 48 | % { [char]$_ })
```

The endpoint is `GET /api/stats/paying` with the header `X-Stats-Token: <token>`. It returns only `{ "paying": 46, "at": "..." }` and no customer data. If `STATS_TOKEN` is empty, the endpoint is turned off.

"Paying" means accounts with a running subscription. Admins and Stripe's own trial period (no payment yet) are not counted.

## 2. PC

Download this folder, open PowerShell in it and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Paste the same token when asked. The counter is shown right away as a test. From then on it appears once a day, on your first logon or unlock after 05:00, with a 07:00 fallback. Click or press any key to close it.

- Show it again: `powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\TilbudsradarCounter\morning-counter.ps1" -Force`
- Uninstall: `Unregister-ScheduledTask -TaskName 'Tilbudsradar morning counter'` and delete `%LOCALAPPDATA%\TilbudsradarCounter`.
