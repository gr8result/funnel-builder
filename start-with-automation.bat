@echo off
REM Start both Next.js dev server and automation scheduler
REM Press Ctrl+C to stop both

echo Starting Funnel Builder with Automation...
echo.

start "Next.js Dev" cmd /k "npm run dev"
start "Automation" cmd /k "npm run automation"

echo.
echo Started:
echo    - Next.js Dev Server (port 3000)
echo    - Automation Scheduler
echo.
echo Press any key to stop all services...
pause >nul

taskkill /FI "WINDOWTITLE eq Next.js Dev*" /T /F
taskkill /FI "WINDOWTITLE eq Automation*" /T /F
