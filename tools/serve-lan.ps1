# Serve the API + web app on the local network so a phone on the same Wi-Fi can use it
# (Expo Go or a development build). Uses the dev database from public_html/api/config.php.
#
#   powershell -ExecutionPolicy Bypass -File tools\serve-lan.ps1            # port 8080
#   powershell -ExecutionPolicy Bypass -File tools\serve-lan.ps1 -Port 8090
param([int]$Port = 8080)

$root = Split-Path -Parent $PSScriptRoot
$php = 'C:\xampp\php\php.exe'
if (-not (Test-Path $php)) { $php = 'php' }

$ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Docker|Loopback' } |
  Select-Object -ExpandProperty IPAddress)
if ($ips.Count -eq 0) {
  Write-Host 'No network address found. Connect this PC to Wi-Fi first.' -ForegroundColor Red
  exit 1
}

$url = "http://$($ips[0]):$Port"
$env:GM_APP_URL = $url   # WhatsApp estimate links point at this PC instead of 127.0.0.1

Write-Host ''
Write-Host 'Type this server address in the phone app (first launch):' -ForegroundColor Green
foreach ($ip in $ips) { Write-Host "    http://$($ip):$Port" }
Write-Host ''
Write-Host 'Phone and PC must be on the same Wi-Fi. If the phone cannot connect, allow the port once' -ForegroundColor Yellow
Write-Host '(PowerShell as administrator):' -ForegroundColor Yellow
Write-Host "    New-NetFirewallRule -DisplayName 'Garage Manager dev' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private"
Write-Host ''
Write-Host 'Logins: admin / stock / desk / ramesh / mahesh, password garage123 (reset the DB: php tools\reset-dev-db.php)'
Write-Host 'Stop with Ctrl+C.'
Write-Host ''

& $php -S "0.0.0.0:$Port" -t "$root\public_html" "$root\tools\dev-router.php"
