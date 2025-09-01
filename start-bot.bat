@echo off
title Discord Bot Auto-Restart
color 0A

echo.
echo ====================================
echo    Discord Bot Auto-Restart
echo ====================================
echo.
echo Starting bot with automatic restart...
echo Press Ctrl+C to stop permanently
echo.

set restart_count=0
set max_restarts=50

:restart_loop
if %restart_count% geq %max_restarts% goto max_reached

set /a restart_count+=1
echo.
echo [%date% %time%] Starting bot (Attempt #%restart_count%)...

node index.js

if %errorlevel% equ 0 (
    echo.
    echo Bot exited gracefully
    goto end
) else (
    echo.
    echo Bot crashed with exit code: %errorlevel%
    echo Waiting 5 seconds before restart...
    timeout /t 5 /nobreak >nul
    echo Restarting bot...
    goto restart_loop
)

:max_reached
echo.
echo Maximum restart attempts reached. Please check the bot code.
goto end

:end
echo.
echo Bot auto-restart script finished.
pause
