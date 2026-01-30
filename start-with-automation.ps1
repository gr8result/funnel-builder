# Start both Next.js dev server and automation scheduler
# Run with: .\start-with-automation.ps1

Write-Host "Starting Funnel Builder with Automation..." -ForegroundColor Cyan
Write-Host ""

# Start Next.js dev server in background
$devJob = Start-Job -ScriptBlock {
    Set-Location $using:PWD
    npm run dev
}

# Wait a moment for dev server to start
Start-Sleep -Seconds 3

# Start automation scheduler in background
$autoJob = Start-Job -ScriptBlock {
    Set-Location $using:PWD
    npm run automation
}

Write-Host "Started:" -ForegroundColor Green
Write-Host "   - Next.js Dev Server (Job ID: $($devJob.Id))" -ForegroundColor Gray
Write-Host "   - Automation Scheduler (Job ID: $($autoJob.Id))" -ForegroundColor Gray
Write-Host ""
Write-Host "Viewing automation output (Ctrl+C to stop):" -ForegroundColor Yellow
Write-Host ""

# Stream automation output
try {
    while ($true) {
        $autoJob | Receive-Job
        Start-Sleep -Seconds 1
    }
}
finally {
    Write-Host ""
    Write-Host "Stopping all services..." -ForegroundColor Yellow
    Stop-Job -Job $devJob, $autoJob
    Remove-Job -Job $devJob, $autoJob
    Write-Host "All services stopped" -ForegroundColor Green
}
