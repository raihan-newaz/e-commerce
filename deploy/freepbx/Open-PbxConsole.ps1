param([int]$Port = 18080)
$ErrorActionPreference = 'Stop'
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Use a local port from 1024 to 65535.' }
$existing = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existing) { throw "Local port $Port is in use. Use -Port with another port." }
$errorLog = Join-Path $env:TEMP ('pbx-console-tunnel-' + [guid]::NewGuid().ToString('N') + '.log')
$tunnel = Start-Process -FilePath 'ssh.exe' -ArgumentList @('-N','-L',"127.0.0.1:${Port}:127.0.0.1:80",'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3','BDIX-VPS') -WindowStyle Hidden -RedirectStandardError $errorLog -PassThru
Start-Sleep -Milliseconds 900
if ($tunnel.HasExited) { throw "SSH tunnel could not start. See $errorLog" }
Write-Output "PBX Console: http://127.0.0.1:$Port/admin/config.php?display=nixops"
Write-Output "Tunnel process: $($tunnel.Id). Close it later with Stop-Process -Id $($tunnel.Id)."
