param(
  [Parameter(Mandatory=$true)]
  [string]$FlowId,

  [int]$Max = 50,

  [string]$BaseUrl = "http://localhost:3000"
)

function Import-DotEnv($path) {
  if (!(Test-Path $path)) { return }
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0) { return }
    if ($line.StartsWith("#")) { return }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { return }
    $k = $line.Substring(0, $idx).Trim()
    $v = $line.Substring($idx + 1).Trim()
    if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
      $v = $v.Substring(1, $v.Length - 2)
    }
    if ($k.Length -gt 0) {
      [System.Environment]::SetEnvironmentVariable($k, $v, "Process")
    }
  }
}

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

Import-DotEnv (Join-Path $projectRoot ".env.local")
Import-DotEnv (Join-Path $projectRoot ".env")

$cronSecret = $env:AUTOMATION_CRON_SECRET
if ([string]::IsNullOrWhiteSpace($cronSecret)) { $cronSecret = $env:AUTOMATION_CRON_KEY }
if ([string]::IsNullOrWhiteSpace($cronSecret)) { $cronSecret = $env:CRON_SECRET }

$uri = "$BaseUrl/api/automation/engine/tick"

$headers = @{
  "Content-Type" = "application/json"
  "Connection"   = "close"
}

if (-not [string]::IsNullOrWhiteSpace($cronSecret)) {
  $headers["x-cron-key"] = $cronSecret
}

$bodyJson = (@{
  flow_id = $FlowId
  max     = $Max
} | ConvertTo-Json -Depth 10)

Write-Host "POST $uri"
Write-Host "flow_id=$FlowId max=$Max"

# HARD TIMEOUT so it cannot hang
$ProgressPreference = "SilentlyContinue"
$timeoutSec = 12

try {
  $resp = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $bodyJson -TimeoutSec $timeoutSec
  Write-Host "`n=== RESPONSE ==="
  $resp | ConvertTo-Json -Depth 30
  exit 0
} catch {
  Write-Host "`n=== ERROR ==="
  Write-Host $_.Exception.Message

  # if server returned JSON/body, print it
  if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
    Write-Host "`n=== SERVER SAID ==="
    Write-Host $_.ErrorDetails.Message
  }

  exit 1
}
